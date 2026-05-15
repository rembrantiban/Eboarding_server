import { Request, Response } from "express";
import { pool } from "../../config/db";
import { AuthRequest } from "../../types/auth";
import { paymentTemplate } from "../../services/paymentEmailTemplate";
import { resend } from "../../config/resend";


export const assignBoarder = async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { user_id, room_id, bed_id } = req.body;

    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const assigned_by = req.user.id;

    const userCheck = await client.query(
      `SELECT user_type, is_assigned FROM users WHERE id = $1`,
      [user_id]
    );

    if (userCheck.rows.length === 0) throw new Error("User not found");
    if (userCheck.rows[0].user_type !== "Boarder")
      throw new Error("User is not a boarder");
    if (userCheck.rows[0].is_assigned)
      throw new Error("User is already assigned");

    const existingBoarder = await client.query(
      `SELECT * FROM boarders 
       WHERE user_id = $1 AND status = 'Active'`,
      [user_id]
    );

    if (existingBoarder.rows.length > 0)
      throw new Error("Boarder already assigned");

    const bedCheck = await client.query(
      `SELECT status FROM beds WHERE id = $1 FOR UPDATE`,
      [bed_id]
    );

    if (bedCheck.rows.length === 0) throw new Error("Bed not found");
    if (bedCheck.rows[0].status !== "Available")
      throw new Error("Bed is already occupied");

    const result = await client.query(
      `INSERT INTO boarders 
      (user_id, room_id, bed_id, assigned_by, status)
      VALUES ($1, $2, $3, $4, 'Active')
      RETURNING *`,
      [user_id, room_id, bed_id, assigned_by]
    );

    const boarder = result.rows[0];

    await client.query(
      `UPDATE users SET is_assigned = TRUE WHERE id = $1`,
      [user_id]
    );

    await client.query(
      `UPDATE beds SET status = 'Occupied' WHERE id = $1`,
      [bed_id]
    );

    const room = await client.query(
      `SELECT price_per_month FROM rooms WHERE id = $1`,
      [room_id]
    );

    const price = room.rows[0].price_per_month;


    const startDate = new Date(boarder.start_date);

    await client.query(
      `DELETE FROM payments 
       WHERE boarder_id = $1 
       AND due_date > NOW()`,
      [boarder.id]
    );

    await client.query(
      `INSERT INTO payments (boarder_id, amount, due_date, status, paid_at)
       VALUES ($1, $2, $3, 'Paid', NOW())`,
      [boarder.id, price, startDate]
    );

    const nextDate = new Date(startDate);
    nextDate.setMonth(nextDate.getMonth() + 1);

    await client.query(
      `INSERT INTO payments (boarder_id, amount, due_date, status)
       VALUES ($1, $2, $3, 'Pending')`,
      [boarder.id, price, nextDate]
    );


    const roomCheck = await client.query(
      `SELECT 
        COUNT(*) FILTER (WHERE status = 'Occupied') AS occupied,
        COUNT(*) AS total
       FROM beds
       WHERE room_id = $1`,
      [room_id]
    );

    const { occupied, total } = roomCheck.rows[0];

    await client.query(
      `UPDATE rooms SET status = $1 WHERE id = $2`,
      [Number(occupied) === Number(total) ? "Full" : "Available", room_id]
    );

    const roomInfo = await client.query(
      `SELECT room_number FROM rooms WHERE id = $1`,
      [room_id]
    );

    const bedInfo = await client.query(
      `SELECT bed_number FROM beds WHERE id = $1`,
      [bed_id]
    );

    await client.query("COMMIT");

    res.json({
      message: "Boarder assigned successfully",
      user_id,
      boarder,
      room_number: roomInfo.rows[0]?.room_number,
      bed_number: bedInfo.rows[0]?.bed_number,
    });

  } catch (error: any) {
    await client.query("ROLLBACK");

    console.error("Assign boarder error:", error);

    res.status(400).json({
      message: error.message || "Server error",
    });

  } finally {
    client.release();
  }
};

export const getAllBoarders = async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT 
        b.id AS boarder_id,
        b.start_date,
        b.status AS boarder_status,

        u.id AS user_id,
        u.first_name,
        u.last_name,
        u.email,
        u.contact_number,

        r.id AS room_id,
        r.room_number,
        r.price_per_month,

        bed.id AS bed_id,
        bed.bed_number,

        a.first_name AS assigned_by_first_name,
        a.last_name AS assigned_by_last_name,

        -- 🔥 NEXT UNPAID PAYMENT
        p.id AS payment_id,
        p.amount,
        p.due_date,
        p.status AS payment_status

      FROM boarders b

      JOIN users u ON b.user_id = u.id
      JOIN rooms r ON b.room_id = r.id
      JOIN beds bed ON b.bed_id = bed.id
      LEFT JOIN users a ON a.id = b.assigned_by
      LEFT JOIN LATERAL (
        SELECT *
        FROM payments p2
        WHERE p2.boarder_id = b.id
        AND p2.status != 'Paid' -- ✅ FIX HERE
        ORDER BY p2.due_date ASC
        LIMIT 1
      ) p ON true

      ORDER BY b.created_at DESC
    `);

    res.json(result.rows);

  } catch (error) {
    console.error("Get boarders error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const notifyBoarderPayment = async (req: Request, res: Response) => {
  const { boarder_id } = req.params;

  try {
    const result = await pool.query(`
      SELECT p.*, u.email, u.first_name, r.room_number, bed.bed_number
      FROM payments p
      JOIN boarders b ON p.boarder_id = b.id
      JOIN users u ON b.user_id = u.id
      JOIN rooms r ON b.room_id = r.id
      JOIN beds bed ON b.bed_id = bed.id
      WHERE p.boarder_id = $1
      AND p.status != 'Paid'
      ORDER BY p.due_date ASC
      LIMIT 1
    `, [boarder_id]);

    const payment = result.rows[0];

    if (!payment) {
      return res.status(404).json({
        message: "No unpaid payment found",
      });
    }

    console.log("PAYMENT:", payment);
    console.log("BOARDER ID:", boarder_id);

    await resend.emails.send({
      from: "E-Boarding <noreply@eboarding.site>",
      to: payment.email,
      subject: "📢 Payment Reminder",
      html: paymentTemplate(
        payment,
        "Payment Reminder",
        "Please settle your payment"
      ),
    });

    res.json({ message: " Notification sent" });

  } catch (error) {
    console.error("Notify error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const removeBoarder = async (req: Request, res: Response) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { boarder_id } = req.params;

    const boarderRes = await client.query(
      `SELECT * FROM boarders WHERE id = $1`,
      [boarder_id]
    );

    if (boarderRes.rows.length === 0) {
      throw new Error("Boarder not found");
    }

    const boarder = boarderRes.rows[0];

    await client.query(
      `DELETE FROM payments 
       WHERE boarder_id = $1 
       AND due_date > NOW()`,
      [boarder_id]
    );

    await client.query(
      `DELETE FROM boarders WHERE id = $1`,
      [boarder_id]
    );

    await client.query(
      `UPDATE beds SET status = 'Available' WHERE id = $1`,
      [boarder.bed_id]
    );

    await client.query(
      `UPDATE users SET is_assigned = FALSE WHERE id = $1`,
      [boarder.user_id]
    );

    const roomCheck = await client.query(
      `SELECT 
        COUNT(*) FILTER (WHERE status = 'Occupied') AS occupied,
        COUNT(*) AS total
       FROM beds
       WHERE room_id = $1`,
      [boarder.room_id]
    );

    const { occupied, total } = roomCheck.rows[0];

    await client.query(
      `UPDATE rooms SET status = $1 WHERE id = $2`,
      [
        Number(occupied) === Number(total) ? "Full" : "Available",
        boarder.room_id,
      ]
    );

    await client.query("COMMIT");

    res.json({
      message: "Boarder removed successfully",
    });

  } catch (error: any) {
    await client.query("ROLLBACK");

    console.error("Remove boarder error:", error);

    res.status(400).json({
      message: error.message || "Server error",
    });

  } finally {
    client.release();
  }
};

export const reassignBoarder = async (req: Request, res: Response) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { boarder_id } = req.params;
    const { room_id, bed_id } = req.body;

    const boarderRes = await client.query(
      `SELECT * FROM boarders WHERE id = $1`,
      [boarder_id]
    );

    if (boarderRes.rows.length === 0) {
      throw new Error("Boarder not found");
    }

    const boarder = boarderRes.rows[0];

    const oldBedId = boarder.bed_id;
    const oldRoomId = boarder.room_id;

    const bedCheck = await client.query(
      `SELECT status FROM beds WHERE id = $1 FOR UPDATE`,
      [bed_id]
    );

    if (bedCheck.rows.length === 0) {
      throw new Error("New bed not found");
    }

    if (bedCheck.rows[0].status !== "Available") {
      throw new Error("New bed is already occupied");
    }

    // 🔴 3. FREE OLD BED
    await client.query(
      `UPDATE beds SET status = 'Available' WHERE id = $1`,
      [oldBedId]
    );

    // 🔴 4. UPDATE BOARDER (REASSIGN)
    await client.query(
      `UPDATE boarders 
       SET room_id = $1, bed_id = $2
       WHERE id = $3`,
      [room_id, bed_id, boarder_id]
    );

    // 🔴 5. OCCUPY NEW BED
    await client.query(
      `UPDATE beds SET status = 'Occupied' WHERE id = $1`,
      [bed_id]
    );

    // 🔴 6. UPDATE OLD ROOM STATUS
    const oldRoomCheck = await client.query(
      `SELECT 
        COUNT(*) FILTER (WHERE status = 'Occupied') AS occupied,
        COUNT(*) AS total
       FROM beds
       WHERE room_id = $1`,
      [oldRoomId]
    );

    const { occupied: oldOcc, total: oldTotal } = oldRoomCheck.rows[0];

    await client.query(
      `UPDATE rooms SET status = $1 WHERE id = $2`,
      [
        Number(oldOcc) === Number(oldTotal) ? "Full" : "Available",
        oldRoomId,
      ]
    );

    const newRoomCheck = await client.query(
      `SELECT 
        COUNT(*) FILTER (WHERE status = 'Occupied') AS occupied,
        COUNT(*) AS total
       FROM beds
       WHERE room_id = $1`,
      [room_id]
    );

    const { occupied: newOcc, total: newTotal } = newRoomCheck.rows[0];

    await client.query(
      `UPDATE rooms SET status = $1 WHERE id = $2`,
      [
        Number(newOcc) === Number(newTotal) ? "Full" : "Available",
        room_id,
      ]
    );

    await client.query("COMMIT");

    res.json({
      message: "Boarder reassigned successfully",
    });

  } catch (error: any) {
    await client.query("ROLLBACK");

    console.error("Reassign boarder error:", error);

    res.status(400).json({
      message: error.message || "Server error",
    });

  } finally {
    client.release();
  }
};

export const getMyBoardingInfo = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const userId = req.user.id;

    const result = await pool.query(`
        SELECT 
          b.id AS boarder_id,
          b.start_date,
          b.status,

          r.room_number,
          r.price_per_month,
          r.description,

          bed.bed_number,

          -- 🔥 GET ALL ROOM IMAGES
          COALESCE(
            (
              SELECT json_agg(ri.image_url)
              FROM room_images ri
              WHERE ri.room_id = r.id
            ),
            '[]'
          ) AS images

        FROM boarders b
        JOIN rooms r ON b.room_id = r.id
        JOIN beds bed ON b.bed_id = bed.id

        WHERE b.user_id = $1
        AND b.status = 'Active'
        LIMIT 1
      `, [userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "No room assigned yet",
      });
    }

    res.json(result.rows[0]);

  } catch (error) {
    console.error("Get my boarding info error:", error);
    res.status(500).json({ message: "Server error" });
  }
};