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
      "SELECT * FROM rooms WHERE id = $1",
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

    if (Array.isArray(req.files) && req.files.length > 0) {

      // Get old images
      const oldImages = await client.query(
        `
    SELECT image_url
    FROM room_images
    WHERE room_id = $1
    `,
        [id]
      );

      // Delete from Cloudinary
      for (const image of oldImages.rows) {

        try {

          const url = image.image_url as string;

          const fileName = url.split("/").pop()!;

          const publicId =
            `rooms/${fileName.split(".")[0]}`;

          await cloudinary.uploader.destroy(publicId);

        } catch (err) {

          console.warn(
            "Failed to delete Cloudinary image:",
            err
          );

        }

      }

      // Delete DB records
      await client.query(
        `
        DELETE
        FROM room_images
        WHERE room_id = $1
        `,
        [id]
      );

      // Upload new images
      for (const file of req.files as Express.Multer.File[]) {

        const uploadResult: any =
          await new Promise((resolve, reject) => {

            const stream =
              cloudinary.uploader.upload_stream(
                {
                  folder: "rooms",
                },
                (error, result) => {

                  if (error)
                    return reject(error);

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

    return res.json({
      message: "Room updated successfully",
      room: updatedRoom,
      images: imageUrls,
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

export const updateRoomStatus = async (
  req: Request,
  res: Response
) => {
  const { id } = req.params;
  const { status } = req.body;

  const allowedStatuses = [
    "Available",
    "Occupied",
    "Under Maintenance",
  ];

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

  try {
    const roomResult = await pool.query(
      "SELECT * FROM rooms WHERE id = $1",
      [id]
    );

    if (roomResult.rows.length === 0) {
      return res.status(404).json({
        message: "Room not found",
      });
    }

    // Don't allow setting Available if room is full
    if (status === "Available") {
      const occupiedResult = await pool.query(
        `
          SELECT COUNT(*) AS occupied
          FROM room_assignments
          WHERE room_id = $1
            AND status = 'Active'
          `,
        [id]
      );

      const occupied = Number(
        occupiedResult.rows[0].occupied
      );

      const capacity = roomResult.rows[0].capacity;

      if (occupied >= capacity) {
        return res.status(400).json({
          message:
            "Room is fully occupied and cannot be marked as Available.",
        });
      }
    }

    const result = await pool.query(
      `
        UPDATE rooms
        SET status = $1
        WHERE id = $2
        RETURNING *
        `,
      [status, id]
    );

    return res.json({
      message: "Room status updated successfully.",
      room: result.rows[0],
    });

  } catch (error) {
    console.error("Update room status error:", error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};

export const deleteRoom = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;


    const roomCheck = await pool.query(
      "SELECT * FROM rooms WHERE id = $1",
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


    const imagesResult = await pool.query(
      "SELECT image_url FROM room_images WHERE room_id = $1",
      [id]
    );

    for (const img of imagesResult.rows) {
      const url: string = img.image_url;

      // Extract public_id from URL
      const parts = url.split("/");
      const fileName = parts[parts.length - 1]; // abc123.jpg
      const publicId = `rooms/${fileName.split(".")[0]}`;

      try {
        await cloudinary.uploader.destroy(publicId);
      } catch (err) {
        console.warn("Failed to delete image from cloudinary:", publicId);
      }
    }


    // 1. Delete images table
    await pool.query(
      "DELETE FROM room_images WHERE room_id = $1",
      [id]
    );

    // 2. Delete beds
    await pool.query(
      "DELETE FROM beds WHERE room_id = $1",
      [id]
    );

    // 3. Delete room
    await pool.query(
      "DELETE FROM rooms WHERE id = $1",
      [id]
    );

    res.json({
      message: "Room, beds, and images deleted successfully",
    });

  } catch (error) {
    console.error("Delete room error:", error);

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

  WHERE COALESCE(beds_data.available_beds, 0) > 0

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
      SELECT COUNT(*) FROM rooms
    `);

    // FULLY OCCUPIED ROOMS
    const fullyOccupiedQuery = await pool.query(`
      SELECT COUNT(*) 
      FROM rooms
      WHERE status = 'Occupied'
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


