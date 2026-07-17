import { PoolClient } from "pg";

interface CreateMonthlyBillingParams {
    userId: number;
    assignmentId: number;
    roomId: number;
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
        SELECT price_per_month
        FROM rooms
        WHERE id = $1
        `,
        [data.roomId]
    );

    if (room.rowCount === 0) {
        throw new Error("Room not found.");
    }

    const roomFee = Number(room.rows[0].price_per_month);

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
    // Due Date
    // (One month after billing month)
    //----------------------------------------------------

    const dueDate = new Date(billingMonth);

    dueDate.setMonth(dueDate.getMonth() + 1);

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
    // Create Billing
    //----------------------------------------------------

    const result = await client.query(
        `
        INSERT INTO billings
        (
            billing_no,
            user_id,
            assignment_id,
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
            $1,$2,$3,$4,$5,$6,
            $7,$8,$9,$10,$11,
            $12,$13,$14,$15
        )
        RETURNING *
        `,
        [
            billingNo,
            data.userId,
            data.assignmentId,
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
            "Pending",
        ]
    );

    return result.rows[0];
};