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
            billing.status === "Cancelled" ||
            billing.status === "Upcoming"
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
          TO_CHAR(bp.received_at, 'Mon DD') AS date,
          SUM(bp.amount) AS value

      FROM billing_payments bp

      WHERE
          DATE_TRUNC('month', bp.received_at) =
          DATE_TRUNC('month', CURRENT_DATE)

      GROUP BY
          DATE(bp.received_at),
          TO_CHAR(bp.received_at, 'Mon DD')

      ORDER BY
          DATE(bp.received_at)
    `);

        return res.status(200).json(result.rows);

    } catch (error) {

        console.error("Payments Overview:", error);

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
                    COALESCE(SUM(bp.amount), 0) AS total_income,

                    COALESCE(
                        SUM(
                            CASE
                                WHEN bp.status IN ('Paid', 'Partial')
                                THEN bp.amount
                                ELSE 0
                            END
                        ),
                        0
                    ) AS collected_this_month,

                    COALESCE(SUM(b.late_fee), 0) AS late_fees_collected

                FROM billing_payments bp
                LEFT JOIN billings b
                    ON b.id = bp.billing_id

                WHERE DATE_TRUNC('month', bp.received_at) =
                      DATE_TRUNC('month', CURRENT_DATE)
            ),

            previous_month AS (
                SELECT
                    COALESCE(SUM(bp.amount), 0) AS total_income,

                    COALESCE(
                        SUM(
                            CASE
                                WHEN bp.status IN ('Paid', 'Partial')
                                THEN bp.amount
                                ELSE 0
                            END
                        ),
                        0
                    ) AS collected_this_month,

                    COALESCE(SUM(b.late_fee), 0) AS late_fees_collected

                FROM billing_payments bp
                LEFT JOIN billings b
                    ON b.id = bp.billing_id

                WHERE DATE_TRUNC('month', bp.received_at) =
                      DATE_TRUNC(
                          'month',
                          CURRENT_DATE - INTERVAL '1 month'
                      )
            ),

            current_collection_rate AS (
                SELECT
                    ROUND(
                        (
                            SUM(paid_amount) /
                            NULLIF(SUM(total_amount), 0)
                        ) * 100,
                        2
                    ) AS rate
                FROM billings
                WHERE status <> 'Cancelled'
            ),

            previous_collection_rate AS (
                SELECT
                    ROUND(
                        (
                            SUM(
                                CASE
                                    WHEN updated_at <
                                    DATE_TRUNC('month', CURRENT_DATE)
                                    THEN paid_amount
                                    ELSE 0
                                END
                            )
                            /
                            NULLIF(
                                SUM(
                                    CASE
                                        WHEN updated_at <
                                        DATE_TRUNC('month', CURRENT_DATE)
                                        THEN total_amount
                                        ELSE 0
                                    END
                                ),
                                0
                            )
                        ) * 100,
                        2
                    ) AS rate
                FROM billings
                WHERE status <> 'Cancelled'
            )

            SELECT
                cm.total_income,
                cm.collected_this_month,
                cm.late_fees_collected,

                pm.total_income AS previous_income,
                pm.collected_this_month AS previous_collected,
                pm.late_fees_collected AS previous_late_fees,

                ccr.rate AS collection_rate,
                pcr.rate AS previous_collection_rate

            FROM current_month cm
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
            totalIncome: Number(stats.total_income),

            totalIncomeChange:
                calculateChange(
                    Number(stats.total_income),
                    Number(stats.previous_income)
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
                Number(stats.collection_rate),

            collectionRateChange:
                calculateChange(
                    Number(stats.collection_rate),
                    Number(stats.previous_collection_rate)
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
            SELECT
                COALESCE(SUM(room_fee), 0) AS room_fees,
                COALESCE(SUM(late_fee), 0) AS late_fees

            FROM billings

            WHERE status = 'Paid'
        `);

        const row = result.rows[0];

        const incomeMix = [
            {
                name: "Room fees",
                value: Number(row.room_fees),
                color: "#0f172a",
            },
            {
                name: "Late fees",
                value: Number(row.late_fees),
                color: "#94a3b8",
            },
        ];

        return res.status(200).json(incomeMix);

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
            SELECT
                TO_CHAR(
                    DATE_TRUNC('month', bp.received_at),
                    'Mon'
                ) AS month,

                COALESCE(
                    SUM(
                        CASE
                            WHEN bp.status IN ('Paid', 'Partial')
                            THEN bp.amount
                            ELSE 0
                        END
                    ),
                    0
                ) AS income,

                COALESCE(
                    SUM(b.late_fee),
                    0
                ) AS late_fees,

                DATE_TRUNC(
                    'month',
                    bp.received_at
                ) AS month_sort

            FROM billing_payments bp

            INNER JOIN billings b
                ON b.id = bp.billing_id

            WHERE bp.received_at >=
                DATE_TRUNC(
                    'month',
                    CURRENT_DATE - INTERVAL '5 months'
                )

            GROUP BY
                DATE_TRUNC('month', bp.received_at)

            ORDER BY
                month_sort ASC
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