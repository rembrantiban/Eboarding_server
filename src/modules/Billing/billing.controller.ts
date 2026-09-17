import { Request, Response } from "express";
import { pool } from "../../config/db";;
import { createMonthlyBilling } from "./billing.helper";
import { AuthRequest } from "../../types/auth";

export const recordPayment = async (
    req: AuthRequest,
    res: Response
) => {

    const client = await pool.connect();
    try {

        const { id } = req.params;
        const { amount } = req.body;

        const received_by = req.user?.id;

        if (!received_by) {
            return res.status(401).json({
                message: "Unauthorized.",
            });
        }

        if (!amount || Number(amount) <= 0) {
            return res.status(400).json({
                message: "Payment amount is required.",
            });
        }

        await client.query("BEGIN");

        //----------------------------------------------------
        // Get Billing
        //----------------------------------------------------

        const billingResult = await client.query(
            `
            SELECT
                b.*,
                ra.room_id,
                 ra.bed_id,
                ra.status AS assignment_status
            FROM billings b
            LEFT JOIN room_assignments ra
                ON ra.id = b.assignment_id
            WHERE b.id = $1
            FOR UPDATE OF b
            `,
            [id]
        );

        if (billingResult.rowCount === 0) {

            await client.query("ROLLBACK");

            return res.status(404).json({
                message: "Billing not found.",
            });

        }

        const billing = billingResult.rows[0];

        //----------------------------------------------------
        // Already Paid
        //----------------------------------------------------

        if (billing.status === "Paid") {

            await client.query("ROLLBACK");

            return res.status(400).json({
                message: "Billing is already paid.",
            });

        }

        //----------------------------------------------------
        // Validate Payment
        //----------------------------------------------------

        if (Number(amount) > Number(billing.balance)) {

            await client.query("ROLLBACK");

            return res.status(400).json({
                message: `Payment exceeds remaining balance of ₱${billing.balance}.`,
            });

        }

        //----------------------------------------------------
        // Compute Payment
        //----------------------------------------------------

        const paidAmount =
            Number(billing.paid_amount) +
            Number(amount);

        const balance =
            Number(billing.total_amount) -
            paidAmount;

        //----------------------------------------------------
        // Determine New Billing Status
        //----------------------------------------------------

        let status: "Partial" | "Paid";

        if (balance <= 0) {
            status = "Paid";
        } else {
            status = "Partial";
        }

        //----------------------------------------------------
        // Update Billing
        //----------------------------------------------------

        const updatedBilling = await client.query(
            `
            UPDATE billings
            SET
                paid_amount = $1,
                balance = $2,
                status = $3,
                updated_at = NOW()
            WHERE id = $4
            RETURNING *
            `,
            [
                paidAmount,
                balance,
                status,
                id,
            ]
        );


        await client.query(
            `
            INSERT INTO billing_payments
            (
                billing_id,
                amount,
                status,
                received_by,
                received_at
            )
            VALUES
            ($1, $2, $3, $4, NOW())
            `,
            [
                id,
                amount,
                status,
                received_by,
            ]
        );

        //----------------------------------------------------
        // Generate Next Billing
        //----------------------------------------------------

        //----------------------------------------------------
        // Generate Next Billing
        //----------------------------------------------------

        if (status === "Paid") {

            const assignmentCheck = await client.query(
                `
            SELECT
                id,
                status,
                expected_checkout
            FROM room_assignments
            WHERE id = $1
        `,
                [billing.assignment_id]
            );

            if (assignmentCheck.rows.length > 0) {

                const assignment =
                    assignmentCheck.rows[0];

                const currentBillingMonth =
                    billing.billing_month
                        ? new Date(billing.billing_month)
                        : new Date();

                const nextMonth =
                    new Date(currentBillingMonth);

                nextMonth.setMonth(
                    nextMonth.getMonth() + 1
                );

                /**
                 * Stop generating future billings
                 * if boarder is already checked out
                 * or expected checkout falls before
                 * the next billing month.
                 */
                const checkoutDate =
                    assignment.expected_checkout
                        ? new Date(
                            assignment.expected_checkout
                        )
                        : null;

                const shouldGenerateBilling =
                    assignment.status === "Active" &&
                    (
                        !checkoutDate ||
                        nextMonth < checkoutDate
                    );

                if (shouldGenerateBilling) {

                    /**
                     * Prevent duplicate billing
                     */
                    const existingBilling =
                        await client.query(
                            `
                    SELECT id
                    FROM billings
                    WHERE assignment_id = $1
                    AND billing_month = $2
                    LIMIT 1
                    `,
                            [
                                billing.assignment_id,
                                nextMonth,
                            ]
                        );

                    if (
                        existingBilling.rowCount === 0
                    ) {

                        console.log(
                            "Creating next month's billing..."
                        );

                        console.log({
                            assignmentStatus:
                                assignment.status,
                            userId:
                                billing.user_id,
                            assignmentId:
                                billing.assignment_id,
                            roomId:
                                billing.room_id,
                            billingMonth:
                                nextMonth,
                        });

                        await createMonthlyBilling(
                            client,
                            {
                                userId:
                                    billing.user_id,
                                assignmentId:
                                    billing.assignment_id,
                                roomId:
                                    billing.room_id,
                                bedId:
                                    billing.bed_id,
                                billingMonth:
                                    nextMonth,
                            }
                        );

                    } else {

                        console.log(
                            "Next billing already exists. Skipping generation."
                        );

                    }

                } else {

                    console.log(
                        "Skipping next billing because boarder is checking out or assignment is inactive."
                    );

                }

            } else {

                console.log(
                    "Skipping next billing because assignment no longer exists."
                );

            }

        }

        //----------------------------------------------------
        // Commit
        //----------------------------------------------------

        await client.query("COMMIT");

        return res.status(200).json({
            message:
                status === "Paid"
                    ? "Payment completed successfully."
                    : "Partial payment recorded successfully.",
            billing: updatedBilling.rows[0],
        });

    } catch (error) {

        await client.query("ROLLBACK");

        console.error("Record Payment Error:", error);

        return res.status(500).json({
            message:
                error instanceof Error
                    ? error.message
                    : "Server error.",
        });

    } finally {

        client.release();

    }

};

export const getAllBillings = async (
    req: Request,
    res: Response
) => {
    try {

        const result = await pool.query(
            `
            SELECT

                b.id,
                b.billing_no,

                b.billing_type,
                b.billing_month,
                b.due_date,

                b.room_fee,
                b.utilities_fee,
                b.other_charges,

                b.discount,
                b.late_fee,

                b.total_amount,
                b.paid_amount,
                b.balance,

                b.status,

                b.created_at,
                b.updated_at,

                u.id AS user_id,
                u.user_id_no,
                u.first_name,
                u.last_name,
                u.email,
                u.contact_number,
                u.avatar_url,

                ra.id AS assignment_id,
                ra.assigned_date,
                ra.expected_checkout,

                r.id AS room_id,
                r.room_number,

                bd.id AS bed_id,
                bd.bed_number

            FROM billings b

            INNER JOIN users u
                ON u.id = b.user_id

            LEFT JOIN room_assignments ra
                ON ra.id = b.assignment_id

            LEFT JOIN rooms r
                ON r.id = ra.room_id

            LEFT JOIN beds bd
                ON bd.id = ra.bed_id

            WHERE b.status IN (
                'Upcoming',
                'Pending',
                'Partial',
                'Overdue'
            )

            ORDER BY
                b.created_at DESC;
            `
        );

        return res.status(200).json(result.rows);

    } catch (error) {

        console.error("Get Billings Error:", error);

        return res.status(500).json({
            message: "Server error.",
        });

    }
};

export const applyLatePaymentFee = async (
    req: AuthRequest,
    res: Response
) => {

    const client = await pool.connect();

    try {

        const { id } = req.params;
        const { late_fee } = req.body;

        if (!late_fee || Number(late_fee) <= 0) {
            return res.status(400).json({
                message: "Late payment fee is required.",
            });
        }

        await client.query("BEGIN");


        const billingResult = await client.query(
            `
            SELECT *
            FROM billings
            WHERE id = $1
            FOR UPDATE
            `,
            [id]
        );

        if (billingResult.rowCount === 0) {

            await client.query("ROLLBACK");

            return res.status(404).json({
                message: "Billing not found.",
            });

        }

        const billing = billingResult.rows[0];



        if (
            billing.status === "Paid" ||
            billing.status === "Cancelled" ||
            billing.status === "Upcoming"
        ) {

            await client.query("ROLLBACK");

            return res.status(400).json({
                message:
                    "Late fee cannot be applied to this billing.",
            });

        }


        const newLateFee =
            Number(billing.late_fee) +
            Number(late_fee);

        const newTotal =
            Number(billing.total_amount) +
            Number(late_fee);

        const newBalance =
            Number(billing.balance) +
            Number(late_fee);

        //--------------------------------------------------
        // Update
        //--------------------------------------------------

        const result = await client.query(
            `
            UPDATE billings
            SET
                late_fee = $1,
                total_amount = $2,
                balance = $3,
                status = 'Overdue',
                updated_at = NOW()
            WHERE id = $4
            RETURNING *
            `,
            [
                newLateFee,
                newTotal,
                newBalance,
                id,
            ]
        );

        await client.query("COMMIT");

        return res.status(200).json({
            message: "Late payment fee applied successfully.",
            billing: result.rows[0],
        });

    } catch (error) {

        await client.query("ROLLBACK");

        console.error(error);

        return res.status(500).json({
            message: "Server error.",
        });

    } finally {

        client.release();

    }

};

export const applyDiscount = async (
    req: AuthRequest,
    res: Response
) => {

    const client = await pool.connect();

    try {

        const { id } = req.params;
        const { discount } = req.body;

        if (!discount || Number(discount) <= 0) {
            return res.status(400).json({
                message: "Discount amount is required.",
            });
        }

        await client.query("BEGIN");

        //--------------------------------------------------
        // Get Billing
        //--------------------------------------------------

        const billingResult = await client.query(
            `
            SELECT *
            FROM billings
            WHERE id = $1
            FOR UPDATE
            `,
            [id]
        );

        if (billingResult.rowCount === 0) {

            await client.query("ROLLBACK");

            return res.status(404).json({
                message: "Billing not found.",
            });

        }

        const billing = billingResult.rows[0];

        //--------------------------------------------------
        // Cannot modify Paid / Cancelled
        //--------------------------------------------------

        if (
            billing.status === "Paid" ||
            billing.status === "Cancelled"
        ) {

            await client.query("ROLLBACK");

            return res.status(400).json({
                message:
                    "Discount cannot be applied to this billing.",
            });

        }

        //--------------------------------------------------
        // Prevent discount greater than balance
        //--------------------------------------------------

        if (Number(discount) > Number(billing.balance)) {

            await client.query("ROLLBACK");

            return res.status(400).json({
                message:
                    "Discount cannot exceed remaining balance.",
            });

        }

        //--------------------------------------------------
        // Compute
        //--------------------------------------------------

        const newDiscount =
            Number(billing.discount) +
            Number(discount);

        const newTotal =
            Number(billing.total_amount) -
            Number(discount);

        const newBalance =
            Number(billing.balance) -
            Number(discount);

        //--------------------------------------------------
        // Determine Status
        //--------------------------------------------------

        let status = billing.status;

        if (newBalance <= 0) {
            status = "Paid";
        }
        else if (Number(billing.paid_amount) > 0) {
            status = "Partial";
        }
        else {
            status = "Pending";
        }

        //--------------------------------------------------
        // Update Billing
        //--------------------------------------------------

        const result = await client.query(
            `
            UPDATE billings
            SET
                discount = $1,
                total_amount = $2,
                balance = $3,
                status = $4,
                updated_at = NOW()
            WHERE id = $5
            RETURNING *
            `,
            [
                newDiscount,
                newTotal,
                newBalance,
                status,
                id,
            ]
        );

        await client.query("COMMIT");

        return res.status(200).json({
            message: "Discount applied successfully.",
            billing: result.rows[0],
        });

    } catch (error) {

        await client.query("ROLLBACK");

        console.error(error);

        return res.status(500).json({
            message: "Server error.",
        });

    } finally {

        client.release();

    }

};

export const getPaymentHistory = async (
    req: Request,
    res: Response
) => {
    try {

        const result = await pool.query(
            `
            SELECT

                bp.id,

                CONCAT(
                    'RCP-',
                    TO_CHAR(bp.received_at,'YYYY'),
                    '-',
                    LPAD(bp.id::TEXT,6,'0')
                ) AS receipt_no,

                bp.billing_id,
                bp.status,
                bp.reason,
                bp.notes,
                bp.amount,
                bp.received_at,


                b.billing_no,
                b.billing_type,
                b.billing_month,
                b.due_date,
                 b.updated_at,  

                b.room_fee,
                b.utilities_fee,
                b.other_charges,
                b.discount,
                b.late_fee,

                b.total_amount,
                b.paid_amount,
                b.balance,


                boarder.id AS boarder_id,
                boarder.user_id_no AS boarder_user_id_no,
                boarder.first_name AS boarder_first_name,
                boarder.last_name AS boarder_last_name,
                boarder.email AS boarder_email,
                boarder.contact_number AS boarder_contact_number,
                boarder.avatar_url AS boarder_avatar_url,


                r.id AS room_id,
                r.room_number,

                bed.id AS bed_id,
                bed.bed_number,

                receiver.id AS received_by_id,
                receiver.user_id_no,
                receiver.first_name,
                receiver.last_name,
                receiver.email,
                receiver.avatar_url

            FROM billing_payments bp

            INNER JOIN billings b
                ON b.id = bp.billing_id

            INNER JOIN users boarder
                ON boarder.id = b.user_id

            LEFT JOIN room_assignments ra
                ON ra.id = b.assignment_id

            LEFT JOIN rooms r
                ON r.id = ra.room_id

            LEFT JOIN beds bed
                ON bed.id = ra.bed_id

            INNER JOIN users receiver
                ON receiver.id = bp.received_by

            WHERE bp.status IN
            (   'Cancelled',
                'Partial',
                'Paid'
            )

            ORDER BY
                bp.received_at DESC,
                bp.id DESC
            `
        );

        return res.status(200).json(result.rows);

    } catch (error) {

        console.error("Get Payment History Error:", error);

        return res.status(500).json({
            message: "Server error.",
        });

    }
};

export const getOutstandingBalance = async (
    req: AuthRequest,
    res: Response
) => {
    try {

        const userId = req.user?.id;

        const result = await pool.query(
            `
            SELECT
                billing_no,
                due_date,
                balance,
                status
            FROM billings
            WHERE
                user_id = $1
            AND
                status IN
                (
                    'Pending',
                    'Partial',
                    'Overdue'
                )
            ORDER BY due_date ASC
            LIMIT 1
            `,
            [userId]
        );

        if (result.rowCount === 0) {
            return res.json({
                outstanding_balance: 0,
                pending_count: 0,
            });
        }

        return res.json({
            outstanding_balance: Number(result.rows[0].balance),
            pending_count: 1,
            due_date: result.rows[0].due_date,
            billing_no: result.rows[0].billing_no,
            status: result.rows[0].status,
        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            message: "Server error.",
        });

    }
};

export const getActivePenalties = async (
    req: AuthRequest,
    res: Response
) => {
    try {

        const userId = req.user?.id;

        const result = await pool.query(
            `
            SELECT
                id,
                billing_no,
                billing_month,
                due_date,
                late_fee
            FROM billings
            WHERE
                user_id = $1
            AND
                late_fee > 0
            AND
                status IN
                (
                    'Pending',
                    'Partial',
                    'Overdue'
                )
            ORDER BY due_date ASC
            `,
            [userId]
        );

        return res.status(200).json(result.rows);

    } catch (error) {

        console.error("Get Active Penalties:", error);

        return res.status(500).json({
            message: "Server error.",
        });

    }
};


export const getMyPendingBilling = async (
    req: AuthRequest,
    res: Response
) => {
    try {
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({
                message: "Unauthorized.",
            });
        }

        const result = await pool.query(
            `
            SELECT
            b.id,
            b.billing_no,

            b.billing_type,
            b.billing_month,
            b.due_date,

            b.room_fee,
            b.utilities_fee,
            b.other_charges,

            b.discount,
            b.late_fee,

            b.total_amount,
            b.paid_amount,
            b.balance,

            b.status,

            b.created_at,
            b.updated_at,

            u.id AS user_id,
            u.user_id_no,
            u.first_name,
            u.last_name,
            u.email,
            u.contact_number,
            u.avatar_url,

            ra.id AS assignment_id,
            ra.assigned_date,
            ra.expected_checkout,

            r.id AS room_id,
            r.room_number,

            bd.id AS bed_id,
            bd.bed_number

        FROM billings b

        INNER JOIN users u
            ON u.id = b.user_id

        LEFT JOIN room_assignments ra
            ON ra.id = b.assignment_id

        LEFT JOIN rooms r
            ON r.id = ra.room_id

        LEFT JOIN beds bd
            ON bd.id = ra.bed_id

        WHERE
            b.user_id = $1
        AND
            b.status IN
            (
                'Pending',
                'Partial',
                'Overdue'
            )

        ORDER BY b.due_date ASC;
      `,
            [userId]
        );

        if (result.rowCount === 0) {
            return res.status(200).json({
                billing: [],
                message: "No pending billing found.",
            });
        }

        return res.status(200).json({
            billing: result.rows,
        });

    } catch (error) {
        console.error("Get My Pending Billing:", error);

        return res.status(500).json({
            message: "Server error.",
        });
    }
};

export const getMyPaymentHistory = async (
    req: AuthRequest,
    res: Response
) => {
    try {
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({
                message: "Unauthorized.",
            });
        }

        const result = await pool.query(
            `
        SELECT

            bp.id,

            CONCAT(
                'RCP-',
                TO_CHAR(bp.received_at,'YYYY'),
                '-',
                LPAD(bp.id::TEXT,6,'0')
            ) AS receipt_no,

            bp.billing_id,
            bp.status,
            bp.reason,
            bp.notes,
            bp.amount,
            bp.received_at,

            b.billing_no,
            b.billing_type,
            b.billing_month,
            b.due_date,
            b.updated_at,

            b.room_fee,
            b.utilities_fee,
            b.other_charges,
            b.discount,
            b.late_fee,

            b.total_amount,
            b.paid_amount,
            b.balance,

            -- Boarder
            boarder.id AS boarder_id,
            boarder.user_id_no AS boarder_user_id_no,
            boarder.first_name AS boarder_first_name,
            boarder.last_name AS boarder_last_name,
            boarder.email AS boarder_email,
            boarder.contact_number AS boarder_contact_number,
            boarder.avatar_url AS boarder_avatar_url,

            -- Room
            r.room_number,
            bed.bed_number,

            -- Receiver / Cashier
            receiver.id AS received_by_id,
            receiver.user_id_no,
            receiver.first_name,
            receiver.last_name,
            receiver.email,
            receiver.avatar_url

        FROM billing_payments bp

        INNER JOIN billings b
            ON b.id = bp.billing_id

        INNER JOIN users boarder
            ON boarder.id = b.user_id

        LEFT JOIN room_assignments ra
            ON ra.id = b.assignment_id

        LEFT JOIN rooms r
            ON r.id = ra.room_id

        LEFT JOIN beds bed
            ON bed.id = ra.bed_id

        INNER JOIN users receiver
            ON receiver.id = bp.received_by

        WHERE
            b.user_id = $1
        AND
            bp.status IN ('Cancelled','Partial','Paid')

        ORDER BY
            bp.received_at DESC,
            bp.id DESC;`,
            [userId]
        );

        return res.status(200).json({
            payments: result.rows,
            total: result.rowCount,
        });

    } catch (error) {

        console.error("Get My Payment History Error:", error);

        return res.status(500).json({
            message: "Server error.",
        });

    }
};


export const getPaymentsOverview = async (
    req: AuthRequest,
    res: Response
) => {
    try {

        const result = await pool.query(`
            SELECT
                DATE(bp.received_at) AS payment_date,

                TO_CHAR(
                    bp.received_at,
                    'Mon DD'
                ) AS date,

                COALESCE(
                    SUM(bp.amount),
                    0
                ) AS value

            FROM billing_payments bp

            WHERE bp.status IN ('Paid', 'Partial')

            AND DATE_TRUNC(
                'month',
                bp.received_at
            ) = DATE_TRUNC(
                'month',
                CURRENT_DATE
            )

            GROUP BY
                DATE(bp.received_at),
                TO_CHAR(
                    bp.received_at,
                    'Mon DD'
                )

            ORDER BY
                DATE(bp.received_at)
        `);

        return res.status(200).json(
            result.rows.map(row => ({
                ...row,
                value: Number(row.value),
            }))
        );

    } catch (error) {

        console.error(
            "Payments Overview Error:",
            error
        );

        return res.status(500).json({
            message: "Server error.",
        });

    }
};

export const getPaymentsOverviewTrend = async (
    req: AuthRequest,
    res: Response
) => {
    try {

        const result = await pool.query(`
            WITH months AS (
                SELECT
                    DATE_TRUNC(
                        'month',
                        CURRENT_DATE - (INTERVAL '1 month' * gs)
                    ) AS month_start
                FROM generate_series(5, 0, -1) gs
            )

            SELECT
                TO_CHAR(
                    m.month_start,
                    'Mon'
                ) AS date,

                COALESCE(
                    (
                        SELECT SUM(bp.amount)
                        FROM billing_payments bp
                        WHERE bp.status IN ('Paid', 'Partial')
                        AND DATE_TRUNC(
                            'month',
                            bp.received_at
                        ) = m.month_start
                    ),
                    0
                ) AS value,

                m.month_start AS month_sort

            FROM months m

            ORDER BY month_sort ASC
        `);

        return res.status(200).json(
            result.rows.map(row => ({
                date: row.date.trim(),
                value: Number(row.value),
            }))
        );

    } catch (error) {

        console.error(
            "Payments Overview Trend Error:",
            error
        );

        return res.status(500).json({
            message: "Server error.",
        });

    }
};

export const getCalendarEvents = async (
    req: Request,
    res: Response
) => {
    try {
        const result = await pool.query(`
      SELECT
          b.id,
          b.due_date,
          b.total_amount,
          b.balance,
          b.status,

          CONCAT(
            u.first_name,
            ' ',
            u.last_name
          ) AS boarder,

          r.room_number,
          bed.bed_number

      FROM billings b

      JOIN users u
        ON u.id = b.user_id

      LEFT JOIN room_assignments ra
        ON ra.id = b.assignment_id

      LEFT JOIN rooms r
        ON r.id = ra.room_id

      LEFT JOIN beds bed
        ON bed.id = ra.bed_id

      WHERE b.status IN
      (
        'Upcoming',
        'Pending',
        'Overdue',
        'Paid'
      )

      ORDER BY b.due_date;
    `);

        const events = result.rows.map((row) => ({
            id: row.id,

            date: row.due_date,

            label: "Rent Payment",

            type: "payment",

            amount: Number(row.total_amount),

            boarder: row.boarder,

            room: `${row.room_number} - ${row.bed_number}`,

            status: row.status,

            color:
                row.status === "Paid"
                    ? "#10b981"
                    : row.status === "Pending"
                        ? "#a855f7"
                        : row.status === "Upcoming"
                            ? "#6366f1"
                            : "#ef4444",
        }));

        res.json(events);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            message: "Server error",
        });

    }
};


export const getAllActivePenalties = async (
    req: Request,
    res: Response
) => {
    try {
        const result = await pool.query(`
      SELECT
        b.id,
        CONCAT(u.first_name, ' ', u.last_name) AS boarder,
        CONCAT(
          LEFT(u.first_name,1),
          LEFT(u.last_name,1)
        ) AS initials,

        'Late Payment' AS reason,

        b.late_fee AS amount,

        b.updated_at AS date,

        r.room_number,
        bed.bed_number

      FROM billings b

      INNER JOIN users u
        ON u.id = b.user_id

      LEFT JOIN room_assignments ra
        ON ra.id = b.assignment_id

      LEFT JOIN rooms r
        ON r.id = ra.room_id

      LEFT JOIN beds bed
        ON bed.id = ra.bed_id

      WHERE
        b.late_fee > 0
      AND
        b.status IN
        (
          'Pending',
          'Partial',
          'Overdue'
        )

      ORDER BY b.updated_at DESC;
    `);

        return res.status(200).json(result.rows);

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            message: "Server error.",
        });
    }
};


export const cancelBilling = async (
    req: AuthRequest,
    res: Response
) => {

    const client = await pool.connect();

    try {

        const { id } = req.params;

        const {
            reason,
            notes,
        } = req.body;

        const cancelledBy = req.user?.id;

        if (!cancelledBy) {
            return res.status(401).json({
                message: "Unauthorized.",
            });
        }

        if (!reason) {
            return res.status(400).json({
                message: "Cancellation reason is required.",
            });
        }

        await client.query("BEGIN");

        const billingResult = await client.query(
            `
            SELECT *
            FROM billings
            WHERE id = $1
            FOR UPDATE
            `,
            [id]
        );

        if (billingResult.rowCount === 0) {

            await client.query("ROLLBACK");

            return res.status(404).json({
                message: "Billing not found.",
            });

        }

        const billing = billingResult.rows[0];

        if (
            billing.status === "Paid" ||
            billing.status === "Cancelled"
        ) {

            await client.query("ROLLBACK");

            return res.status(400).json({
                message:
                    "This billing cannot be cancelled.",
            });

        }

        const updatedBilling = await client.query(
            `
            UPDATE billings
            SET
                status = 'Cancelled',
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
            `,
            [id]
        );

       await client.query(
            `
            INSERT INTO billing_payments
            (
                billing_id,
                amount,
                status,
                reason,
                notes,
                received_by,
                received_at
            )
            VALUES
            (
                $1,
                $2,
                'Cancelled',
                $3,
                $4,
                $5,
                NOW()
            )
            `,
            [
                id,
                billing.total_amount, // ← not 0
                reason,
                notes ?? null,
                cancelledBy
            ]
        );
        await client.query("COMMIT");

        return res.status(200).json({
            message:
                "Billing cancelled successfully.",
            billing: updatedBilling.rows[0],
        });

    } catch (error) {

        await client.query("ROLLBACK");

        console.error(error);

        return res.status(500).json({
            message: "Server error.",
        });

    } finally {

        client.release();

    }

};

export const getBillingStats = async (
    req: Request,
    res: Response
) => {
    try {

        const result = await pool.query(`
            WITH current_month AS (
                SELECT

                    (
                        SELECT COALESCE(
                            SUM(amount),
                            0
                        )
                        FROM billing_payments
                        WHERE status IN ('Paid', 'Partial')
                    ) AS total_income,

                    COALESCE(
                        SUM(bp.amount),
                        0
                    ) AS collected_this_month,

                    (
                        SELECT COALESCE(
                            SUM(late_fee),
                            0
                        )
                        FROM billings
                        WHERE status = 'Paid'
                        AND DATE_TRUNC(
                            'month',
                            updated_at
                        ) = DATE_TRUNC(
                            'month',
                            CURRENT_DATE
                        )
                    ) AS late_fees_collected

                FROM billing_payments bp

                WHERE bp.status IN ('Paid', 'Partial')
                AND DATE_TRUNC(
                    'month',
                    bp.received_at
                ) = DATE_TRUNC(
                    'month',
                    CURRENT_DATE
                )
            ),

            previous_total_income AS (
                SELECT
                    COALESCE(
                        SUM(amount),
                        0
                    ) AS total_income
                FROM billing_payments
                WHERE status IN ('Paid', 'Partial')
                AND received_at < DATE_TRUNC(
                    'month',
                    CURRENT_DATE
                )
            ),

            previous_month AS (
                SELECT

                    COALESCE(
                        SUM(bp.amount),
                        0
                    ) AS collected_this_month,

                    (
                        SELECT COALESCE(
                            SUM(late_fee),
                            0
                        )
                        FROM billings
                        WHERE status = 'Paid'
                        AND DATE_TRUNC(
                            'month',
                            updated_at
                        ) = DATE_TRUNC(
                            'month',
                            CURRENT_DATE - INTERVAL '1 month'
                        )
                    ) AS late_fees_collected

                FROM billing_payments bp

                WHERE bp.status IN ('Paid', 'Partial')
                AND DATE_TRUNC(
                    'month',
                    bp.received_at
                ) = DATE_TRUNC(
                    'month',
                    CURRENT_DATE - INTERVAL '1 month'
                )
            ),

            current_collection_rate AS (
                SELECT
                    ROUND(
                        (
                            COALESCE(
                                (
                                    SELECT SUM(amount)
                                    FROM billing_payments
                                    WHERE status IN ('Paid', 'Partial')
                                    AND DATE_TRUNC(
                                        'month',
                                        received_at
                                    ) = DATE_TRUNC(
                                        'month',
                                        CURRENT_DATE
                                    )
                                ),
                                0
                            )
                            /
                            NULLIF(
                                (
                                    SELECT SUM(total_amount)
                                    FROM billings
                                    WHERE DATE_TRUNC(
                                        'month',
                                        due_date
                                    ) = DATE_TRUNC(
                                        'month',
                                        CURRENT_DATE
                                    )
                                ),
                                0
                            )
                        ) * 100,
                        2
                    ) AS rate
            ),

            previous_collection_rate AS (
                SELECT
                    ROUND(
                        (
                            COALESCE(
                                (
                                    SELECT SUM(amount)
                                    FROM billing_payments
                                    WHERE status IN ('Paid', 'Partial')
                                    AND DATE_TRUNC(
                                        'month',
                                        received_at
                                    ) = DATE_TRUNC(
                                        'month',
                                        CURRENT_DATE - INTERVAL '1 month'
                                    )
                                ),
                                0
                            )
                            /
                            NULLIF(
                                (
                                    SELECT SUM(total_amount)
                                    FROM billings
                                    WHERE DATE_TRUNC(
                                        'month',
                                        due_date
                                    ) = DATE_TRUNC(
                                        'month',
                                        CURRENT_DATE - INTERVAL '1 month'
                                    )
                                ),
                                0
                            )
                        ) * 100,
                        2
                    ) AS rate
            )

            SELECT
                cm.total_income,
                cm.collected_this_month,
                cm.late_fees_collected,

                pti.total_income AS previous_total_income,
                pm.collected_this_month AS previous_collected,
                pm.late_fees_collected AS previous_late_fees,

                ccr.rate AS collection_rate,
                pcr.rate AS previous_collection_rate

            FROM current_month cm
            CROSS JOIN previous_total_income pti
            CROSS JOIN previous_month pm
            CROSS JOIN current_collection_rate ccr
            CROSS JOIN previous_collection_rate pcr
        `);

        const stats = result.rows[0];

        const calculateChange = (
            current: number,
            previous: number
        ) => {
            if (previous === 0) {
                return current > 0 ? 100 : 0;
            }

            return Number(
                (
                    ((current - previous) / previous) *
                    100
                ).toFixed(1)
            );
        };

        return res.status(200).json({
            totalIncome:
                Number(stats.total_income),

            totalIncomeChange:
                calculateChange(
                    Number(stats.total_income),
                    Number(stats.previous_total_income)
                ),

            lateFeesCollected:
                Number(stats.late_fees_collected),

            lateFeesChange:
                calculateChange(
                    Number(stats.late_fees_collected),
                    Number(stats.previous_late_fees)
                ),

            amountCollectedThisMonth:
                Number(stats.collected_this_month),

            amountCollectedChange:
                calculateChange(
                    Number(stats.collected_this_month),
                    Number(stats.previous_collected)
                ),

            collectionRate:
                Number(stats.collection_rate || 0),

            collectionRateChange:
                calculateChange(
                    Number(stats.collection_rate || 0),
                    Number(stats.previous_collection_rate || 0)
                ),
        });

    } catch (error) {

        console.error(
            "Billing Stats Error:",
            error
        );

        return res.status(500).json({
            message: "Server error.",
        });
    }
};

export const getIncomeMix = async (
    req: Request,
    res: Response
) => {
    try {

        const result = await pool.query(`
            WITH income_data AS (
                SELECT
                    COALESCE(
                        SUM(amount),
                        0
                    ) AS total_income
                FROM billing_payments
                WHERE status IN ('Paid', 'Partial')
            ),

            late_fee_data AS (
                SELECT
                    COALESCE(
                        SUM(late_fee),
                        0
                    ) AS late_fees
                FROM billings
                WHERE status = 'Paid'
            )

            SELECT
                i.total_income,
                l.late_fees
            FROM income_data i
            CROSS JOIN late_fee_data l
        `);

        const row = result.rows[0];

        const totalIncome = Number(row.total_income);
        const lateFees = Number(row.late_fees);

        const roomIncome = Math.max(
            totalIncome - lateFees,
            0
        );

        return res.status(200).json([
            {
                name: "Total Income",
                value: roomIncome,
                color: "#0f172a",
            },
            {
                name: "Late Fees",
                value: lateFees,
                color: "#94a3b8",
            },
        ]);

    } catch (error) {

        console.error(
            "Get Income Mix Error:",
            error
        );

        return res.status(500).json({
            message: "Server error.",
        });
    }
};

export const getRevenueTrend = async (
    req: Request,
    res: Response
) => {
    try {

        const result = await pool.query(`
            WITH months AS (
                SELECT
                    DATE_TRUNC(
                        'month',
                        CURRENT_DATE - (INTERVAL '1 month' * gs)
                    ) AS month_start
                FROM generate_series(5, 0, -1) gs
            )

            SELECT
                TO_CHAR(
                    m.month_start,
                    'Mon'
                ) AS month,

                COALESCE(
                    (
                        SELECT SUM(bp.amount)
                        FROM billing_payments bp
                        WHERE bp.status IN ('Paid', 'Partial')
                        AND DATE_TRUNC(
                            'month',
                            bp.received_at
                        ) = m.month_start
                    ),
                    0
                ) AS income,

                COALESCE(
                    (
                        SELECT SUM(b.late_fee)
                        FROM billings b
                        WHERE b.status = 'Paid'
                        AND DATE_TRUNC(
                            'month',
                            b.updated_at
                        ) = m.month_start
                    ),
                    0
                ) AS late_fees,

                m.month_start AS month_sort

            FROM months m

            ORDER BY month_sort ASC
        `);

        return res.status(200).json(
            result.rows.map(row => ({
                month: row.month.trim(),
                income: Number(row.income),
                lateFees: Number(row.late_fees),
            }))
        );

    } catch (error) {

        console.error(
            "Revenue Trend Error:",
            error
        );

        return res.status(500).json({
            message: "Server error.",
        });
    }
};


export const getDetailedSummary = async (
    req: Request,
    res: Response
) => {
    try {
        const result = await pool.query(`
            WITH current_month AS (
                SELECT
                    COALESCE(
                        SUM(amount),
                        0
                    ) AS total_income
                FROM billing_payments
                WHERE status IN ('Paid', 'Partial')
                AND DATE_TRUNC(
                    'month',
                    received_at
                ) = DATE_TRUNC(
                    'month',
                    CURRENT_DATE
                )
            ),

            previous_month AS (
                SELECT
                    COALESCE(
                        SUM(amount),
                        0
                    ) AS total_income
                FROM billing_payments
                WHERE status IN ('Paid', 'Partial')
                AND DATE_TRUNC(
                    'month',
                    received_at
                ) = DATE_TRUNC(
                    'month',
                    CURRENT_DATE - INTERVAL '1 month'
                )
            ),

            current_late_fees AS (
                SELECT
                    COALESCE(
                        SUM(late_fee),
                        0
                    ) AS late_fees
                FROM billings
                WHERE status = 'Paid'
                AND DATE_TRUNC(
                    'month',
                    updated_at
                ) = DATE_TRUNC(
                    'month',
                    CURRENT_DATE
                )
            ),

            previous_late_fees AS (
                SELECT
                    COALESCE(
                        SUM(late_fee),
                        0
                    ) AS late_fees
                FROM billings
                WHERE status = 'Paid'
                AND DATE_TRUNC(
                    'month',
                    updated_at
                ) = DATE_TRUNC(
                    'month',
                    CURRENT_DATE - INTERVAL '1 month'
                )
            )

            SELECT
                cm.total_income AS current_total_income,
                pm.total_income AS previous_total_income,

                clf.late_fees AS current_late_fees,
                plf.late_fees AS previous_late_fees

            FROM current_month cm
            CROSS JOIN previous_month pm
            CROSS JOIN current_late_fees clf
            CROSS JOIN previous_late_fees plf
        `);

        const data = result.rows[0];

        const calculateChange = (
            current: number,
            previous: number
        ) => {
            if (previous === 0) {
                return current > 0 ? 100 : 0;
            }

            return Number(
                (
                    ((current - previous) /
                        previous) *
                    100
                ).toFixed(2)
            );
        };

        const totalIncomeCurrent =
            Number(data.current_total_income);

        const totalIncomePrevious =
            Number(data.previous_total_income);

        const lateFeesCurrent =
            Number(data.current_late_fees);

        const lateFeesPrevious =
            Number(data.previous_late_fees);

        return res.status(200).json({
            totalIncomeThisMonth:
                totalIncomeCurrent,

            totalIncomeLastMonth:
                totalIncomePrevious,

            totalIncomeChange:
                calculateChange(
                    totalIncomeCurrent,
                    totalIncomePrevious
                ),

            rows: [
                {
                    category: "Total Income",
                    thisMonth:
                        totalIncomeCurrent,
                    lastMonth:
                        totalIncomePrevious,
                    change:
                        calculateChange(
                            totalIncomeCurrent,
                            totalIncomePrevious
                        ),
                    positive:
                        totalIncomeCurrent >=
                        totalIncomePrevious,
                },
                {
                    category: "Late Fees",
                    thisMonth:
                        lateFeesCurrent,
                    lastMonth:
                        lateFeesPrevious,
                    change:
                        calculateChange(
                            lateFeesCurrent,
                            lateFeesPrevious
                        ),
                    positive:
                        lateFeesCurrent >=
                        lateFeesPrevious,
                },
            ],
        });
    } catch (error) {
        console.error(
            "Detailed Summary Error:",
            error
        );

        return res.status(500).json({
            message: "Server error.",
        });
    }
};

export const getCollectionDashboardStats = async (
    req: Request,
    res: Response
) => {
    try {
        const result = await pool.query(`
            WITH current_month AS (
                SELECT
                    COALESCE(SUM(bp.amount),0) AS total_collections,
                    COUNT(bp.id) AS total_transactions,

                    COUNT(DISTINCT b.user_id)
                    FILTER (
                        WHERE b.status = 'Paid'
                    ) AS paid_boarders

                FROM billing_payments bp
                INNER JOIN billings b
                    ON b.id = bp.billing_id

                WHERE bp.status IN ('Paid','Partial')
                AND DATE_TRUNC('month', bp.received_at)
                    = DATE_TRUNC('month', CURRENT_DATE)
            ),

            previous_month AS (
                SELECT
                    COALESCE(SUM(bp.amount),0) AS total_collections,
                    COUNT(bp.id) AS total_transactions,

                    COUNT(DISTINCT b.user_id)
                    FILTER (
                        WHERE b.status = 'Paid'
                    ) AS paid_boarders

                FROM billing_payments bp
                INNER JOIN billings b
                    ON b.id = bp.billing_id

                WHERE bp.status IN ('Paid','Partial')
                AND DATE_TRUNC('month', bp.received_at)
                    = DATE_TRUNC(
                        'month',
                        CURRENT_DATE - INTERVAL '1 month'
                    )
            ),

            collection_rate AS (
                SELECT
                    ROUND(
                        (
                            COALESCE(
                                (
                                    SELECT SUM(amount)
                                    FROM billing_payments
                                    WHERE status IN ('Paid','Partial')
                                    AND DATE_TRUNC('month', received_at)
                                        = DATE_TRUNC('month', CURRENT_DATE)
                                ),
                                0
                            )
                            /
                            NULLIF(
                                (
                                    SELECT SUM(total_amount)
                                    FROM billings
                                    WHERE DATE_TRUNC('month', due_date)
                                        = DATE_TRUNC('month', CURRENT_DATE)
                                ),
                                0
                            )
                        ) * 100,
                        2
                    ) AS rate
            )

            SELECT
                cm.total_collections,
                cm.total_transactions,
                cm.paid_boarders,

                pm.total_collections AS prev_collections,
                pm.total_transactions AS prev_transactions,
                pm.paid_boarders AS prev_paid_boarders,

                cr.rate AS collection_rate

            FROM current_month cm
            CROSS JOIN previous_month pm
            CROSS JOIN collection_rate cr
        `);

        const row = result.rows[0];

        const calculateChange = (
            current: number,
            previous: number
        ) => {
            if (previous === 0) {
                return current > 0 ? 100 : 0;
            }

            return Number(
                (
                    ((current - previous) / previous) *
                    100
                ).toFixed(1)
            );
        };

        const averageCollection =
            Number(row.total_transactions) > 0
                ? Number(row.total_collections) /
                  Number(row.total_transactions)
                : 0;

        return res.status(200).json({
            totalCollections:
                Number(row.total_collections),

            totalCollectionsChange:
                calculateChange(
                    Number(row.total_collections),
                    Number(row.prev_collections)
                ),

            totalTransactions:
                Number(row.total_transactions),

            totalTransactionsChange:
                calculateChange(
                    Number(row.total_transactions),
                    Number(row.prev_transactions)
                ),

            paidBoarders:
                Number(row.paid_boarders),

            paidBoardersChange:
                calculateChange(
                    Number(row.paid_boarders),
                    Number(row.prev_paid_boarders)
                ),

            collectionRate:
                Number(row.collection_rate),

            averageCollection:
                Number(
                    averageCollection.toFixed(2)
                ),
        });

    } catch (error) {

        console.error(
            "Collection Dashboard Stats Error:",
            error
        );

        return res.status(500).json({
            message: "Server error.",
        });
    }
};

export const getCollectionTrend = async (
    req: Request,
    res: Response
) => {
    try {

        const result = await pool.query(`
            WITH months AS (
                SELECT
                    DATE_TRUNC(
                        'month',
                        CURRENT_DATE - (INTERVAL '1 month' * gs)
                    ) AS month_start
                FROM generate_series(5, 0, -1) gs
            )

            SELECT
                TO_CHAR(
                    m.month_start,
                    'Mon'
                ) AS month,

                COALESCE(
                    (
                        SELECT SUM(bp.amount)
                        FROM billing_payments bp
                        WHERE bp.status IN ('Paid','Partial')
                        AND DATE_TRUNC(
                            'month',
                            bp.received_at
                        ) = m.month_start
                    ),
                    0
                ) AS amount,

                m.month_start

            FROM months m

            ORDER BY m.month_start ASC
        `);

        return res.status(200).json(
            result.rows.map(row => ({
                month: row.month.trim(),
                amount: Number(row.amount),
            }))
        );

    } catch (error) {

        console.error(
            "Collection Trend Error:",
            error
        );

        return res.status(500).json({
            message: "Server error.",
        });
    }
};

export const getRecentTransactions = async (
    req: Request,
    res: Response
) => {
    try {

        const result = await pool.query(`
            SELECT

                TO_CHAR(
                    bp.received_at,
                    'Mon DD, YYYY'
                ) AS date,

                b.billing_no AS billing,

                CONCAT(
                    boarder.first_name,
                    ' ',
                    boarder.last_name
                ) AS boarder,

                bp.amount,

                CONCAT(
                    'RCP-',
                    TO_CHAR(
                        bp.received_at,
                        'YYYY'
                    ),
                    '-',
                    LPAD(
                        bp.id::TEXT,
                        6,
                        '0'
                    )
                ) AS ref,

                bp.status

            FROM billing_payments bp

            INNER JOIN billings b
                ON b.id = bp.billing_id

            INNER JOIN users boarder
                ON boarder.id = b.user_id

            WHERE bp.status IN
            (
                'Paid',
                'Partial'
            )

            ORDER BY
                bp.received_at DESC

            LIMIT 10
        `);

        return res.status(200).json(result.rows);

    } catch (error) {

        console.error(
            "Recent Transactions Error:",
            error
        );

        return res.status(500).json({
            message: "Server error."
        });

    }
};

export const getBoarderBillingStatus = async (
    req: Request,
    res: Response
) => {
    try {

        const result = await pool.query(`
            SELECT

                CONCAT(
                    u.first_name,
                    ' ',
                    u.last_name
                ) AS name,

                r.room_number AS room,

                b.billing_no AS billing,

                TO_CHAR(
                    b.due_date,
                    'Mon DD, YYYY'
                ) AS due,

                b.total_amount AS total,

                b.paid_amount AS paid,

                b.balance,

                b.status,

                TO_CHAR(
                    b.updated_at,
                    'Mon DD, YYYY'
                ) AS "paidDate"

            FROM billings b

            INNER JOIN users u
                ON u.id = b.user_id

            LEFT JOIN room_assignments ra
                ON ra.id = b.assignment_id

            LEFT JOIN rooms r
                ON r.id = ra.room_id

            WHERE b.status = 'Paid'

            ORDER BY
                b.updated_at DESC,
                u.last_name ASC
        `);

        return res.status(200).json(result.rows);

    } catch (error) {

        console.error(
            "Boarder Billing Status Error:",
            error
        );

        return res.status(500).json({
            message: "Server error."
        });

    }
};

export const getCollectionSummary = async (
    req: Request,
    res: Response
) => {
    try {

        const result = await pool.query(`
            SELECT

                COALESCE(
                    SUM(bp.amount),
                    0
                ) AS total_collections,

                COUNT(bp.id)
                    AS total_transactions,

                COUNT(DISTINCT b.user_id)
                FILTER (
                    WHERE b.status = 'Paid'
                ) AS paid_boarders,

                ROUND(
                    (
                        COALESCE(
                            SUM(bp.amount),
                            0
                        )
                        /
                        NULLIF(
                            (
                                SELECT SUM(total_amount)
                                FROM billings
                                WHERE DATE_TRUNC(
                                    'month',
                                    due_date
                                ) = DATE_TRUNC(
                                    'month',
                                    CURRENT_DATE
                                )
                            ),
                            0
                        )
                    ) * 100,
                    2
                ) AS collection_rate

            FROM billing_payments bp

            INNER JOIN billings b
                ON b.id = bp.billing_id

            WHERE bp.status IN (
                'Paid',
                'Partial'
            )

            AND DATE_TRUNC(
                'month',
                bp.received_at
            ) = DATE_TRUNC(
                'month',
                CURRENT_DATE
            )
        `);

        const row = result.rows[0];

        return res.status(200).json({
            totalCollections:
                Number(row.total_collections),

            totalTransactions:
                Number(row.total_transactions),

            paidBoarders:
                Number(row.paid_boarders),

            collectionRate:
                Number(row.collection_rate),
        });

    } catch (error) {

        console.error(
            "Collection Summary Error:",
            error
        );

        return res.status(500).json({
            message: "Server error.",
        });
    }
};

export const getMyBoarderReportSummary = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        message: "Unauthorized.",
      });
    }

    const result = await pool.query(
      `
      SELECT
        COALESCE(
          (
            SELECT SUM(bp.amount)
            FROM billing_payments bp
            INNER JOIN billings b
              ON b.id = bp.billing_id
            WHERE b.user_id = $1
            AND bp.status IN ('Paid', 'Partial')
          ),
          0
        ) AS total_payments,

        (
          SELECT MAX(bp.received_at)
          FROM billing_payments bp
          INNER JOIN billings b
            ON b.id = bp.billing_id
          WHERE b.user_id = $1
          AND bp.status IN ('Paid', 'Partial')
        ) AS last_payment_date,

        COALESCE(
          (
            SELECT SUM(b.late_fee)
            FROM billings b
            WHERE b.user_id = $1
          ),
          0
        ) AS total_penalties,

        COALESCE(
          (
            SELECT SUM(b.late_fee)
            FROM billings b
            WHERE b.user_id = $1
            AND b.status IN (
              'Pending',
              'Partial',
              'Overdue'
            )
          ),
          0
        ) AS outstanding_penalties
      `,
      [userId]
    );

    return res.status(200).json({
      summary: {
        total_payments: Number(
          result.rows[0].total_payments
        ),
        last_payment_date:
          result.rows[0].last_payment_date,
        total_penalties: Number(
          result.rows[0].total_penalties
        ),
        outstanding_penalties: Number(
          result.rows[0].outstanding_penalties
        ),
      },
    });
  } catch (error) {
    console.error(
      "Get Boarder Report Summary Error:",
      error
    );

    return res.status(500).json({
      message: "Server error.",
    });
  }
};


export const getMyRecentPayments = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = await pool.query(
      `
      SELECT
          bp.id,
          bp.amount,
          bp.status,
          bp.received_at,

          b.billing_type,
          b.billing_month,

          CONCAT(
              'RCP-',
              TO_CHAR(bp.received_at,'YYYY'),
              '-',
              LPAD(bp.id::TEXT,6,'0')
          ) AS receipt_no

      FROM billing_payments bp

      INNER JOIN billings b
          ON b.id = bp.billing_id

      WHERE b.user_id = $1

      ORDER BY bp.received_at DESC

      LIMIT 5
      `,
      [userId]
    );

    const payments = result.rows.map((row) => ({
      id: row.id,
      date: row.received_at,

      description: `${row.billing_type} - ${new Date(
        row.billing_month
      ).toLocaleString("en-US", {
        month: "short",
        year: "numeric",
      })}`,

      amount: Number(row.amount),

      status: row.status,

      receipt_no: row.receipt_no,
    }));

    return res.status(200).json({
      payments,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Server error.",
    });
  }
};

//======================================================
// Update Billing Information
//======================================================
// Lets staff / admin correct a billing when a mistake was
// made: the schedule, the room fee, the discount and the
// late fee. Utilities / other charges and the paid amount
// are left untouched here.

export const updateBillingInformation = async (
    req: AuthRequest,
    res: Response
) => {

    const client = await pool.connect();

    try {

        const { id } = req.params;

        const {
            billing_type,
            billing_month,
            due_date,
            room_fee,
            discount,
            late_fee,
        } = req.body;

        //--------------------------------------------------
        // Validate input
        //--------------------------------------------------

        if (!due_date) {
            return res.status(400).json({
                message: "Due date is required.",
            });
        }

        const roomFee = Number(room_fee);
        const discountAmount = Number(discount);
        const lateFee = Number(late_fee);

        if (
            [roomFee, discountAmount, lateFee].some(
                (v) => Number.isNaN(v) || v < 0
            )
        ) {
            return res.status(400).json({
                message: "Amounts must be valid non-negative values.",
            });
        }

        await client.query("BEGIN");

        //--------------------------------------------------
        // Get Billing
        //--------------------------------------------------

        const billingResult = await client.query(
            `
            SELECT *
            FROM billings
            WHERE id = $1
            FOR UPDATE
            `,
            [id]
        );

        if (billingResult.rowCount === 0) {

            await client.query("ROLLBACK");

            return res.status(404).json({
                message: "Billing not found.",
            });

        }

        const billing = billingResult.rows[0];

        //--------------------------------------------------
        // Cannot edit Paid / Cancelled billings
        //--------------------------------------------------

        if (
            billing.status === "Paid" ||
            billing.status === "Cancelled"
        ) {

            await client.query("ROLLBACK");

            return res.status(400).json({
                message:
                    "A paid or cancelled billing can no longer be edited.",
            });

        }

        //--------------------------------------------------
        // Recompute totals
        //--------------------------------------------------
        // Utilities / other charges keep their stored values.

        const utilitiesFee = Number(billing.utilities_fee);
        const otherCharges = Number(billing.other_charges);
        const paidAmount = Number(billing.paid_amount);

        const newTotal =
            roomFee +
            utilitiesFee +
            otherCharges -
            discountAmount +
            lateFee;

        if (newTotal < 0) {

            await client.query("ROLLBACK");

            return res.status(400).json({
                message:
                    "Total amount cannot be negative after discount.",
            });

        }

        if (newTotal < paidAmount) {

            await client.query("ROLLBACK");

            return res.status(400).json({
                message:
                    "New total cannot be lower than the amount already paid.",
            });

        }

        const newBalance = newTotal - paidAmount;

        //--------------------------------------------------
        // Determine Status
        //--------------------------------------------------

        let status: string;

        if (newBalance <= 0) {
            status = "Paid";
        }
        else if (billing.status === "Upcoming") {
            status = "Upcoming";
        }
        else if (paidAmount > 0) {
            status = "Partial";
        }
        else if (new Date(due_date) < new Date(new Date().toDateString())) {
            status = "Overdue";
        }
        else {
            status = "Pending";
        }

        //--------------------------------------------------
        // Update Billing
        //--------------------------------------------------

        const result = await client.query(
            `
            UPDATE billings
            SET
                billing_type   = COALESCE($1, billing_type),
                billing_month  = $2,
                due_date       = $3,
                room_fee       = $4,
                discount       = $5,
                late_fee       = $6,
                total_amount   = $7,
                balance        = $8,
                status         = $9,
                updated_at     = NOW()
            WHERE id = $10
            RETURNING *
            `,
            [
                billing_type ?? null,
                billing_month || null,
                due_date,
                roomFee,
                discountAmount,
                lateFee,
                newTotal,
                newBalance,
                status,
                id,
            ]
        );

        await client.query("COMMIT");

        return res.status(200).json({
            message: "Billing information updated successfully.",
            billing: result.rows[0],
        });

    } catch (error) {

        await client.query("ROLLBACK");

        console.error(error);

        return res.status(500).json({
            message: "Server error.",
        });

    } finally {

        client.release();

    }

};