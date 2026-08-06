import { Response } from "express";
import { pool } from "../../config/db";
import cloudinary from "../../config/cloudinary";
import { AuthRequest } from "../../types/auth";

export const createMaintenanceRequest = async (
  req: AuthRequest,
  res: Response
) => {
  const client = await pool.connect();

  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const {
      category,
      description,
      room_id,
    } = req.body;

    if (!category || !description || !room_id) {
      return res.status(400).json({
        message: "Category, room and description are required.",
      });
    }

    await client.query("BEGIN");

    /**
     * Generate Request Number
     * Example:
     * MR-20260805-0001
     */

    const today = new Date();

    const date =
      today.getFullYear().toString() +
      String(today.getMonth() + 1).padStart(2, "0") +
      String(today.getDate()).padStart(2, "0");

    const countResult = await client.query(
      `
      SELECT COUNT(*) AS total
      FROM maintenance_requests
      WHERE DATE(created_at) = CURRENT_DATE
      `
    );

    const sequence = Number(countResult.rows[0].total) + 1;

    const requestNumber = `MR-${date}-${String(sequence).padStart(4, "0")}`;

    /**
     * Upload image (optional)
     */

  let imageUrl: string | null = null;

if (req.file) {
    const uploadResult: any = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                folder: "maintenance",
            },
            (error, result) => {
                if (error) return reject(error);
                resolve(result);
            }
        );

        stream.end(req.file?.buffer);
    });

    imageUrl = uploadResult.secure_url;
}

    /**
     * Create Maintenance Request
     */

    const result = await client.query(
      `
      INSERT INTO maintenance_requests
      (
        request_number,
        user_id,
        room_id,
        category,
        description,
        image_url,
        status
      )

      VALUES
      (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        'Pending'
      )

      RETURNING *
      `,
      [
        requestNumber,
        req.user.id,
        room_id,
        category,
        description,
        imageUrl,
      ]
    );

    /**
     * Save History
     */

    await client.query(
      `
      INSERT INTO maintenance_history
      (
        maintenance_id,
        status,
        remarks,
        updated_by
      )

      VALUES
      (
        $1,
        'Pending',
        'Maintenance request submitted.',
        $2
      )
      `,
      [
        result.rows[0].id,
        req.user.id,
      ]
    );

    await client.query("COMMIT");

    return res.status(201).json({
      message: "Maintenance request submitted successfully.",
      maintenance: result.rows[0],
    });

  } catch (error: any) {

    await client.query("ROLLBACK");

    console.error(error);

    return res.status(500).json({
      message: error?.message || "Server error",
    });

  } finally {

    client.release();

  }
};

export const getSubmittedMaintenance = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = await pool.query(
      `
      SELECT
        mr.id,
        mr.request_number,
        mr.user_id,
        mr.room_id,
        mr.category,
        mr.description,
        mr.image_url,
        mr.status,
        mr.created_at,
        mr.updated_at,

        CONCAT(
          u.first_name,
          ' ',
          u.last_name
        ) AS requested_by,

        u.email,
        u.contact_number,

        r.room_number,

        CONCAT(
          staff.first_name,
          ' ',
          staff.last_name
        ) AS assigned_staff

      FROM maintenance_requests mr

      JOIN users u
        ON u.id = mr.user_id

      JOIN rooms r
        ON r.id = mr.room_id

      LEFT JOIN users staff
        ON staff.id = mr.assigned_staff_id

      WHERE
        mr.status NOT IN ('Completed', 'Closed')

      ORDER BY
        mr.created_at DESC
      `
    );

    return res.json(result.rows);

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};

export const assignMaintenanceRequest = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const { id } = req.params;

    const {
      assigned_staff_id,
    } = req.body;

    if (!assigned_staff_id) {
      return res.status(400).json({
        message: "Staff is required.",
      });
    }

    const maintenance = await pool.query(
      `
      SELECT *
      FROM maintenance_requests
      WHERE id = $1
      `,
      [id]
    );

    if (maintenance.rows.length === 0) {
      return res.status(404).json({
        message: "Maintenance request not found.",
      });
    }

    const staff = await pool.query(
      `
      SELECT id
      FROM users
      WHERE
        id = $1
      AND
        user_type='Staff'
      `,
      [assigned_staff_id]
    );

    if (staff.rows.length === 0) {
      return res.status(404).json({
        message: "Staff not found.",
      });
    }

    const result = await pool.query(
      `
      UPDATE maintenance_requests

      SET

        assigned_staff_id = $1,
        status = 'Assigned',
        updated_at = CURRENT_TIMESTAMP

      WHERE id = $2

      RETURNING *
      `,
      [
        assigned_staff_id,
        id,
      ]
    );

    await pool.query(
      `
      INSERT INTO maintenance_history
      (
        maintenance_id,
        status,
        remarks,
        updated_by
      )

      VALUES
      (
        $1,
        'Assigned',
        'Maintenance request assigned.',
        $2
      )
      `,
      [
        id,
        req.user?.id,
      ]
    );

    return res.json({
      message:
        "Maintenance request assigned successfully.",
      maintenance: result.rows[0],
    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      message: "Server error",
    });

  }
};

export const updateMaintenanceStatus = async (
  req: AuthRequest,
  res: Response
) => {
  const client = await pool.connect();

  try {

    const { id } = req.params;

    const {
      status,
      remarks,
    } = req.body;

    const allowedStatus = [
      "Assigned",
      "In Progress",
      "Completed",
      "Closed",
    ];

    if (!allowedStatus.includes(status)) {
      return res.status(400).json({
        message: "Invalid status.",
      });
    }

    await client.query("BEGIN");

    const maintenance = await client.query(
      `
      SELECT *
      FROM maintenance_requests
      WHERE id = $1
      `,
      [id]
    );

    if (maintenance.rows.length === 0) {

      await client.query("ROLLBACK");

      return res.status(404).json({
        message: "Maintenance request not found.",
      });

    }

    /**
     * Prevent closing unless completed
     */

    if (
      status === "Closed" &&
      maintenance.rows[0].status !== "Completed"
    ) {

      await client.query("ROLLBACK");

      return res.status(400).json({
        message: "Only completed requests can be closed.",
      });

    }

    const result = await client.query(
      `
      UPDATE maintenance_requests

      SET
        status = $1,
        updated_at = CURRENT_TIMESTAMP

      WHERE id = $2

      RETURNING *
      `,
      [
        status,
        id,
      ]
    );

    await client.query(
      `
      INSERT INTO maintenance_history
      (
        maintenance_id,
        status,
        remarks,
        updated_by
      )

      VALUES
      (
        $1,
        $2,
        $3,
        $4
      )
      `,
      [
        id,
        status,
        remarks ?? null,
        req.user?.id,
      ]
    );

    await client.query("COMMIT");

    return res.json({
      message: "Status updated successfully.",
      maintenance: result.rows[0],
    });

  } catch (error) {

    await client.query("ROLLBACK");

    console.error(error);

    return res.status(500).json({
      message: "Server error",
    });

  } finally {

    client.release();

  }
};

export const updateMaintenanceRequest = async (
  req: AuthRequest,
  res: Response
) => {
  const client = await pool.connect();

  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const { id } = req.params;

    const {
      category,
      description,
      existingImage,
    } = req.body;

    await client.query("BEGIN");

    const maintenanceResult = await client.query(
      `
      SELECT *
      FROM maintenance_requests
      WHERE id = $1
      `,
      [id]
    );

    if (maintenanceResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        message: "Maintenance request not found.",
      });
    }

    const maintenance = maintenanceResult.rows[0];

    /**
     * Prevent users from editing other users' requests.
     * Administrators can still edit any request.
     */
    if (
      maintenance.user_id !== req.user.id &&
      req.user.user_type !== "Administrator"
    ) {
      await client.query("ROLLBACK");

      return res.status(403).json({
        message: "You are not allowed to update this request.",
      });
    }

    let imageUrl = maintenance.image_url;

    /**
     * Remove existing image
     */
    if (!existingImage && maintenance.image_url) {
      try {
        const fileName = maintenance.image_url.split("/").pop()!;
        const publicId = `maintenance/${fileName.split(".")[0]}`;

        await cloudinary.uploader.destroy(publicId);
      } catch (err) {
        console.warn(err);
      }

      imageUrl = null;
    }

    /**
     * Upload replacement image
     */
    if (
      Array.isArray(req.files) &&
      req.files.length > 0
    ) {
      if (maintenance.image_url) {
        try {
          const fileName = maintenance.image_url.split("/").pop()!;
          const publicId = `maintenance/${fileName.split(".")[0]}`;

          await cloudinary.uploader.destroy(publicId);
        } catch {}
      }

      const file = req.files[0];

      const uploadResult: any = await new Promise(
        (resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            {
              folder: "maintenance",
            },
            (error, result) => {
              if (error) return reject(error);

              resolve(result);
            }
          );

          stream.end(file.buffer);
        }
      );

      imageUrl = uploadResult.secure_url;
    }

    const result = await client.query(
      `
      UPDATE maintenance_requests

      SET
        category = COALESCE($1, category),
        description = COALESCE($2, description),
        image_url = $3,
        updated_at = CURRENT_TIMESTAMP

      WHERE id = $4

      RETURNING *
      `,
      [
        category,
        description,
        imageUrl,
        id,
      ]
    );

    await client.query("COMMIT");

    return res.json({
      message: "Maintenance request updated successfully.",
      maintenance: result.rows[0],
    });

  } catch (error: any) {

    await client.query("ROLLBACK");

    console.error(error);

    return res.status(500).json({
      message: error?.message || "Server error",
    });

  } finally {

    client.release();

  }
};

export const getMyAssignedMaintenance = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = await pool.query(
      `
      SELECT

        mr.id,
        mr.request_number,
        mr.category,
        mr.description,
        mr.image_url,
        mr.status,
        mr.created_at,

        CONCAT(
          u.first_name,
          ' ',
          u.last_name
        ) AS boarder,

        r.room_number

      FROM maintenance_requests mr

      JOIN users u
        ON u.id = mr.user_id

      JOIN rooms r
        ON r.id = mr.room_id

      WHERE

        mr.assigned_staff_id = $1

      AND

        mr.status NOT IN
        (
          'Completed',
          'Closed'
        )

      ORDER BY
        mr.created_at DESC
      `,
      [req.user.id]
    );

    return res.json(result.rows);

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      message: "Server error",
    });

  }
};

export const getMySubmittedRequest = async (
  req: AuthRequest,
  res: Response
) => {
  try {

    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = await pool.query(
      `
      SELECT

        mr.id,
        mr.request_number,
        mr.category,
        mr.description,
        mr.image_url,
        mr.status,
        mr.created_at,
        mr.updated_at,

        r.room_number,

        CONCAT(
          staff.first_name,
          ' ',
          staff.last_name
        ) AS assigned_staff

      FROM maintenance_requests mr

      JOIN rooms r
        ON r.id = mr.room_id

      LEFT JOIN users staff
        ON staff.id = mr.assigned_staff_id

      WHERE
        mr.user_id = $1

      ORDER BY
        mr.created_at DESC
      `,
      [req.user.id]
    );

    return res.json(result.rows);

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      message: "Server error",
    });

  }
};