import { Request, Response } from "express"
import { pool } from "../../config/db"
import { AuthRequest } from "../../types/auth";
import { updateRoomStatus } from "./roomAssignment.helper";
import { createMonthlyBilling } from "../Billing/billing.helper";


export const assignRoom = async (
  req: AuthRequest,
  res: Response
) => {
  const client = await pool.connect();

  console.log("===== ASSIGN ROOM CONTROLLER =====");
  console.log(req.method, req.originalUrl);

  try {
    const {
      user_id,
      room_id,
      bed_id,
      expected_checkout,
      remarks,
    } = req.body;

    const assigned_by = req.user?.id;

    if (!user_id || !room_id || !bed_id) {
      return res.status(400).json({
        message: "User, room and bed are required.",
      });
    }

    await client.query("BEGIN");

    // ============================
    // CHECK USER
    // ============================

    const userResult = await client.query(
      `
      SELECT id, is_assigned
      FROM users
      WHERE id = $1
      `,
      [user_id]
    );

    if (userResult.rowCount === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        message: "User not found.",
      });
    }

    if (userResult.rows[0].is_assigned) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        message: "User is already assigned to a room.",
      });
    }

    // ============================
    // CHECK ROOM
    // ============================

    const roomResult = await client.query(
      `
      SELECT *
      FROM rooms
      WHERE id = $1
      `,
      [room_id]
    );

    if (roomResult.rowCount === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        message: "Room not found.",
      });
    }

    if (roomResult.rows[0].status === "Under Maintenance") {
      await client.query("ROLLBACK");

      return res.status(400).json({
        message: "Room is currently under maintenance.",
      });
    }

    // ============================
    // CHECK BED
    // ============================

    const bedResult = await client.query(
      `
      SELECT *
      FROM beds
      WHERE id = $1
      AND room_id = $2
      `,
      [bed_id, room_id]
    );

    if (bedResult.rowCount === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        message: "Selected bed does not belong to this room.",
      });
    }

    if (bedResult.rows[0].status === "Occupied") {
      await client.query("ROLLBACK");

      return res.status(400).json({
        message: "Bed is already occupied.",
      });
    }

    // ============================
    // CHECK ACTIVE ASSIGNMENT
    // ============================

    const activeAssignment = await client.query(
      `
      SELECT id
      FROM room_assignments
      WHERE user_id = $1
      AND status = 'Active'
      `,
      [user_id]
    );

    if (activeAssignment.rowCount! > 0) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        message: "User already has an active room assignment.",
      });
    }

    // ============================
    // CREATE ASSIGNMENT
    // ============================

    const assignmentResult = await client.query(
      `
      INSERT INTO room_assignments
      (
          user_id,
          room_id,
          bed_id,
          expected_checkout,
          assigned_by,
          remarks
      )
      VALUES
      ($1,$2,$3,$4,$5,$6)
      RETURNING *
      `,
      [
        user_id,
        room_id,
        bed_id,
        expected_checkout ?? null,
        assigned_by ?? null,
        remarks ?? null,
      ]
    );

    const assignment = assignmentResult.rows[0];

    // ============================
    // UPDATE USER
    // ============================

    await client.query(
      `
      UPDATE users
      SET is_assigned = TRUE
      WHERE id = $1
      `,
      [user_id]
    );

    // ============================
    // UPDATE BED
    // ============================

    await client.query(
      `
      UPDATE beds
      SET status = 'Occupied'
      WHERE id = $1
      `,
      [bed_id]
    );

    // ============================
    // UPDATE ROOM STATUS
    // ============================

    await updateRoomStatus(client, room_id);

    // ============================
    // CREATE INITIAL BILLING
    // ============================

    await createMonthlyBilling(client, {
      userId: user_id,
      assignmentId: assignment.id,
      roomId: room_id,
      bedId: bed_id,
    });

    // ============================
    // COMMIT
    // ============================

    await client.query("COMMIT");



    const assignmentDetails = await client.query(
      `
        SELECT
            ra.id,
            ra.user_id,
            ra.room_id,
            ra.bed_id,
            ra.status,
            ra.assigned_date,
            ra.expected_checkout,
            ra.actual_checkout,
            ra.remarks,

            u.first_name,
            u.last_name,
            u.email,

            r.room_number,

            b.bed_number

        FROM room_assignments ra

        JOIN users u
            ON u.id = ra.user_id

        JOIN rooms r
            ON r.id = ra.room_id

        JOIN beds b
            ON b.id = ra.bed_id

        WHERE ra.id = $1
        `,
      [assignment.id]
    );

    return res.status(201).json({
      message: "Room assigned successfully.",
      assignment: assignmentDetails.rows[0],
    });

  } catch (error) {

    await client.query("ROLLBACK");

    console.error("Assign room error:", error);

    return res.status(500).json({
      message: "Server error.",
    });

  } finally {

    client.release();

  }
};

export const transferAssignment = async (
  req: AuthRequest,
  res: Response
) => {
  const client = await pool.connect();

  try {

    const { id } = req.params;

    const {
      room_id,
      bed_id,
      expected_checkout,
      remarks,
    } = req.body;

    const assigned_by = req.user?.id;

    await client.query("BEGIN");

    const currentAssignment =
      await client.query(
        `
        SELECT *
        FROM room_assignments
        WHERE
            id=$1
        AND
            status='Active'
        `,
        [id]
      );

    if (currentAssignment.rowCount === 0) {

      await client.query("ROLLBACK");

      return res.status(404).json({
        message: "Assignment not found.",
      });

    }

    const current = currentAssignment.rows[0];


    const bed = await client.query(
      `
      SELECT *
      FROM beds
      WHERE
          id=$1
      AND
          room_id=$2
      `,
      [bed_id, room_id]
    );

    if (bed.rowCount === 0) {

      await client.query("ROLLBACK");

      return res.status(404).json({
        message: "Bed not found.",
      });

    }

    if (bed.rows[0].status === "Occupied") {

      await client.query("ROLLBACK");

      return res.status(400).json({
        message: "Bed already occupied.",
      });

    }

    await client.query(
      `
      UPDATE room_assignments
      SET
          status='Transferred',
          actual_checkout=NOW()
      WHERE id=$1
      `,
      [id]
    );



    await client.query(
      `
      UPDATE beds
      SET status='Available'
      WHERE id=$1
      `,
      [current.bed_id]
    );

    await client.query(
      `
      UPDATE beds
      SET status='Occupied'
      WHERE id=$1
      `,
      [bed_id]
    );

    await updateRoomStatus(client, current.room_id);

    if (current.room_id !== room_id) {
      await updateRoomStatus(client, room_id);
    }


    const newAssignmentResult =
      await client.query(
        `
    INSERT INTO room_assignments
    (
        user_id,
        room_id,
        bed_id,
        expected_checkout,
        assigned_by,
        remarks
    )
    VALUES
    ($1,$2,$3,$4,$5,$6)
    RETURNING *
    `,
        [
          current.user_id,
          room_id,
          bed_id,
          expected_checkout ?? null,
          assigned_by ?? null,
          remarks ?? null,
        ]
      );

    const newAssignment = newAssignmentResult.rows[0];

    const roomResult = await client.query(
      `
    SELECT price_per_month
    FROM rooms
    WHERE id = $1
    `,
      [room_id]
    );

    if (roomResult.rowCount === 0) {
      throw new Error("Room not found.");
    }

    const roomFee = Number(roomResult.rows[0].price_per_month);

    // ============================
    // FIND CURRENT UNPAID BILLING
    // ============================

    const billingResult = await client.query(
      `
      SELECT
          id,
          paid_amount,
          utilities_fee,
          other_charges,
          discount,
          late_fee
      FROM billings
      WHERE
          assignment_id = $1
      AND
          status IN ('Pending', 'Partial')
      ORDER BY created_at DESC
      LIMIT 1
  `,
      [current.id]
    );

    // ============================
    // MOVE BILLING TO NEW ASSIGNMENT
    // ============================

    if (billingResult.rowCount! > 0) {

      const billing = billingResult.rows[0];

      const totalAmount =
        roomFee +
        Number(billing.utilities_fee) +
        Number(billing.other_charges) +
        Number(billing.late_fee) -
        Number(billing.discount);

      const balance =
        totalAmount - Number(billing.paid_amount);

      let status = "Pending";

      if (balance <= 0) {
        status = "Paid";
      } else if (Number(billing.paid_amount) > 0) {
        status = "Partial";
      }

      await client.query(
        `
    UPDATE billings
    SET
        assignment_id = $1,
        room_number = $2,
        bed_number = $3,
        room_fee = $4,
        total_amount = $5,
        balance = $6,
        status = $7,
        updated_at = NOW()
    WHERE id = $8
    `,
        [
          newAssignment.id,
          roomFee,
          totalAmount,
          balance,
          status,
          billing.id,
        ]
      );

    }

    await client.query("COMMIT");

    return res.json({
      message: "Boarder transferred successfully.",
      assignment: newAssignment,
    });



  } catch (err) {

    await client.query("ROLLBACK");

    console.error(err);

    return res.status(500).json({
      message: "Server error.",
    });

  } finally {

    client.release();

  }
};
export const getAssignedBoarders = async (
  req: Request,
  res: Response
) => {
  console.log("===== GET ASSIGNED BOARDERS =====");
  console.log(req.method, req.originalUrl);

  try {
    const result = await pool.query(
      `
      SELECT
          u.id,
          u.user_id_no,
          u.first_name,
          u.last_name,
          u.email,
          u.contact_number,
          u.avatar_url,

          ra.id AS assignment_id,
          ra.assigned_date,
          ra.expected_checkout,
          ra.status,

          r.id AS room_id,
          r.room_number,

          b.id AS bed_id,
          b.bed_number

      FROM users u

      INNER JOIN room_assignments ra
          ON ra.user_id = u.id
          AND ra.status = 'Active'

      INNER JOIN rooms r
          ON r.id = ra.room_id

      INNER JOIN beds b
          ON b.id = ra.bed_id

      WHERE
          u.user_type = 'Boarder'
      AND
          u.is_assigned = TRUE

      ORDER BY
          u.first_name ASC;
      `
    );

    return res.status(200).json(result.rows);

  } catch (error) {
    console.error(error);

    if (error instanceof Error) {
      return res.status(500).json({
        message: error.message,
      });
    }

    return res.status(500).json({
      message: "Server error.",
    });
  }
};

export const getBoarderAssignedRoom = async (
  req: Request,
  res: Response
) => {

  try {

    const { id } = req.params;

    const result = await pool.query(
      `
            SELECT

                ra.id AS assignment_id,
                ra.assigned_date,
                ra.expected_checkout,
                ra.actual_checkout,
                ra.status,
                ra.remarks,

                -- Boarder
                u.id AS user_id,
                u.user_id_no,
                u.first_name,
                u.last_name,
                u.email,
                u.contact_number,
                u.avatar_url,

                -- Room
                r.id AS room_id,
                r.room_number,
                r.price_per_month,
                r.capacity,
                r.status AS room_status,

                -- Bed
                b.id AS bed_id,
                b.bed_number,
                b.status AS bed_status,

                -- Room Images
                COALESCE(
                    JSON_AGG(
                        DISTINCT ri.image_url
                    ) FILTER (
                        WHERE ri.id IS NOT NULL
                    ),
                    '[]'
                ) AS room_images,

                -- Assigned By
                assigner.id AS assigned_by_id,
                assigner.first_name AS assigned_by_first_name,
                assigner.last_name AS assigned_by_last_name

            FROM room_assignments ra

            INNER JOIN users u
                ON u.id = ra.user_id

            INNER JOIN rooms r
                ON r.id = ra.room_id

            INNER JOIN beds b
                ON b.id = ra.bed_id

            LEFT JOIN room_images ri
                ON ri.room_id = r.id

            LEFT JOIN users assigner
                ON assigner.id = ra.assigned_by

            WHERE
                ra.user_id = $1
                AND ra.status = 'Active'

            GROUP BY
                ra.id,
                u.id,
                r.id,
                b.id,
                assigner.id

            LIMIT 1
            `,
      [id]
    );

    if (result.rowCount === 0) {

      return res.status(404).json({
        message: "Boarder has no active room assignment.",
      });

    }

    return res.status(200).json(result.rows[0]);

  } catch (error) {

    console.error(
      "Get Boarder Assigned Room Error:",
      error
    );

    return res.status(500).json({
      message: "Server error.",
    });

  }

};

export const activateAssignment = async (
  req: Request,
  res: Response
) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      UPDATE room_assignments
      SET status = 'Active'
      WHERE id = $1
      RETURNING *;
      `,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        message: "Assignment not found.",
      });
    }

    return res.status(200).json({
      message: "Assignment activated successfully.",
      assignment: result.rows[0],
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Server error.",
    });
  }
};

export const getOccupancyHistory = async (
  req: Request,
  res: Response
) => {
  try {
    const result = await pool.query(
      `
      SELECT
          ra.id AS assignment_id,

          ra.user_id,
          u.user_id_no,
          u.first_name,
          u.last_name,
          u.email,
          u.contact_number,
          u.avatar_url,

          ra.room_id,
          r.room_number,

          ra.bed_id,
          b.bed_number,

          ra.assigned_date,
          ra.expected_checkout,
          ra.actual_checkout,

          ra.status,
          ra.remarks,
          ra.assigned_by,
          ra.created_at,

          CONCAT(
            COALESCE(admin.first_name, ''),
            ' ',
            COALESCE(admin.last_name, '')
          ) AS assigned_by_name

      FROM room_assignments ra

      INNER JOIN users u
        ON u.id = ra.user_id

      INNER JOIN rooms r
        ON r.id = ra.room_id

      INNER JOIN beds b
        ON b.id = ra.bed_id

      LEFT JOIN users admin
        ON admin.id = ra.assigned_by

      WHERE
        u.user_type = 'Boarder'

      ORDER BY
        ra.assigned_date DESC,
        ra.created_at DESC;
      `
    );

    return res.status(200).json(result.rows);

  } catch (error) {

    console.error("Occupancy History Error:", error);

    if (error instanceof Error) {
      return res.status(500).json({
        message: error.message,
      });
    }

    return res.status(500).json({
      message: "Server error.",
    });
  }
};

export const checkoutAssignment = async (
  req: Request,
  res: Response
) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;

    await client.query("BEGIN");

    const assignment = await client.query(
      `
      SELECT *
      FROM room_assignments
      WHERE id = $1
      AND status = 'Active'
      `,
      [id]
    );

    if (assignment.rowCount === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        message: "Assignment not found.",
      });
    }

    const current = assignment.rows[0];

    /**
     * Check for any unpaid billing
     * Previous Months + Current Month
     *
     * Ignore:
     * - Future billings
     * - Cancelled billings
     * - Fully paid billings
     */
    const outstandingBillings = await client.query(
      `
      SELECT
        id,
        billing_no,
        billing_month,
        status,
        total_amount,
        paid_amount,
        balance,
        due_date
      FROM billings
      WHERE user_id = $1
        AND balance > 0
        AND status <> 'Cancelled'
        AND billing_month <= DATE_TRUNC('month', CURRENT_DATE)
      ORDER BY billing_month ASC
      `,
      [current.user_id]
    );

    if (outstandingBillings.rows.length > 0) {
      const totalBalance =
        outstandingBillings.rows.reduce(
          (sum, billing) =>
            sum + Number(billing.balance),
          0
        );

      await client.query("ROLLBACK");

      return res.status(400).json({
        message:
          "Cannot checkout. Boarder still has unpaid billing balances.",

        summary: {
          unpaid_billings:
            outstandingBillings.rows.length,
          total_balance: totalBalance,
        },

        billings: outstandingBillings.rows,
      });
    }

    /**
     * Checkout Assignment
     */
    await client.query(
      `
      UPDATE room_assignments
      SET
        status = 'Checked-Out',
        actual_checkout = CURRENT_DATE
      WHERE id = $1
      `,
      [id]
    );

    /**
     * Remove boarder assignment flag
     */
    await client.query(
      `
      UPDATE users
      SET is_assigned = FALSE
      WHERE id = $1
      `,
      [current.user_id]
    );

    /**
     * Free bed
     */
    await client.query(
      `
      UPDATE beds
      SET status = 'Available'
      WHERE id = $1
      `,
      [current.bed_id]
    );

    /**
     * Update room status
     */
    await updateRoomStatus(
      client,
      current.room_id
    );

    await client.query("COMMIT");

    return res.json({
      message:
        "Boarder checked out successfully.",
    });

  } catch (err) {
    await client.query("ROLLBACK");

    console.error(err);

    return res.status(500).json({
      message: "Server error.",
    });

  } finally {
    client.release();
  }
};

export const getMyDashboard = async (
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


    const roomResult = await pool.query(
      `
      SELECT
          r.room_number,
          r.capacity,
          r.price_per_month,

          b.bed_number,

          ra.assigned_date,

          (
              EXTRACT(YEAR FROM AGE(CURRENT_DATE, ra.assigned_date)) * 12
              +
              EXTRACT(MONTH FROM AGE(CURRENT_DATE, ra.assigned_date))
          )::INT AS stay_months

      FROM room_assignments ra

      INNER JOIN rooms r
          ON r.id = ra.room_id

      INNER JOIN beds b
          ON b.id = ra.bed_id

      WHERE
          ra.user_id = $1
      AND
          ra.status = 'Active'

      LIMIT 1
      `,
      [userId]
    );



    const paymentResult = await pool.query(
      `
      SELECT
          billing_no,
          billing_type,
          billing_month,
          total_amount,
          balance,
          due_date,
          status,

          GREATEST(
              due_date - CURRENT_DATE,
              0
          ) AS days_left

      FROM billings

      WHERE
          user_id = $1
      AND
          status IN ('Upcoming','Pending','Partial','Overdue')

      ORDER BY due_date ASC

      LIMIT 1
      `,
      [userId]
    );

    const room = roomResult.rows[0] ?? null;
    const payment = paymentResult.rows[0] ?? null;

    return res.status(200).json({
      room: room
        ? {
          roomNumber: room.room_number,
          bedNumber: room.bed_number,
          capacity: room.capacity,
        }
        : null,

      monthlyRate: room
        ? Number(room.price_per_month)
        : 0,

      stay: room
        ? {
          months: Number(room.stay_months),
          moveInDate: room.assigned_date,
        }
        : null,

      upcomingPayment: payment
        ? {
          billingNo: payment.billing_no,
          label: payment.billing_type,
          billingMonth: payment.billing_month,
          amount: Number(payment.total_amount),
          balance: Number(payment.balance),
          dueDate: payment.due_date,
          daysLeft: Number(payment.days_left),
          status: payment.status,
        }
        : null,
    });

  } catch (error) {

    console.error("Get Dashboard Error:", error);

    return res.status(500).json({
      message: "Server error.",
    });

  }
};


export const getUpcomingPayments = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;

    const result = await pool.query(
      `
      SELECT
          b.id,
          b.billing_no,
          b.billing_month,
          b.due_date,
          b.total_amount,
          b.paid_amount,
          b.balance,
          b.status,

          CASE
              WHEN b.due_date < CURRENT_DATE THEN
                  'Overdue'
              WHEN b.due_date = CURRENT_DATE THEN
                  'Due Today'
              ELSE
                  'Due in ' ||
                  (b.due_date - CURRENT_DATE) ||
                  ' days'
          END AS due_label

      FROM billings b

      WHERE
          b.user_id = $1
      AND
          b.status IN ('Upcoming','Pending','Partial','Overdue')

      ORDER BY
          b.due_date ASC
      `,
      [userId]
    );

    return res.json(result.rows);

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      message: "Server error."
    });

  }
};