import { Request, Response } from "express";
import { pool } from "../../config/db";

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