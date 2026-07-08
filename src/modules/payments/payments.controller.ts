import { Request, Response } from "express";
import { pool } from "../../config/db";
import { resend } from "../../config/resend"
import { paymentTemplate } from "../../services/paymentEmailTemplate";
import { AuthRequest } from "../../types/auth";

export const getPaymentReport = async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT 
        p.id AS payment_id,
        p.boarder_id,              
        p.amount,
        p.due_date,
        p.penalty_amount,
        p.status,
        p.paid_at,

        u.id AS user_id,           
        u.first_name,
        u.last_name,
        u.email,

        r.id AS room_id,          
        r.room_number,
        bed.id AS bed_id,          
        bed.bed_number,

        -- 🔥 optional combined display (very useful for frontend)
        CONCAT('Room ', r.room_number, ' - Bed ', bed.bed_number) AS room_label

      FROM payments p
      JOIN boarders b ON p.boarder_id = b.id
      JOIN users u ON b.user_id = u.id
      JOIN rooms r ON b.room_id = r.id
      JOIN beds bed ON b.bed_id = bed.id

      WHERE p.status IN ('Pending', 'Overdue')

      ORDER BY p.due_date ASC
    `);

    res.json(result.rows);

  } catch (error) {
    console.error("Payment report error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const getReport = async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT 
        p.id AS payment_id,
        p.amount,
        p.due_date,
        p.status,
        p.penalty_amount,
        p.paid_at,

        u.first_name,
        u.last_name,
        u.email,

        r.room_number,
        bed.bed_number
      
      FROM payments p
      JOIN boarders b ON p.boarder_id = b.id
      JOIN users u ON b.user_id = u.id
      JOIN rooms r ON b.room_id = r.id
      JOIN beds bed ON b.bed_id = bed.id

      WHERE p.status = 'Paid'
      AND p.paid_at IS NOT NULL
      ORDER BY p.due_date ASC
    `);

    res.json(result.rows);

  } catch (error) {
    console.error("Payment report error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const sendPaymentReminders = async () => {
  try {

    await pool.query(`
      UPDATE payments
      SET 
        status = 'Overdue',
        penalty_amount = 100
      WHERE 
        status = 'Pending'
        AND DATE(due_date) < CURRENT_DATE - INTERVAL '7 days'
        AND penalty_amount = 0
    `);

    const oneDayBefore = await pool.query(`
      SELECT p.*, u.email, u.first_name, r.room_number, bed.bed_number
      FROM payments p
      JOIN boarders b ON p.boarder_id = b.id
      JOIN users u ON b.user_id = u.id
      JOIN rooms r ON b.room_id = r.id
      JOIN beds bed ON b.bed_id = bed.id
      WHERE 
        p.status = 'Pending'
        AND p.reminder_1day_sent = FALSE
        AND DATE(p.due_date) = CURRENT_DATE + INTERVAL '1 day'
    `);

    console.log("1-day:", oneDayBefore.rows.length);

    for (const p of oneDayBefore.rows) {
      console.log(`📧 Sending (1-day) to ${p.email}`);

      await resend.emails.send({
        from: "E-Boarding <noreply@eboarding.site>",
        to: p.email,
        subject: "⏰ Payment Due Tomorrow",
        html: paymentTemplate(p, "Payment Reminder", "Your due date is tomorrow"),
      });

      await new Promise((r) => setTimeout(r, 600));

      await pool.query(
        `UPDATE payments SET reminder_1day_sent = TRUE WHERE id = $1`,
        [p.id]
      );

    }

    const dueToday = await pool.query(`
      SELECT p.*, u.email, u.first_name, r.room_number, bed.bed_number
      FROM payments p
      JOIN boarders b ON p.boarder_id = b.id
      JOIN users u ON b.user_id = u.id
      JOIN rooms r ON b.room_id = r.id
      JOIN beds bed ON b.bed_id = bed.id
      WHERE 
        p.status = 'Pending'
        AND p.reminder_due_sent = FALSE
        AND DATE(p.due_date) = CURRENT_DATE
    `);

    console.log("due today:", dueToday.rows.length);

    for (const p of dueToday.rows) {
      console.log(`📧 Sending (today) to ${p.email}`);


      const response = await resend.emails.send({
        from: "E-Boarding <noreply@eboarding.site>",
        to: p.email,
        subject: "📅 Payment Due Today",
        html: paymentTemplate(p, "Payment Due Today", "Please pay today"),
      });

      if (response.error) {
        console.error(` Email failed for ${p.email}:`, response.error);
      } else {
        console.log(` Email sent to ${p.email}`, response.data?.id);
      }

      console.log("RESEND RESPONSE:", response);

      await pool.query(
        `UPDATE payments SET reminder_due_sent = TRUE WHERE id = $1`,
        [p.id]
      );

      await new Promise((resolve) => setTimeout(resolve, 600));
    }

    const overdue = await pool.query(`
    SELECT 
      p.*,
      u.email,
      u.first_name,
      r.room_number,
      bed.bed_number,

      -- 🔥 CALCULATED WEEKS OVERDUE
      FLOOR((CURRENT_DATE - DATE(p.due_date)) / 7) AS weeks_overdue,

      -- 🔥 WEEKLY PENALTY (₱100 per week)
      FLOOR((CURRENT_DATE - DATE(p.due_date)) / 7) * 100 AS computed_penalty

    FROM payments p
    JOIN boarders b ON p.boarder_id = b.id
    JOIN users u ON b.user_id = u.id
    JOIN rooms r ON b.room_id = r.id
    JOIN beds bed ON b.bed_id = bed.id

    WHERE 
      p.status != 'Paid'                     
      AND DATE(p.due_date) < CURRENT_DATE    
      AND p.reminder_overdue_sent = FALSE
  `);

    console.log("overdue:", overdue.rows.length);

    for (const p of overdue.rows) {
      console.log(`📧 Sending (overdue) to ${p.email}`);

      await resend.emails.send({
        from: "E-Boarding <noreply@eboarding.site>",
        to: p.email,
        subject: "🚨 Payment Overdue",
        html: paymentTemplate(p, "Payment Overdue", "Your payment is overdue. To avoid additional charges, please settle your balance immediately. A penalty of ₱100 is applied for every week of delay."),
      });

      await pool.query(
        `UPDATE payments 
         SET reminder_overdue_sent = TRUE, status = 'Overdue'
         WHERE id = $1`,
        [p.id]
      );
    }

    console.log("✅ Payment reminders processed");

  } catch (error) {
    console.error("Reminder error:", error);
  }
};

export const markPaymentAsPaid = async (req: Request, res: Response) => {
  const { payment_id } = req.params;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const paymentRes = await client.query(
      `SELECT * FROM payments WHERE id = $1`,
      [payment_id]
    );

    const payment = paymentRes.rows[0];

    if (!payment) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Payment not found" });
    }

    if (payment.status === "Paid") {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Already paid" });
    }

    await client.query(
      `UPDATE payments 
       SET status = 'Paid', paid_at = NOW()
       WHERE id = $1`,
      [payment_id]
    );

    const latestPaymentRes = await client.query(
      `SELECT due_date 
       FROM payments
       WHERE boarder_id = $1
       ORDER BY due_date DESC
       LIMIT 1`,
      [payment.boarder_id]
    );

    const baseDate = latestPaymentRes.rows[0].due_date;

    const nextDueRes = await client.query(
      `SELECT (DATE($1) + INTERVAL '1 month') AS next_due`,
      [baseDate]
    );

    const nextDueDate = nextDueRes.rows[0].next_due;

    console.log("OLD DUE:", payment.due_date);
    console.log("LATEST DUE:", baseDate);
    console.log("NEXT DUE:", nextDueDate);

    await client.query(
      `INSERT INTO payments (
        boarder_id,
        amount,
        due_date,
        status,
        penalty_amount,
        reminder_1day_sent,
        reminder_due_sent,
        reminder_overdue_sent
      )
      VALUES ($1, $2, $3, 'Pending', 0, FALSE, FALSE, FALSE)`,
      [
        payment.boarder_id,
        payment.amount,
        nextDueDate,
      ]
    );

    await client.query("COMMIT");

    res.json({
      message: "✅ Payment marked as paid & next billing created",
      next_due: nextDueDate,
    });

  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Mark paid error:", error);
    res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
};


export const getCalendarPayments = async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT 
        p.id,
        p.amount,
        p.due_date,
        p.status,

        u.first_name,
        u.last_name,

        r.room_number

      FROM payments p
      JOIN boarders b ON p.boarder_id = b.id
      JOIN users u ON b.user_id = u.id
      JOIN rooms r ON b.room_id = r.id

      ORDER BY p.due_date ASC
    `);

    const events = result.rows.map((p) => {
      let color = "#3b82f6"; // default (blue)

      if (p.status === "Overdue") color = "#ef4444";
      else if (p.status === "Pending") color = "#f59e0b";
      else if (p.status === "Paid") color = "#22c55e";

      return {
        id: p.id,
        title: `${p.first_name} — ₱${Number(p.amount).toLocaleString()}`,
        date: p.due_date,
        color,
        extendedProps: {
          name: `${p.first_name} ${p.last_name}`,
          room: `Room ${p.room_number}`,
          status: p.status,
          amount: p.amount,
        },
      };
    });

    res.json(events);

  } catch (error) {
    console.error("Calendar error:", error);
    res.status(500).json({ message: "Server error" });
  }
};


export const getMyPaidPayments = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user_id = req.user.id;

    const result = await pool.query(`
      SELECT 
        p.id AS payment_id,
        p.amount,
        p.due_date,
        p.penalty_amount,
        p.status,
        p.paid_at,

        u.first_name,
        u.last_name,
        u.email,

        r.room_number,
        bed.bed_number
      
      FROM payments p
      JOIN boarders b ON p.boarder_id = b.id
      JOIN users u ON b.user_id = u.id
      JOIN rooms r ON b.room_id = r.id
      JOIN beds bed ON b.bed_id = bed.id

      WHERE u.id = $1
      AND p.status = 'Paid' -- 🔥 ONLY PAID

      ORDER BY p.paid_at DESC
    `, [user_id]);

    res.json(result.rows);

  } catch (error) {
    console.error("User payment history error:", error);
    res.status(500).json({ message: "Server error" });
  }
};


export const getPaymentAnalytics = async (
  req: Request,
  res: Response
) => {
  try {

    const result = await pool.query(`
      WITH current_month AS (
        SELECT
          status,
          COALESCE(SUM(amount + penalty_amount), 0) AS total,
          COUNT(*) AS count
        FROM payments
        WHERE DATE_TRUNC('month', due_date)
          = DATE_TRUNC('month', CURRENT_DATE)
        GROUP BY status
      ),

      previous_month AS (
        SELECT
          status,
          COALESCE(SUM(amount + penalty_amount), 0) AS total,
          COUNT(*) AS count
        FROM payments
        WHERE DATE_TRUNC('month', due_date)
          = DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
        GROUP BY status
      )

      SELECT
        COALESCE(c.status, p.status) AS name,

        COALESCE(c.total, 0) AS current,
        COALESCE(p.total, 0) AS previous,

        COALESCE(c.count, 0) AS count,
        COALESCE(p.count, 0) AS "prevCount"

      FROM current_month c
      FULL OUTER JOIN previous_month p
        ON c.status = p.status
    `);

    const formatted = result.rows.map((row) => ({
      name: row.name,
      current: Number(row.current),
      previous: Number(row.previous),
      count: Number(row.count),
      prevCount: Number(row.prevCount),
    }));

    res.json(formatted);

  } catch (error) {
    console.error("Analytics error:", error);

    res.status(500).json({
      message: "Server error",
    });
  }
};

export const getRevenueDashboard = async (
  req: Request,
  res: Response
) => {
  try {

    const monthlyRevenue = await pool.query(`
      SELECT
        TO_CHAR(p.paid_at, 'Mon') AS month,
        COALESCE(SUM(p.amount + p.penalty_amount), 0) AS revenue

      FROM payments p

      WHERE p.status = 'Paid'
      AND p.paid_at IS NOT NULL

      GROUP BY DATE_TRUNC('month', p.paid_at),
               TO_CHAR(p.paid_at, 'Mon')

      ORDER BY DATE_TRUNC('month', p.paid_at)
    `)

    const totalRevenue = await pool.query(`
      SELECT
        COALESCE(SUM(amount + penalty_amount), 0) AS total
      FROM payments
      WHERE status = 'Paid'
    `)

    const paidUsersCount = await pool.query(`
      SELECT COUNT(DISTINCT boarder_id) AS total
      FROM payments
      WHERE status = 'Paid'
    `)

    const recentPaidUsers = await pool.query(`
      SELECT
        u.first_name,
        u.last_name,

        p.amount,

        r.room_number,
        bed.bed_number,

        p.paid_at

      FROM payments p

      JOIN boarders b
        ON p.boarder_id = b.id

      JOIN users u
        ON b.user_id = u.id

      JOIN rooms r
        ON b.room_id = r.id

      JOIN beds bed
        ON b.bed_id = bed.id

      WHERE p.status = 'Paid'

      ORDER BY p.paid_at DESC

      LIMIT 5
    `)

    res.json({
      revenue: monthlyRevenue.rows.map((r) => ({
        month: r.month,
        revenue: Number(r.revenue),
      })),

      totalRevenue: Number(
        totalRevenue.rows[0].total
      ),

      paidUsers: Number(
        paidUsersCount.rows[0].total
      ),

      recentPaidUsers: recentPaidUsers.rows.map((u) => ({
        name: `${u.first_name} ${u.last_name}`,
        amount: Number(u.amount),
        room: `Room ${u.room_number}`,
        bed:  u.bed_number,
        paid_at: u.paid_at,
      })),
    })

  } catch (error) {

    console.error(
      "Revenue dashboard error:",
      error
    )

    res.status(500).json({
      message: "Server error",
    })
  }
}

export const getMyUpcomingPayment = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const userId = req.user.id;

    const result = await pool.query(
      `
      SELECT
        p.id,
        p.amount,
        p.due_date,
        p.status,
        p.penalty_amount,

        r.room_number,
        bed.bed_number

      FROM payments p

      JOIN boarders b
        ON p.boarder_id = b.id

      JOIN users u
        ON b.user_id = u.id

      JOIN rooms r
        ON b.room_id = r.id

      JOIN beds bed
        ON b.bed_id = bed.id

      WHERE
        u.id = $1
        AND p.status IN ('Pending', 'Overdue')

      ORDER BY p.due_date ASC

      LIMIT 1
      `,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({
        hasUpcomingPayment: false,
      });
    }

    const payment = result.rows[0];

    // Normalize dates
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dueDate = new Date(payment.due_date);
    dueDate.setHours(0, 0, 0, 0);

    const daysLeft = Math.ceil(
      (dueDate.getTime() - today.getTime()) /
      (1000 * 60 * 60 * 24)
    );

    let paymentState: "Upcoming" | "Due Today" | "Overdue";

    if (daysLeft < 0) {
      paymentState = "Overdue";
    } else if (daysLeft === 0) {
      paymentState = "Due Today";
    } else {
      paymentState = "Upcoming";
    }

    const amount = Number(payment.amount);
    const penalty = Number(payment.penalty_amount);

    res.json({
      hasUpcomingPayment: true,

      payment: {
        payment_id: payment.id,

        label: "Monthly Rent",

        room: payment.room_number,
        bed: payment.bed_number,

        amount,
        penalty,
        totalAmount: amount + penalty,

        dueDate: payment.due_date,

        daysLeft,

        paymentState,

        status: payment.status,
      },
    });

  } catch (error) {
    console.error("Upcoming payment error:", error);

    res.status(500).json({
      message: "Server error",
    });
  }
};


export const getMyRecentPayments = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const userId = req.user.id;

    const result = await pool.query(
      `
      SELECT
        p.id,
        p.amount,
        p.penalty_amount,
        p.paid_at,
        p.due_date,
        p.status

      FROM payments p

      JOIN boarders b
        ON p.boarder_id = b.id

      JOIN users u
        ON b.user_id = u.id

      WHERE
        u.id = $1
        AND p.status = 'Paid'

      ORDER BY p.paid_at DESC

      LIMIT 5
      `,
      [userId]
    );

    const payments = result.rows.map((payment) => ({
      payment_id: payment.id,

      month: new Date(payment.due_date).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      }),

      amount: Number(payment.amount),

      penalty: Number(payment.penalty_amount),

      totalAmount:
        Number(payment.amount) +
        Number(payment.penalty_amount),

      paidDate: payment.paid_at,

      status: payment.status,
    }));

    res.json(payments);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      message: "Server error",
    });

  }
};