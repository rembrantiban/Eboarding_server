import { Request, Response } from "express";
import { pool } from "../../config/db";
import cloudinary from "../../config/cloudinary"


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
        ri.image_url,
        COUNT(b.id) FILTER (WHERE b.status = 'Occupied') AS occupied_beds,
        COUNT(b.id) AS total_beds
      FROM rooms r
      LEFT JOIN room_images ri ON r.id = ri.room_id
      LEFT JOIN beds b ON r.id = b.room_id
      GROUP BY r.id, ri.image_url
      ORDER BY r.id DESC
    `);

        const roomsMap: any = {};

        result.rows.forEach((row) => {
            if (!roomsMap[row.id]) {
                roomsMap[row.id] = {
                    id: row.id,
                    room_number: row.room_number,
                    capacity: row.capacity,
                    price_per_month: row.price_per_month,
                    status: row.status,
                    description: row.description,
                    images: [],
                    occupied_beds: Number(row.occupied_beds) || 0,
                    total_beds: Number(row.total_beds) || 0,
                };
            }

            if (row.image_url) {
                roomsMap[row.id].images.push(row.image_url);
            }
        });

        res.json(Object.values(roomsMap));

    } catch (error) {
        console.error("Get rooms error:", error);
        res.status(500).json({ message: "Server error" });
    }
};




export const createRoom = async (req: Request, res: Response) => {
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
            return res.status(400).json({ message: "Missing required fields" });
        }

        const existingRoom = await pool.query(
            "SELECT * FROM rooms WHERE room_number = $1",
            [room_number]
        );

        if (existingRoom.rows.length > 0) {
            return res.status(400).json({ message: "Room number already exists" });
        }

        const allowedStatuses = ["Available", "Occupied"];
        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({ message: "Invalid status" });
        }

        const result = await pool.query(
            `INSERT INTO rooms
      (room_number, capacity, price_per_month, status, description)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *`,
            [room_number, capacity, price_per_month, status, description]
        );

        const room = result.rows[0];
        const roomId = room.id;

        for (let i = 1; i <= bed_count; i++) {
            await pool.query(
                `INSERT INTO beds (room_id, bed_number)
         VALUES ($1, $2)`,
                [roomId, `Bed ${i}`]
            );
        }


        let imageUrls: string[] = [];
        const files = req.files;

        if (Array.isArray(files)) {
            for (const file of files as Express.Multer.File[]) {
                const uploadResult: any = await new Promise((resolve, reject) => {
                    const stream = cloudinary.uploader.upload_stream(
                        { folder: "rooms" },
                        (error, result) => {
                            if (error) return reject(error);
                            resolve(result);
                        }
                    );
                    stream.end(file.buffer);
                });

                imageUrls.push(uploadResult.secure_url);
            }
        }


        for (const url of imageUrls) {
            await pool.query(
                `INSERT INTO room_images (room_id, image_url)
         VALUES ($1, $2)`,
                [roomId, url]
            );
        }

        res.status(201).json({
            message: "Room created successfully",
            room,
            images: imageUrls,
        });

    } catch (error: any) {
        console.error("Create room error:", error);

        res.status(error?.http_code || 500).json({
            message: error?.message || "Server error",
        });
    }
};






export const updateRoom = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const {
      room_number,
      capacity,
      bed_count,
      price_per_month,
      description,
    } = req.body;

    
    const roomCheck = await pool.query(
      "SELECT * FROM rooms WHERE id = $1",
      [id]
    );

    if (roomCheck.rows.length === 0) {
      return res.status(404).json({ message: "Room not found" });
    }

    const currentRoom = roomCheck.rows[0];

    
    if (room_number && room_number !== currentRoom.room_number) {
      const existingRoom = await pool.query(
        "SELECT * FROM rooms WHERE room_number = $1 AND id != $2",
        [room_number, id]
      );

      if (existingRoom.rows.length > 0) {
        return res.status(400).json({ message: "Room number already exists" });
      }
    }

    
    const finalCapacity = capacity ?? currentRoom.capacity;

    if (bed_count !== undefined) {
      if (bed_count <= 0) {
        return res.status(400).json({
          message: "Bed count must be greater than 0",
        });
      }

      if (bed_count > finalCapacity) {
        return res.status(400).json({
          message: "Beds cannot exceed room capacity",
        });
      }
    }

   
    await pool.query(
      `UPDATE rooms SET
        room_number = COALESCE($1, room_number),
        capacity = COALESCE($2, capacity),
        price_per_month = COALESCE($3, price_per_month),
        description = COALESCE($4, description),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $5`,
      [room_number, capacity, price_per_month, description, id]
    );

   
    if (bed_count !== undefined) {
      const bedsResult = await pool.query(
        "SELECT COUNT(*) FROM beds WHERE room_id = $1",
        [id]
      );

      const totalBeds = Number(bedsResult.rows[0].count);

      // ➕ ADD BEDS
      if (bed_count > totalBeds) {
        for (let i = totalBeds + 1; i <= bed_count; i++) {
          await pool.query(
            `INSERT INTO beds (room_id, bed_number)
             VALUES ($1, $2)`,
            [id, `Bed ${i}`]
          );
        }
      }

      // ➖ REMOVE BEDS (SAFE)
      if (bed_count < totalBeds) {
        const occupiedBeds = await pool.query(
          `SELECT COUNT(*) FROM beds 
           WHERE room_id = $1 AND status = 'Occupied'`,
          [id]
        );

        if (Number(occupiedBeds.rows[0].count) > bed_count) {
          return res.status(400).json({
            message: "Cannot reduce beds below occupied beds",
          });
        }

        await pool.query(
          `DELETE FROM beds 
           WHERE id IN (
             SELECT id FROM beds
             WHERE room_id = $1
             AND status = 'Available'
             ORDER BY id DESC
             LIMIT $2
           )`,
          [id, totalBeds - bed_count]
        );
      }
    }

   
    await pool.query(
      `UPDATE rooms
       SET status = CASE
         WHEN (
           SELECT COUNT(*) FROM beds WHERE room_id = $1
         ) > 0
         AND (
           SELECT COUNT(*) FROM beds WHERE room_id = $1 AND status = 'Occupied'
         ) = (
           SELECT COUNT(*) FROM beds WHERE room_id = $1
         )
        THEN 'Occupied'
        ELSE 'Available'
       END
       WHERE id = $1`,
      [id]
    );

    const files = req.files;

    if (Array.isArray(files)) {
      for (const file of files as Express.Multer.File[]) {
        const uploadResult: any = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: "rooms" },
            (error, result) => {
              if (error) return reject(error);
              resolve(result);
            }
          );

          stream.end(file.buffer);
        });

        await pool.query(
          `INSERT INTO room_images (room_id, image_url)
           VALUES ($1, $2)`,
          [id, uploadResult.secure_url]
        );
      }
    }

    
    const updatedRoom = await pool.query(
      "SELECT * FROM rooms WHERE id = $1",
      [id]
    );

    res.json({
      message: "Room updated successfully",
      room: updatedRoom.rows[0],
    });

  } catch (error) {
    console.error("Update room error:", error);

    res.status(500).json({
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

    const room = roomCheck.rows[0];

    
    const occupiedBeds = await pool.query(
      `SELECT COUNT(*) FROM beds 
       WHERE room_id = $1 AND status = 'Occupied'`,
      [id]
    );

    if (Number(occupiedBeds.rows[0].count) > 0) {
      return res.status(400).json({
        message: "Cannot delete room with occupied beds",
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