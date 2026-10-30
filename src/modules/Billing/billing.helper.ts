import { PoolClient } from "pg";

interface CreateMonthlyBillingParams {
    userId: number;
    assignmentId: number;
    roomId: number;
    bedId: number;
    billingMonth?: Date;
}

export const createMonthlyBilling = async (
    client: PoolClient,
    data: CreateMonthlyBillingParams
) => {

    //----------------------------------------------------
    // Get Room Monthly Fee
    //----------------------------------------------------

    const room = await client.query(
        `
        SELECT
            r.room_number,
            r.price_per_month,
            b.bed_number
        FROM rooms r

        INNER JOIN beds b
            ON b.id = $2

        WHERE r.id = $1
        `,
        [
            data.roomId,
            data.bedId,
        ]
    );

    if (room.rowCount === 0) {
        throw new Error("Room not found.");
    }

    const roomData = room.rows[0];
    const roomFee = Number(roomData.price_per_month);

    //----------------------------------------------------
    // Billing Month
    //----------------------------------------------------

    const billingMonth = data.billingMonth ?? new Date();

    //----------------------------------------------------
    // Prevent Duplicate Monthly Billing
    //----------------------------------------------------

    const existingBilling = await client.query(
        `
        SELECT id
        FROM billings
        WHERE
            assignment_id = $1
        AND
            billing_month = $2
        `,
        [
            data.assignmentId,
            billingMonth,
        ]
    );

    if (existingBilling.rowCount! > 0) {
        return null;
    }

    //----------------------------------------------------
    // Determine Billing Status
    //----------------------------------------------------

    const billingCount = await client.query(
        `
        SELECT COUNT(*)::int AS total
        FROM billings
        WHERE assignment_id = $1
        `,
        [data.assignmentId]
    );

    const isInitialBilling = billingCount.rows[0].total === 0;

    const status: "Pending" | "Upcoming" =
        isInitialBilling
            ? "Pending"
            : "Upcoming";

    //----------------------------------------------------
    // Due Date
    //----------------------------------------------------

    let dueDate: Date;

    if (isInitialBilling) {
        // First billing is due immediately
        dueDate = new Date();
    } else {
        // Future billings are due one month later
        dueDate = new Date(billingMonth);
        dueDate.setMonth(dueDate.getMonth() + 1);
    }

    //----------------------------------------------------
    // Billing Amounts
    //----------------------------------------------------

    const utilitiesFee = 0;
    const otherCharges = 0;
    const discount = 0;
    const lateFee = 0;
    const paidAmount = 0;

    const totalAmount =
        roomFee +
        utilitiesFee +
        otherCharges +
        lateFee -
        discount;

    const balance = totalAmount;

    //----------------------------------------------------
    // Generate Billing Number
    //----------------------------------------------------

    const nextBilling = await client.query(
        `
        SELECT
            COALESCE(
                MAX(billing_no::numeric),
                208544273569533
            ) + 1 AS next_no
        FROM billings
        `
    );

    const billingNo = nextBilling.rows[0].next_no.toString();

    //----------------------------------------------------
    // Create Billing
    //----------------------------------------------------

    const result = await client.query(
        `
        INSERT INTO billings
        (
            billing_no,
            user_id,
            assignment_id,

            room_number,
            bed_number,

            billing_type,
            billing_month,
            due_date,

            room_fee,
            utilities_fee,
            other_charges,
            discount,
            late_fee,

            total_amount,
            paid_amount,
            balance,

            status
        )
        VALUES
        (
            $1,$2,$3,$4,$5,
            $6,$7,$8,$9,$10,
            $11,$12,$13,$14,$15,
            $16,$17
        )
        RETURNING *
        `,
        [
            billingNo,
            data.userId,
            data.assignmentId,

            roomData.room_number,
            roomData.bed_number,

            "Monthly Rent",
            billingMonth,
            dueDate,

            roomFee,
            utilitiesFee,
            otherCharges,
            discount,
            lateFee,

            totalAmount,
            paidAmount,
            balance,

            status,
        ]
    );

    return result.rows[0];
};

//----------------------------------------------------
// Overdue Penalty (₱100 per week overdue)
//----------------------------------------------------

export const OVERDUE_PENALTY_PER_WEEK = 100;

// Day 1-7 overdue = week 1, day 8-14 = week 2, ...
export const OVERDUE_WEEKS_SQL =
    `CEIL((CURRENT_DATE - b.due_date) / 7.0)::int`;

export const overduePenaltyMessage = (
    billingNo: string,
    weeks: number,
    totalPenalty: number
) =>
    `Your billing #${billingNo} is overdue by ${weeks} week${weeks === 1 ? "" : "s"}. ` +
    `A penalty of ₱${OVERDUE_PENALTY_PER_WEEK} is added every week it stays unpaid ` +
    `(₱${totalPenalty.toLocaleString()} so far). Please settle your balance as soon as possible.`;

export const ensureOverduePenaltyColumn = async (client: PoolClient) => {
    await client.query(
        `
        ALTER TABLE billings
        ADD COLUMN IF NOT EXISTS overdue_weeks_charged INT NOT NULL DEFAULT 0
        `
    );
};

// Charges ₱100 for each overdue week not yet charged.
// overdue_weeks_charged prevents charging the same week twice,
// so the job is safe to run any number of times a day.
export const applyOverduePenalties = async (client: PoolClient) => {
    const result = await client.query(
        `
        UPDATE billings b
        SET
            late_fee = b.late_fee + ($1 * (${OVERDUE_WEEKS_SQL} - b.overdue_weeks_charged)),
            total_amount = b.total_amount + ($1 * (${OVERDUE_WEEKS_SQL} - b.overdue_weeks_charged)),
            balance = b.balance + ($1 * (${OVERDUE_WEEKS_SQL} - b.overdue_weeks_charged)),
            overdue_weeks_charged = ${OVERDUE_WEEKS_SQL},
            updated_at = NOW()
        FROM users u
        WHERE
            u.id = b.user_id
        AND
            b.status = 'Overdue'
        AND
            b.due_date < CURRENT_DATE
        AND
            ${OVERDUE_WEEKS_SQL} > b.overdue_weeks_charged
        RETURNING
            b.billing_no,
            b.balance,
            b.due_date,
            b.room_number,
            b.bed_number,
            b.overdue_weeks_charged,
            u.email,
            u.first_name
        `,
        [OVERDUE_PENALTY_PER_WEEK]
    );

    return result.rows;
};
