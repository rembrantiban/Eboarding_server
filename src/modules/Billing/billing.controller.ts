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

        const {
            amount,
        } = req.body;

        if (!amount || Number(amount) <= 0) {
            return res.status(400).json({
                message: "Payment amount is required.",
            });
        }

        await client.query("BEGIN");



        const billingResult = await client.query(
            `
            SELECT
                b.*,
                ra.room_id
            FROM billings b
            LEFT JOIN room_assignments ra
                ON ra.id = b.assignment_id
            WHERE b.id = $1
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
        // Validate Amount
        //----------------------------------------------------

        if (Number(amount) > Number(billing.balance)) {

            await client.query("ROLLBACK");

            return res.status(400).json({
                message: `Payment exceeds remaining balance of ₱${billing.balance}.`,
            });

        }

        //----------------------------------------------------
        // Compute
        //----------------------------------------------------

        const paidAmount =
            Number(billing.paid_amount) +
            Number(amount);

        const balance =
            Number(billing.total_amount) -
            paidAmount;

        let status = "Pending";

        if (balance <= 0) {
            status = "Paid";
        }
        else if (paidAmount > 0) {
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

        //----------------------------------------------------
        // Create Next Month Billing
        //----------------------------------------------------

        if (status === "Paid") {

            const nextMonth =
                new Date(billing.billing_month);

            nextMonth.setMonth(
                nextMonth.getMonth() + 1
            );

            await createMonthlyBilling(client, {
                userId: billing.user_id,
                assignmentId: billing.assignment_id,
                roomId: billing.room_id,
                billingMonth: nextMonth,
            });

        }

        //----------------------------------------------------
        // Commit
        //----------------------------------------------------

        await client.query("COMMIT");

        return res.status(200).json({
            message: status === "Paid"
                ? "Payment completed successfully."
                : "Partial payment recorded successfully.",
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