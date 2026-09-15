import { Request, Response } from "express";
import { pool } from "../../config/db";
import cloudinary from "../../config/cloudinary"
import { AuthRequest } from "../../types/auth";

export const getAllRooms = async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT
        r.id,
        r.room_number,
        r.capacity,
        r.price_per_month,
        r.status,
        r.description,

        COALESCE(images.images, '[]') AS images,

        COALESCE(beds.total_beds, 0) AS total_beds,
        COALESCE(beds.occupied_beds, 0) AS occupied_beds,
        COALESCE(beds.available_beds, 0) AS available_beds

      FROM rooms r

      LEFT JOIN (
          SELECT
              room_id,
              json_agg(image_url) AS images
          FROM room_images
          GROUP BY room_id
      ) images
      ON images.room_id = r.id

      LEFT JOIN (
          SELECT
              b.room_id,
              COUNT(*) AS total_beds,

              COUNT(ra.id)
              FILTER (WHERE ra.status = 'Active') AS occupied_beds,

              COUNT(*) -
              COUNT(ra.id)
              FILTER (WHERE ra.status = 'Active')
              AS available_beds

          FROM beds b

          LEFT JOIN room_assignments ra
            ON ra.bed_id = b.id
            AND ra.status = 'Active'

          GROUP BY b.room_id
      ) beds
      ON beds.room_id = r.id

      WHERE r.is_deleted = FALSE

      ORDER BY r.id DESC;
    `);

    res.json(result.rows);

  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Server error",
    });
  }
};

export const getAvailableRooms = async (
  req: Request,
  res: Response
) => {
  try {
    const result = await pool.query(`
      SELECT
        r.id,
        r.room_number,
        r.capacity,
        r.price_per_month,
        r.description,

        COALESCE(images.images, '[]') AS images,

        COALESCE(beds.available_beds, '[]') AS beds,

        COALESCE(
          json_array_length(beds.available_beds),
          0
        ) AS available_beds

      FROM rooms r

      LEFT JOIN (

        SELECT
          room_id,
          json_agg(image_url) AS images

        FROM room_images

        GROUP BY room_id

      ) images
      ON images.room_id = r.id

      LEFT JOIN (

        SELECT

          b.room_id,

          json_agg(
            json_build_object(
              'id', b.id,
              'bed_number', b.bed_number
            )
          ) FILTER (
            WHERE ra.id IS NULL
          ) AS available_beds

        FROM beds b

        LEFT JOIN room_assignments ra
          ON ra.bed_id = b.id
          AND ra.status = 'Active'

        GROUP BY b.room_id

      ) beds
      ON beds.room_id = r.id

      WHERE
        r.status = 'Available'
        AND r.is_deleted = FALSE

      ORDER BY
        r.room_number;
    `);

    res.json(result.rows);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      message: "Server error",
    });

  }
};

export const createRoom = async (req: Request, res: Response) => {
  const client = await pool.connect();

  try {
    const {
      room_number,
      capacity,
      bed_count,
      price_per_month,
      status = "Available",
      description,
    } = req.body;

    if (
      !room_number ||
      capacity == null ||
      bed_count == null ||
      price_per_month == null
    ) {
      return res.status(400).json({
        message: "Missing required fields",
      });
    }

    if (bed_count <= 0) {
      return res.status(400).json({
        message: "Bed count must be greater than 0",
      });
    }

    if (bed_count > capacity) {
      return res.status(400).json({
        message: "Bed count cannot exceed room capacity",
      });
    }

    const allowedStatuses = [
      "Available",
      "Occupied",
      "Under Maintenance",
    ];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        message: "Invalid room status",
      });
    }

    await client.query("BEGIN");

    const existingRoom = await client.query(
      "SELECT id FROM rooms WHERE room_number = $1",
      [room_number]
    );

    if (existingRoom.rows.length > 0) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        message: "Room number already exists",
      });
    }

    const roomResult = await client.query(
      `
      INSERT INTO rooms
      (
        room_number,
        capacity,
        price_per_month,
        status,
        description
      )
      VALUES ($1,$2,$3,$4,$5)
      RETURNING *
      `,
      [
        room_number,
        capacity,
        price_per_month,
        status,
        description,
      ]
    );

    const room = roomResult.rows[0];

    // Create beds
    for (let i = 1; i <= bed_count; i++) {
      await client.query(
        `
        INSERT INTO beds
        (
          room_id,
          bed_number
        )
        VALUES ($1,$2)
        `,
        [room.id, `Bed ${i}`]
      );
    }

    // Upload images
    const imageUrls: string[] = [];

    if (Array.isArray(req.files)) {
      for (const file of req.files as Express.Multer.File[]) {

        const uploadResult: any = await new Promise(
          (resolve, reject) => {

            const stream =
              cloudinary.uploader.upload_stream(
                {
                  folder: "rooms",
                },
                (error, result) => {

                  if (error) return reject(error);

                  resolve(result);
                }
              );

            stream.end(file.buffer);
          }
        );

        imageUrls.push(uploadResult.secure_url);

        await client.query(
          `
          INSERT INTO room_images
          (
            room_id,
            image_url
          )
          VALUES ($1,$2)
          `,
          [room.id, uploadResult.secure_url]
        );
      }
    }

    await client.query("COMMIT");

    return res.status(201).json({
      message: "Room created successfully",
      room,
      images: imageUrls,
    });

  } catch (error: any) {

    await client.query("ROLLBACK");

    console.error(error);

    return res.status(500).json({
      message:
        error?.message || "Server error",
    });

  } finally {

    client.release();
  }
};

export const updateRoom = async (req: Request, res: Response) => {
  const { id } = req.params;
  const client = await pool.connect();

  try {
    const {
      room_number,
      capacity,
      price_per_month,
      status,
      description,
    } = req.body;

    if (
      room_number === undefined &&
      capacity === undefined &&
      price_per_month === undefined &&
      status === undefined &&
      description === undefined &&
      !Array.isArray(req.files)
    ) {
      return res.status(400).json({
        message: "No fields provided to update",
      });
    }

    const allowedStatuses = [
      "Available",
      "Occupied",
      "Under Maintenance",
    ];

    if (room_number !== undefined && String(room_number).trim() === "") {
      return res.status(400).json({
        message: "Room number cannot be empty",
      });
    }

    if (capacity !== undefined && Number(capacity) <= 0) {
      return res.status(400).json({
        message: "Capacity must be greater than 0",
      });
    }

    if (
      price_per_month !== undefined &&
      Number(price_per_month) < 0
    ) {
      return res.status(400).json({
        message: "Price per month must be greater than or equal to 0",
      });
    }

    if (
      status !== undefined &&
      !allowedStatuses.includes(status)
    ) {
      return res.status(400).json({
        message: "Invalid room status",
      });
    }

    await client.query("BEGIN");

    const roomCheck = await client.query(
      "SELECT * FROM rooms WHERE id = $1 AND is_deleted = FALSE",
      [id]
    );

    if (roomCheck.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        message: "Room not found",
      });
    }

    const existingRoom = roomCheck.rows[0];
    if (
      room_number !== undefined &&
      room_number !== existingRoom.room_number
    ) {
      const roomNumberQuery = await client.query(
        "SELECT id FROM rooms WHERE room_number = $1",
        [room_number]
      );

      if (roomNumberQuery.rows.length > 0) {
        await client.query("ROLLBACK");

        return res.status(400).json({
          message: "Room number already exists",
        });
      }
    }

    if (capacity !== undefined) {
      const occupiedResult = await client.query(
        `
    SELECT COUNT(*) AS occupied
    FROM room_assignments
    WHERE room_id = $1
      AND status = 'Active'
    `,
        [id]
      );

      const occupied = Number(occupiedResult.rows[0].occupied);

      if (capacity < occupied) {
        await client.query("ROLLBACK");

        return res.status(400).json({
          message: `Cannot reduce capacity below ${occupied} occupied bed(s).`,
        });
      }
    }

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (room_number !== undefined) {
      updates.push(`room_number = $${paramIndex++}`);
      values.push(room_number);
    }

    if (capacity !== undefined) {
      updates.push(`capacity = $${paramIndex++}`);
      values.push(capacity);
    }

    if (price_per_month !== undefined) {
      updates.push(`price_per_month = $${paramIndex++}`);
      values.push(price_per_month);
    }

    if (status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(status);
    }

    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(description);
    }

    let updatedRoom = existingRoom;

    if (updates.length > 0) {
      const updateQuery = `
        UPDATE rooms
        SET ${updates.join(", ")}
        WHERE id = $${paramIndex}
        RETURNING *
      `;

      const updateResult = await client.query(updateQuery, [
        ...values,
        id,
      ]);

      updatedRoom = updateResult.rows[0];
    }

   const imageUrls: string[] = [];

    // Images that should remain
    const existingImages: string[] =
      req.body.existingImages
        ? JSON.parse(req.body.existingImages)
        : [];

    // Current DB images
    const dbImages = await client.query(
      `
      SELECT id, image_url
      FROM room_images
      WHERE room_id = $1
      `,
      [id]
    );

    // Delete removed images
    for (const image of dbImages.rows) {

      if (!existingImages.includes(image.image_url)) {

        try {

          const fileName =
            image.image_url.split("/").pop()!;

          const publicId =
            `rooms/${fileName.split(".")[0]}`;

          await cloudinary.uploader.destroy(publicId);

        } catch (err) {

          console.warn(
            "Cloudinary delete failed:",
            err
          );

        }

        await client.query(
          `
          DELETE FROM room_images
          WHERE id = $1
          `,
          [image.id]
        );

      }

    }
    // Upload new images
    if (Array.isArray(req.files)) {

      for (const file of req.files as Express.Multer.File[]) {

        const uploadResult: any =
          await new Promise((resolve, reject) => {

            const stream =
              cloudinary.uploader.upload_stream(
                {
                  folder: "rooms",
                },
                (error, result) => {

                  if (error) return reject(error);

                  resolve(result);

                }
              );

            stream.end(file.buffer);

          });

        imageUrls.push(uploadResult.secure_url);

        await client.query(
          `
          INSERT INTO room_images
          (
            room_id,
            image_url
          )
          VALUES
          ($1,$2)
          `,
          [
            updatedRoom.id,
            uploadResult.secure_url,
          ]
        );

      }

    }

    await client.query("COMMIT");

    const updatedImages = await client.query(
      `
      SELECT image_url
      FROM room_images
      WHERE room_id = $1
      `,
      [id]
    );

    return res.json({
      message: "Room updated successfully",
      room: {
        ...updatedRoom,
        images: updatedImages.rows.map(
          (i) => i.image_url
        ),
      },
    });
  } catch (error: any) {
    await client.query("ROLLBACK");

    console.error("Update room error:", error);

    return res.status(500).json({
      message: error?.message || "Server error",
    });
  } finally {
    client.release();
  }
};

export const deleteRoom = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const roomCheck = await pool.query(
      "SELECT * FROM rooms WHERE id = $1 AND is_deleted = FALSE",
      [id]
    );

    if (roomCheck.rows.length === 0) {
      return res.status(404).json({ message: "Room not found" });
    }

    const activeAssignments = await pool.query(
      `
      SELECT
          COUNT(*) AS total
      FROM room_assignments
      WHERE
          room_id = $1
      AND
          status = 'Active'
      `,
      [id]
    );

    if (Number(activeAssignments.rows[0].total) > 0) {
      return res.status(400).json({
        message:
          "This room cannot be deleted because it currently has active boarder assignment(s).",
      });
    }

    // Soft delete — the room, its beds, and its images are kept so the
    // room can be restored later instead of losing the data permanently.
    const result = await pool.query(
      `
      UPDATE rooms
      SET
        is_deleted = TRUE,
        deleted_at = NOW(),
        deleted_by = $2
      WHERE id = $1
      RETURNING *
      `,
      [id, req.user?.id]
    );

    res.json({
      message: "Room moved to trash successfully",
      room: result.rows[0],
    });

  } catch (error) {
    console.error("Delete room error:", error);

    res.status(500).json({
      message: "Server error",
    });
  }
};

export const restoreRoom = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const roomCheck = await pool.query(
      "SELECT * FROM rooms WHERE id = $1 AND is_deleted = TRUE",
      [id]
    );

    if (roomCheck.rows.length === 0) {
      return res.status(404).json({
        message: "Deleted room not found",
      });
    }

    const existingActive = await pool.query(
      "SELECT id FROM rooms WHERE room_number = $1 AND is_deleted = FALSE",
      [roomCheck.rows[0].room_number]
    );

    if (existingActive.rows.length > 0) {
      return res.status(400).json({
        message:
          "A room with this room number already exists. Rename the active room before restoring this one.",
      });
    }

    const result = await pool.query(
      `
      UPDATE rooms
      SET
        is_deleted = FALSE,
        deleted_at = NULL,
        deleted_by = NULL
      WHERE id = $1
      RETURNING *
      `,
      [id]
    );

    res.json({
      message: "Room restored successfully",
      room: result.rows[0],
    });

  } catch (error) {
    console.error("Restore room error:", error);

    res.status(500).json({
      message: "Server error",
    });
  }
};

export const getDeletedRooms = async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT
        r.id,
        r.room_number,
        r.capacity,
        r.price_per_month,
        r.status,
        r.deleted_at,

        CONCAT(u.first_name, ' ', u.last_name) AS deleted_by_name,
        u.avatar_url AS deleted_by_avatar,

        COALESCE(beds.total_beds, 0) AS total_beds

      FROM rooms r

      LEFT JOIN users u
        ON u.id = r.deleted_by

      LEFT JOIN (
          SELECT room_id, COUNT(*) AS total_beds
          FROM beds
          GROUP BY room_id
      ) beds
      ON beds.room_id = r.id

      WHERE r.is_deleted = TRUE

      ORDER BY r.deleted_at DESC;
    `);

    res.json(result.rows);

  } catch (error) {
    console.error("Get deleted rooms error:", error);

    res.status(500).json({
      message: "Server error",
    });
  }
};

export const getAvailableRoomsWithBeds = async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
  SELECT 
    r.id,
    r.room_number,
    r.capacity,
    r.price_per_month,
    r.description,

    COALESCE(beds_data.available_beds, 0) AS available_beds,
    COALESCE(beds_data.total_beds, 0) AS total_beds,
    COALESCE(beds_data.beds, '[]') AS beds,

    COALESCE(images_data.images, '[]') AS images

  FROM rooms r

  LEFT JOIN (
    SELECT 
      room_id,
      COUNT(*) FILTER (WHERE status = 'Available') AS available_beds,
      COUNT(*) AS total_beds,

      json_agg(
        json_build_object(
          'id', id,
          'bed_number', bed_number
        )
      ) FILTER (WHERE status = 'Available') AS beds

    FROM beds
    GROUP BY room_id
  ) beds_data ON beds_data.room_id = r.id

  LEFT JOIN (
    SELECT 
      room_id,
      json_agg(image_url) AS images
    FROM room_images
    GROUP BY room_id
  ) images_data ON images_data.room_id = r.id

  WHERE
    r.is_deleted = FALSE
    AND COALESCE(beds_data.available_beds, 0) > 0

  ORDER BY r.id DESC
`);

    res.json(result.rows);

  } catch (error) {
    console.error("Get available rooms error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const getDashboardStats = async (
  req: Request,
  res: Response
) => {
  try {

    // TOTAL ROOMS
    const totalRoomsQuery = await pool.query(`
      SELECT COUNT(*) FROM rooms WHERE is_deleted = FALSE
    `);

    // FULLY OCCUPIED ROOMS
    const fullyOccupiedQuery = await pool.query(`
      SELECT COUNT(*)
      FROM rooms
      WHERE status = 'Occupied' AND is_deleted = FALSE
    `);

    // OCCUPIED BEDS
    const occupiedBedsQuery = await pool.query(`
      SELECT COUNT(*)
      FROM beds
      WHERE status = 'Occupied'
    `);

    // AVAILABLE BEDS
    const availableBedsQuery = await pool.query(`
      SELECT COUNT(*)
      FROM beds
      WHERE status = 'Available'
    `);

    res.json({
      totalRooms: Number(
        totalRoomsQuery.rows[0].count
      ),

      fullyOccupied: Number(
        fullyOccupiedQuery.rows[0].count
      ),

      occupiedBeds: Number(
        occupiedBedsQuery.rows[0].count
      ),

      availableBeds: Number(
        availableBedsQuery.rows[0].count
      ),
    });

  } catch (error) {

    console.error(
      "Dashboard stats error:",
      error
    );

    res.status(500).json({
      message: "Server error",
    });
  }
};


export const getOccupancyTrend = async (
  req: Request,
  res: Response
) => {
  try {

    const result = await pool.query(`
      SELECT
        TO_CHAR(
          DATE_TRUNC('month', created_at),
          'Mon'
        ) AS month,

        COUNT(*) AS occupied

      FROM boarders

      WHERE created_at >=
        CURRENT_DATE - INTERVAL '6 months'

      GROUP BY
        DATE_TRUNC('month', created_at)

      ORDER BY
        DATE_TRUNC('month', created_at)
    `)

    res.json(
      result.rows.map((row) => ({
        month: row.month,
        occupied: Number(row.occupied),
      }))
    )

  } catch (error) {

    console.error(
      "Occupancy trend error:",
      error
    )

    res.status(500).json({
      message: "Server error",
    })
  }
}

export const getMyDashboard = async (
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

        r.room_number,
        r.capacity,
        r.price_per_month,

        bed.bed_number,

        b.created_at AS move_in_date

      FROM boarders b

      JOIN users u
        ON b.user_id = u.id

      JOIN rooms r
        ON b.room_id = r.id

      JOIN beds bed
        ON b.bed_id = bed.id

      WHERE u.id = $1

      LIMIT 1
      `,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Boarder not found",
      });
    }

    const boarder = result.rows[0];

    const moveInDate = new Date(boarder.move_in_date);

    const today = new Date();

    const months =
      (today.getFullYear() - moveInDate.getFullYear()) * 12 +
      (today.getMonth() - moveInDate.getMonth());

    res.json({

      room: {
        roomNumber: boarder.room_number,
        bedNumber: boarder.bed_number,
        capacity: boarder.capacity,
      },

      monthlyRate: Number(boarder.price_per_month),

      stay: {
        months,
        moveInDate,
      },

    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      message: "Server error",
    });

  }
};

export const getRoomAvailabilityChart = async (
  req: Request,
  res: Response
) => {
  try {
    const result = await pool.query(`
      SELECT
        r.id,
        r.room_number AS room,

        COUNT(b.id) AS total,

        COUNT(ra.id)
          FILTER (
            WHERE ra.status = 'Active'
          ) AS occupied,

        COUNT(b.id) -
        COUNT(ra.id)
          FILTER (
            WHERE ra.status = 'Active'
          ) AS available

      FROM rooms r

      LEFT JOIN beds b
        ON b.room_id = r.id

      LEFT JOIN room_assignments ra
        ON ra.bed_id = b.id
       AND ra.status = 'Active'

      WHERE r.is_deleted = FALSE

      GROUP BY
        r.id,
        r.room_number

      ORDER BY
        r.room_number;
    `);

    return res.json(
      result.rows.map((room) => ({
        room: room.room,
        total: Number(room.total),
        available: Number(room.available),
        occupied: Number(room.occupied),
      }))
    );
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};

export const getBedOccupancyChart = async (
  req: Request,
  res: Response
) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) FILTER (
          WHERE status = 'Occupied'
        ) AS occupied,

        COUNT(*) FILTER (
          WHERE status = 'Available'
        ) AS available

      FROM beds;
    `);

    const row = result.rows[0];

    return res.json([
      {
        name: "Occupied",
        value: Number(row.occupied),
        color: "#475569",
      },
      {
        name: "Available",
        value: Number(row.available),
        color: "#cbd5e1",
      },
    ]);

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};

export const getRoomOccupancyChart = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) FILTER (
          WHERE status = 'Available'
        ) AS available,

        COUNT(*) FILTER (
          WHERE status = 'Occupied'
        ) AS occupied,

        COUNT(*) FILTER (
          WHERE status = 'Under Maintenance'
        ) AS maintenance

      FROM rooms
      WHERE is_deleted = FALSE
    `);

    const row = result.rows[0];

    const data = [
      {
        name: "Available",
        value: Number(row.available),
        color: "#10b981",
      },
      {
        name: "Occupied",
        value: Number(row.occupied),
        color: "#0f172a",
      },
      {
        name: "Under Maintenance",
        value: Number(row.maintenance),
        color: "#f59e0b",
      },
    ];

    return res.status(200).json(data);

  } catch (error) {
    console.error(
      "Room Occupancy Chart Error:",
      error
    );

    return res.status(500).json({
      message: "Failed to load room occupancy chart.",
    });
  }
};


export const getRoomAvailabilityBed = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const result = await pool.query(`
      SELECT
        r.room_number AS room,

        COUNT(*) FILTER (
          WHERE b.status = 'Available'
        ) AS available,

        COUNT(*) FILTER (
          WHERE b.status = 'Occupied'
        ) AS occupied

      FROM rooms r
      LEFT JOIN beds b
        ON b.room_id = r.id

      WHERE r.is_deleted = FALSE

      GROUP BY r.id, r.room_number
      ORDER BY r.room_number
    `);

    return res.status(200).json(result.rows);

  } catch (error) {
    console.error("Room Availability Chart:", error);

    return res.status(500).json({
      message: "Server error."
    });
  }
};

export const getRoomReportStats = async (
  req: Request,
  res: Response
) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) AS total_rooms,

        COUNT(*) FILTER (
          WHERE status = 'Occupied'
        ) AS occupied_rooms,

        COUNT(*) FILTER (
          WHERE status = 'Available'
        ) AS available_rooms

      FROM rooms
      WHERE is_deleted = FALSE
    `);

    const row = result.rows[0];

    const totalRooms = Number(row.total_rooms);
    const occupiedRooms = Number(row.occupied_rooms);
    const availableRooms = Number(row.available_rooms);

    const occupancyRate =
      totalRooms > 0
        ? ((occupiedRooms / totalRooms) * 100).toFixed(1)
        : "0";

    return res.json({
      totalRooms,
      occupiedRooms,
      availableRooms,
      occupancyRate,
    });

  } catch (error) {
    console.error("Room Report Stats Error:", error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};

export const getRoomStatusReport = async (
  req: Request,
  res: Response
) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) FILTER (
          WHERE status = 'Occupied'
        ) AS occupied,

        COUNT(*) FILTER (
          WHERE status = 'Available'
        ) AS available,

        COUNT(*) FILTER (
          WHERE status = 'Under Maintenance'
        ) AS maintenance

      FROM rooms
      WHERE is_deleted = FALSE
    `);

    const row = result.rows[0];

    return res.json([
      {
        name: "Occupied",
        value: Number(row.occupied),
        color: "#2563eb",
      },
      {
        name: "Available",
        value: Number(row.available),
        color: "#059669",
      },
      {
        name: "Under Maintenance",
        value: Number(row.maintenance),
        color: "#d97706",
      },
    ]);

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};

export const getRecentActivities = async (
  req: Request,
  res: Response
) => {
  try {
    const result = await pool.query(`
      SELECT
        ra.created_at,

        CONCAT(
          u.first_name,
          ' ',
          u.last_name
        ) AS boarder,

        r.room_number AS room,

        b.bed_number AS bed,

        ra.status AS action,

        CONCAT(
          au.first_name,
          ' ',
          au.last_name
        ) AS assigned_by

      FROM room_assignments ra

      JOIN users u
        ON ra.user_id = u.id

      JOIN rooms r
        ON ra.room_id = r.id

      JOIN beds b
        ON ra.bed_id = b.id

      LEFT JOIN users au
        ON ra.assigned_by = au.id

      ORDER BY ra.created_at DESC

      LIMIT 10
    `);

    return res.json(
      result.rows.map((row) => ({
        date: new Date(
          row.created_at
        ).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),

        boarder: row.boarder,

        room: row.room,

        bed: row.bed,

        action: row.action,

        by: row.assigned_by || "System",
      }))
    );

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};


export const getRoomReport = async (
  req: Request,
  res: Response
) => {
  try {
    const result = await pool.query(`
      SELECT
        r.id,
        r.room_number,
        r.capacity,
        r.status,
        r.created_at,

        COUNT(b.id)
          FILTER (
            WHERE b.status = 'Occupied'
          ) AS occupied,

        COUNT(b.id)
          FILTER (
            WHERE b.status = 'Available'
          ) AS available

      FROM rooms r

      LEFT JOIN beds b
        ON b.room_id = r.id

      WHERE r.is_deleted = FALSE

      GROUP BY
        r.id,
        r.room_number,
        r.capacity,
        r.status,
        r.created_at

      ORDER BY
        r.room_number
    `);

    return res.json(
      result.rows.map((room) => ({
        number: room.room_number,
        capacity: Number(room.capacity),
        occupied: Number(room.occupied),
        available: Number(room.available),
        status: room.status,

        date: new Date(
          room.created_at
        ).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
      }))
    );

  } catch (error) {
    console.error("Room report error:", error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};


export const getReportInsights = async (
  req: Request,
  res: Response
) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) AS total_rooms,

        COUNT(*) FILTER (
          WHERE status = 'Occupied'
        ) AS occupied_rooms,

        COUNT(*) FILTER (
          WHERE status = 'Available'
        ) AS available_rooms,

        COUNT(*) FILTER (
          WHERE status = 'Under Maintenance'
        ) AS maintenance_rooms

      FROM rooms
      WHERE is_deleted = FALSE
    `);

    const row = result.rows[0];

    const totalRooms = Number(row.total_rooms);
    const occupiedRooms = Number(row.occupied_rooms);
    const availableRooms = Number(row.available_rooms);
    const maintenanceRooms = Number(row.maintenance_rooms);

    const occupancyRate =
      totalRooms > 0
        ? ((occupiedRooms / totalRooms) * 100).toFixed(0)
        : "0";

    const insights = [
      `Current occupancy rate is ${occupancyRate}%`,
      `${occupiedRooms} of ${totalRooms} rooms are occupied`,
      `${availableRooms} rooms are available`,
      `${maintenanceRooms} rooms are under maintenance`,
    ];

    return res.json({
      occupancyRate,
      totalRooms,
      occupiedRooms,
      availableRooms,
      maintenanceRooms,
      insights,
    });

  } catch (error) {
    console.error("Report insights error:", error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};

export const updateRoomStatus = async (
  req: AuthRequest,
  res: Response
) => {
  const { id } = req.params;
  const { status } = req.body;

  const allowedStatuses = [
    "Available",
    "Occupied",
    "Under Maintenance",
  ];

  try {
    if (!status) {
      return res.status(400).json({
        message: "Status is required",
      });
    }

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        message: "Invalid room status",
      });
    }

    const roomResult = await pool.query(
      `
      SELECT *
      FROM rooms
      WHERE id = $1 AND is_deleted = FALSE
      `,
      [id]
    );

    if (roomResult.rowCount === 0) {
      return res.status(404).json({
        message: "Room not found",
      });
    }

    const room = roomResult.rows[0];

    const occupancyResult = await pool.query(
      `
      SELECT
        COUNT(*) FILTER (
          WHERE ra.status = 'Active'
        ) AS occupied
      FROM room_assignments ra
      WHERE ra.room_id = $1
      `,
      [id]
    );

    const occupied = Number(
      occupancyResult.rows[0].occupied
    );

    // Prevent Available when full
    if (
      status === "Available" &&
      occupied >= room.capacity
    ) {
      return res.status(400).json({
        message:
          "This room is fully occupied and cannot be marked as Available.",
      });
    }

    // Prevent Under Maintenance if occupied
    if (
      status === "Under Maintenance" &&
      occupied > 0
    ) {
      return res.status(400).json({
        message:
          "Cannot place a room under maintenance while it has active occupants.",
      });
    }

    const updatedRoom = await pool.query(
      `
      UPDATE rooms
      SET
        status = $1
      WHERE id = $2
      RETURNING *
      `,
      [status, id]
    );

    return res.status(200).json({
      message: `Room status updated to ${status}.`,
      room: updatedRoom.rows[0],
    });

  } catch (error) {
    console.error(
      "Update room status error:",
      error
    );

    return res.status(500).json({
      message: "Server error",
    });
  }
};