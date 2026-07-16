import { Request, Response } from "express"
import { pool } from "../../config/db"
import { AuthRequest } from "../../types/auth";

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

    if (
      !user_id ||
      !room_id ||
      !bed_id
    ) {
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

    if (userResult.rows.length === 0) {
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

    if (roomResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        message: "Room not found.",
      });
    }

    if (
      roomResult.rows[0].status ===
      "Under Maintenance"
    ) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        message:
          "Room is currently under maintenance.",
      });
    }

    // ============================
    // CHECK BED
    // ============================

    const bedResult = await client.query(
      `
      SELECT *
      FROM beds
      WHERE
        id = $1
      AND
        room_id = $2
      `,
      [bed_id, room_id]
    );

    if (bedResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        message:
          "Selected bed does not belong to this room.",
      });
    }

    if (
      bedResult.rows[0].status ===
      "Occupied"
    ) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        message: "Bed is already occupied.",
      });
    }

    // ============================
    // CHECK ACTIVE ASSIGNMENT
    // ============================

    const activeAssignment =
      await client.query(
        `
        SELECT id
        FROM room_assignments
        WHERE
            user_id = $1
        AND
            status = 'Active'
        `,
        [user_id]
      );

    if (activeAssignment.rows.length > 0) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        message:
          "User already has an active room assignment.",
      });
    }

    // ============================
    // CREATE ASSIGNMENT
    // ============================

    const assignmentResult =
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
          user_id,
          room_id,
          bed_id,
          expected_checkout || null,
          assigned_by || null,
          remarks || null,
        ]
      );

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

    const occupiedBeds =
      await client.query(
        `
        SELECT COUNT(*) AS occupied
        FROM beds
        WHERE
            room_id = $1
        AND
            status = 'Occupied'
        `,
        [room_id]
      );

    const totalBeds =
      await client.query(
        `
        SELECT COUNT(*) AS total
        FROM beds
        WHERE room_id = $1
        `,
        [room_id]
      );

    const occupied =
      Number(
        occupiedBeds.rows[0].occupied
      );

    const total =
      Number(
        totalBeds.rows[0].total
      );

    if (occupied >= total) {
      await client.query(
        `
        UPDATE rooms
        SET status = 'Occupied'
        WHERE id = $1
        `,
        [room_id]
      );
    } else {
      await client.query(
        `
        UPDATE rooms
        SET status = 'Available'
        WHERE id = $1
        `,
        [room_id]
      );
    }

    await client.query("COMMIT");

    return res.status(201).json({
      message:
        "Room assigned successfully.",
      assignment:
        assignmentResult.rows[0],
    });

  } catch (error) {

    await client.query("ROLLBACK");

    console.error(
      "Assign room error:",
      error
    );

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
      SELECT
          user_id,
          room_id,
          bed_id
      FROM room_assignments
      WHERE
          id = $1
      AND
          status = 'Active'
      `,
      [id]
    );

    if (assignment.rowCount === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        message: "Active assignment not found.",
      });
    }

    const {
      user_id,
      room_id,
      bed_id,
    } = assignment.rows[0];

    // Update assignment
    await client.query(
      `
      UPDATE room_assignments
      SET
          status = 'Checked-Out',
          actual_checkout = NOW()
      WHERE id = $1
      `,
      [id]
    );

    // Update user
    await client.query(
      `
      UPDATE users
      SET is_assigned = FALSE
      WHERE id = $1
      `,
      [user_id]
    );

    // Free bed
    await client.query(
      `
      UPDATE beds
      SET status = 'Available'
      WHERE id = $1
      `,
      [bed_id]
    );

    // Update room status
    const occupied = await client.query(
      `
      SELECT COUNT(*)::int AS occupied
      FROM beds
      WHERE
          room_id = $1
      AND
          status = 'Occupied'
      `,
      [room_id]
    );

    await client.query(
      `
      UPDATE rooms
      SET status = $1
      WHERE id = $2
      `,
      [
        occupied.rows[0].occupied > 0
          ? "Available"
          : "Available",
        room_id,
      ]
    );

    await client.query("COMMIT");

    return res.status(200).json({
      message: "Boarder checked out successfully.",
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