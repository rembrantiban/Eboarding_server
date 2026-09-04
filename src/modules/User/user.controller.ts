import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../../config/db";
import { resend } from "../../config/resend"
import cloudinary from "../../config/cloudinary";
import { UploadApiResponse } from "cloudinary";
import { AuthRequest } from "../../types/auth";

export const register = async (req: Request, res: Response) => {
  try {
    const {
      first_name,
      last_name,
      email,
      username,
      country_code,
      contact_number,
      nationality,
      address,
      password,
      user_type,
      gender,
      age,
      valid_id_type,
      emergency_contact_name,
      emergency_contact_number,
      emergency_contact_relationship,
    } = req.body;

    const existingUser = await pool.query(
      "SELECT * FROM users WHERE email = $1 OR username = $2",
      [email, username]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        message: "Username or email already exists",
      });
    }

    // ✅ Type-safe access to upload.fields()
    const files = req.files as unknown as {
      avatar?: Express.Multer.File[];
      valid_id_image?: Express.Multer.File[];
    };

    let avatarUrl: string | null = null;
    let validIdImage: string | null = null;

    // Upload Avatar
    if (files.avatar?.length) {
      const uploadResult = await new Promise<UploadApiResponse>(
        (resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: "avatars" },
            (error, result) => {
              if (error || !result) return reject(error);
              resolve(result);
            }
          );

          stream.end(files.avatar?.[0]?.buffer);
        }
      );

      avatarUrl = uploadResult.secure_url;
    }

    // Upload Valid ID
    if (files.valid_id_image?.length) {
      const uploadResult = await new Promise<UploadApiResponse>(
        (resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: "valid_ids" },
            (error, result) => {
              if (error || !result) return reject(error);
              resolve(result);
            }
          );

          stream.end(files.valid_id_image?.[0]?.buffer);
        }
      );

      validIdImage = uploadResult.secure_url;

    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `
      INSERT INTO users
      (
        first_name,
        last_name,
        email,
        username,
        country_code,
        contact_number,
        nationality,
        address,
        password,
        avatar_url,
        gender,
        age,
        valid_id_type,
        valid_id_image,
        emergency_contact_name,
        emergency_contact_number,
        emergency_contact_relationship,
        user_type
      )
      VALUES
      (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18
      )
      RETURNING
        id,
        user_id_no,
        first_name,
        last_name,
        email,
        username,
        country_code,
        contact_number,
        nationality,
        address,
        avatar_url,
        gender,
        age,
        valid_id_type,
        valid_id_image,
        emergency_contact_name,
        emergency_contact_number,
        emergency_contact_relationship,
        user_type,
        status,
        created_at
      `,
      [
        first_name,
        last_name,
        email,
        username,
        country_code,
        contact_number,
        nationality,
        address,
        hashedPassword,
        avatarUrl,
        gender || null,
        age ? Number(age) : null,
        valid_id_type,
        validIdImage,
        emergency_contact_name || null,
        emergency_contact_number || null,
        emergency_contact_relationship || null,
        user_type,
      ]
    );

    return res.status(201).json({
      message: "User registered successfully",
      user: result.rows[0],
    });

  } catch (error) {
    console.error("Register Error:", error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { identifier, password } = req.body;

    const result = await pool.query(
      `
        SELECT *
        FROM users
        WHERE email = $1 OR username = $1
        `,
      [identifier]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    const user = result.rows[0];

    if (user.is_deleted) {
      return res.status(403).json({
        message: "This account is no longer available.",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    if (user.status === "Pending") {
      return res.status(403).json({
        message: "Your account is waiting for approval.",
      });
    }

    if (user.account_status === "Deactivate") {
      return res.status(403).json({
        message: "Your account has been deactivated. Please contact the administrator.",
      });
    }

    if (user.status === "Rejected") {
      return res.status(403).json({
        message: "Your account has been rejected.",
      });
    }

    const token = jwt.sign(
      { id: user.id, user_type: user.user_type },
      process.env.JWT_SECRET as string,
      { expiresIn: "1d" }
    );

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        username: user.username,
        user_type: user.user_type,
        address: user.address,
        country_code: user.country_code,
        nationality: user.nationality,
        contact_number: user.contact_number,
        avatar_url: user.avatar_url,
        valid_id_type: user.valid_id_type,
        valid_id_image: user.valid_id_image,
        emergency_contact_name: user.emergency_contact_name,
        emergency_contact_number: user.emergency_contact_number,
        emergency_contact_relationship: user.emergency_contact_relationship,

      },
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

export const createUserByAdmin = async (req: Request, res: Response) => {
  try {
    const {
      first_name,
      last_name,
      email,
      username,
      country_code,
      nationality,
      contact_number,
      address,
      password,
      user_type,
      gender,
      age,
      valid_id_type,
      emergency_contact_name,
      emergency_contact_number,
      emergency_contact_relationship,
    } = req.body;

    const allowedRoles = ["Admin", "Staff", "Boarder"];

    if (!allowedRoles.includes(user_type)) {
      return res.status(400).json({
        message: "Invalid user type",
      });
    }

    const existingUser = await pool.query(
      "SELECT * FROM users WHERE email = $1 OR username = $2",
      [email, username]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        message: "Email or username already exists",
      });
    }

    const files = req.files as
      | {
        [fieldname: string]: Express.Multer.File[];
      }
      | undefined;

    let avatarUrl: string | null = null;
    let validIdImage: string | null = null;

    // Upload Avatar
    if (files?.avatar?.[0]) {
      const uploadResult = await new Promise<UploadApiResponse>(
        (resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: "avatars" },
            (error, result) => {
              if (error || !result) return reject(error);
              resolve(result);
            }
          );

          stream.end(files.avatar[0].buffer);
        }
      );

      avatarUrl = uploadResult.secure_url;
    }

    // Upload Valid ID
    if (files?.valid_id_image?.[0]) {
      const uploadResult = await new Promise<UploadApiResponse>(
        (resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: "valid_ids" },
            (error, result) => {
              if (error || !result) return reject(error);
              resolve(result);
            }
          );

          stream.end(files.valid_id_image[0].buffer);
        }
      );

      validIdImage = uploadResult.secure_url;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `
      INSERT INTO users
      (
        first_name,
        last_name,
        email,
        username,
        country_code,
        nationality,
        contact_number,
        address,
        password,
        avatar_url,
        gender,
        age,
        valid_id_type,
        valid_id_image,
        emergency_contact_name,
        emergency_contact_number,
        emergency_contact_relationship,
        user_type,
        status
      )
      VALUES
      (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'Approved'
      )

      RETURNING
        id,
        user_id_no,
        first_name,
        last_name,
        email,
        username,
        country_code,
        contact_number,
        address,
        avatar_url,
        gender,
        age,
        valid_id_type,
        valid_id_image,
        emergency_contact_name,
        emergency_contact_number,
        emergency_contact_relationship,
        user_type,
        status
      `,
      [
        first_name,
        last_name,
        email,
        username,
        nationality,
        country_code,
        contact_number,
        address,
        hashedPassword,
        avatarUrl,
        gender,
        age || null,
        valid_id_type,
        validIdImage,
        emergency_contact_name,
        emergency_contact_number,
        emergency_contact_relationship,
        user_type,
      ]
    );

    return res.status(201).json({
      message: "User created successfully",
      user: result.rows[0],
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};

export const createUserByStaff = async (req: Request, res: Response) => {
  try {
    const {
      first_name,
      last_name,
      email,
      username,
      country_code,
      contact_number,
      nationality,
      address,
      password,
      user_type,
      gender,
      age,
      valid_id_type,
      emergency_contact_name,
      emergency_contact_number,
      emergency_contact_relationship,
    } = req.body;

    const allowedRoles = ["Staff", "Boarder"];

    if (!allowedRoles.includes(user_type)) {
      return res.status(400).json({
        message: "Invalid user type",
      });
    }

    const existingUser = await pool.query(
      "SELECT * FROM users WHERE email = $1 OR username = $2",
      [email, username]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        message: "Email or username already exists",
      });
    }

    const files = req.files as
      | {
        [fieldname: string]: Express.Multer.File[];
      }
      | undefined;

    let avatarUrl: string | null = null;
    let validIdImage: string | null = null;

    // Upload Avatar
    if (files?.avatar?.[0]) {
      const uploadResult = await new Promise<UploadApiResponse>(
        (resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: "avatars" },
            (error, result) => {
              if (error || !result) return reject(error);
              resolve(result);
            }
          );

          stream.end(files.avatar[0].buffer);
        }
      );

      avatarUrl = uploadResult.secure_url;
    }

    // Upload Valid ID
    if (files?.valid_id_image?.[0]) {
      const uploadResult = await new Promise<UploadApiResponse>(
        (resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: "valid_ids" },
            (error, result) => {
              if (error || !result) return reject(error);
              resolve(result);
            }
          );

          stream.end(files.valid_id_image[0].buffer);
        }
      );

      validIdImage = uploadResult.secure_url;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `
      INSERT INTO users
      (
        first_name,
        last_name,
        email,
        username,
        country_code,
        contact_number,
        nationality,
        address,
        password,
        avatar_url,
        gender,
        age,
        valid_id_image,
        valid_id_type,
        emergency_contact_name,
        emergency_contact_number,
        emergency_contact_relationship,
        user_type,
        status
      )
      VALUES
      (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'Approved'
      )

      RETURNING
        id,
        user_id_no,
        first_name,
        last_name,
        email,
        username,
        country_code,
        contact_number,
        nationality,
        address,
        avatar_url,
        gender,
        age,
        valid_id_type,
        valid_id_image,
        emergency_contact_name,
        emergency_contact_number,
        emergency_contact_relationship,
        user_type,
        status
      `,
      [
        first_name,
        last_name,
        email,
        username,
        country_code,
        contact_number,
        nationality,
        address,
        hashedPassword,
        avatarUrl,
        gender,
        age || null,
        valid_id_type,
        validIdImage,
        emergency_contact_name,
        emergency_contact_number,
        emergency_contact_relationship,
        user_type,
      ]
    );

    return res.status(201).json({
      message: "User created successfully",
      user: result.rows[0],
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};

export const getAllUsers = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const currentUserType = req.user?.user_type;

    let userFilter = "";

    if (currentUserType === "Admin") {
      userFilter = `u.user_type != 'Admin'`;
    } else if (currentUserType === "Staff") {
      userFilter = `u.user_type = 'Boarder'`;
    } else {
      return res.status(403).json({
        message: "Access denied",
      });
    }

    const query = `
        SELECT
          u.id,
          u.user_id_no,
          u.first_name,
          u.last_name,
          u.email,
          u.username,
          u.country_code,
          u.contact_number,
          u.address,
          u.avatar_url,
          u.nationality,

          u.gender,
          u.age,
          u.valid_id_image,
          u.valid_id_status,
          u.emergency_contact_name,
          u.emergency_contact_number,
          u.emergency_contact_relationship,

          u.user_type,
          u.status,
          u.account_status,

          u.created_at,
          u.updated_at,

          (b.id IS NOT NULL) AS is_assigned,

          r.room_number,
          bed.bed_number

        FROM users u

        LEFT JOIN LATERAL (
          SELECT id, room_id, bed_id
          FROM boarders
          WHERE user_id = u.id
            AND status = 'Active'
          ORDER BY created_at DESC
          LIMIT 1
        ) b ON TRUE

        LEFT JOIN rooms r
          ON b.room_id = r.id

        LEFT JOIN beds bed
          ON b.bed_id = bed.id

        WHERE
          ${userFilter}
          AND u.is_deleted = FALSE

        ORDER BY u.created_at DESC
      `;

    const result = await pool.query(query);

    return res.json({
      users: result.rows,
      total: result.rows.length,
    });

  } catch (error) {
    console.error("Get users error:", error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};

export const getAvailableBoarders = async (
  req: Request,
  res: Response
) => {
  try {
    const result = await pool.query(`
      SELECT
        u.id,
        u.user_id_no,
        u.first_name,
        u.last_name,
        u.email,
        u.country_code,
        u.contact_number,
        u.avatar_url,
        u.gender,
        u.age,
        u.nationality

      FROM users u

      WHERE
        u.user_type = 'Boarder'
        AND u.status = 'Approved'
        AND u.account_status = 'Active'
        AND u.valid_id_status = 'Approved'

        AND NOT EXISTS (
          SELECT 1
          FROM room_assignments ra
          WHERE
            ra.user_id = u.id
            AND ra.status = 'Active'
        )

      ORDER BY
        u.first_name,
        u.last_name;
    `);

    return res.status(200).json(result.rows);

  } catch (error) {
    console.error("Get available boarders error:", error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};

export const deleteUserAccount = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const { id } = req.params;

    const userCheck = await pool.query(
      "SELECT * FROM users WHERE id = $1 AND is_deleted = FALSE",
      [id]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    const user = userCheck.rows[0];

    if (user.user_type === "Admin") {
      return res.status(403).json({
        message: "Cannot delete Admin account",
      });
    }

    await pool.query(
      `
      UPDATE users
      SET
          is_deleted = TRUE,
          deleted_at = NOW(),
          deleted_by = $2
      WHERE id = $1
      `,
      [id, req.user?.id]
    );

    return res.status(200).json({
      message: "User archived successfully.",
    });

  } catch (error) {
    console.error("Delete user error:", error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};

export const getAllDeletedUserAccounts = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const currentUserType = req.user?.user_type;

    let userFilter = "";

    if (currentUserType === "Admin") {
      userFilter = `u.user_type != 'Admin'`;
    } else if (currentUserType === "Staff") {
      userFilter = `u.user_type = 'Boarder'`;
    } else {
      return res.status(403).json({
        message: "Access denied",
      });
    }

    const result = await pool.query(
      `
          SELECT
          u.id,
          u.user_id_no,
          u.first_name,
          u.last_name,
          u.email,
          u.username,
          u.contact_number,
          u.address,
          u.avatar_url,
          u.gender,
          u.age,
          u.nationality,
          u.country_code,
          u.valid_id_image,
          u.valid_id_status,
          u.user_type,
          u.status,
          u.account_status,
          u.deleted_at,

          admin.first_name || ' ' || admin.last_name AS deleted_by_name,
          admin.avatar_url AS deleted_by_avatar

      FROM users u

      LEFT JOIN users admin
          ON admin.id = u.deleted_by

      WHERE
          ${userFilter}
          AND u.is_deleted = TRUE

      ORDER BY u.deleted_at DESC;
      `
    );

    return res.status(200).json({
      users: result.rows,
      total: result.rows.length,
    });

  } catch (error) {
    console.error("Get deleted users error:", error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};

export const updateUser = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const {
      first_name,
      last_name,
      email,
      username,
      address,
      password,
      user_type,
      contact_number,
      is_assigned,
      nationality,
      country_code
    } = req.body;

    // 🔷 check if user exists
    const userCheck = await pool.query(
      "SELECT * FROM users WHERE id = $1",
      [id]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const existingUser = userCheck.rows[0];

    if (existingUser.user_type === "Admin" && user_type && user_type !== "Admin") {
      return res.status(403).json({
        message: "Cannot change Admin role",
      });
    }

    let hashedPassword = existingUser.password;

    if (password) {
      const salt = await bcrypt.genSalt(10);
      hashedPassword = await bcrypt.hash(password, salt);
    }

    const updatedUser = await pool.query(
      `
      UPDATE users
      SET 
        first_name = $1,
        last_name = $2,
        email = $3,
        username = $4,
        address = $5,
        password = $6,
        user_type = $7,
        country_code = $8,
        contact_number = $9,
        nationality = $10,
        updated_at = CURRENT_TIMESTAMP,
        is_assigned = $11

      WHERE id = $12
      RETURNING id, first_name, last_name, email, username, address, user_type, country_code, contact_number, nationality, is_assigned, created_at, updated_at
      `,
      [
        first_name ?? existingUser.first_name,
        last_name ?? existingUser.last_name,
        email ?? existingUser.email,
        username ?? existingUser.username,
        address ?? existingUser.address,
        hashedPassword,
        user_type ?? existingUser.user_type,
        country_code ?? existingUser.country_code,
        contact_number ?? existingUser.contact_number,
        nationality ?? existingUser.nationality,
        is_assigned ?? existingUser.is_assigned,
        id,
      ]
    );

    res.json({
      message: "User updated successfully",
      user: updatedUser.rows[0],
    });

  } catch (error) {
    console.error("Update user error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const updateProfile = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const userId = req.user.id;

    const { first_name, last_name, username, contact_number, address, email, password } = req.body;

    const existingEmail = await pool.query(
      "SELECT * FROM users WHERE email = $1 AND id != $2",
      [email, userId]
    );

    if (existingEmail.rows.length > 0) {
      return res.status(400).json({ message: "Email already in use" });
    }

    let avatarUrl;

    const file = req.file;

    if (file) {
      const uploadResult = await new Promise<UploadApiResponse>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: "avatars" },
          (error, result) => {
            if (error || !result) return reject(error);
            resolve(result);
          }
        );

        stream.end(file.buffer);
      });

      avatarUrl = uploadResult.secure_url;
    }

    let hashedPassword: string | undefined;

    if (password && password.trim() !== "") {
      hashedPassword = await bcrypt.hash(password, 10);
    }

    const result = await pool.query(
      `UPDATE users SET
        first_name = COALESCE($1, first_name),
        last_name = COALESCE($2, last_name),
        username = COALESCE($3, username),
        contact_number = COALESCE($4, contact_number),
        address = COALESCE($5, address),
        email = COALESCE($6, email),
        password = COALESCE($7, password),
        avatar_url = COALESCE($8, avatar_url),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $9
      RETURNING id, first_name, last_name, username, user_type, contact_number, address , email, avatar_url, country_code, nationality`,
      [
        first_name,
        last_name,
        username,
        contact_number,
        address,
        email,
        hashedPassword,
        avatarUrl,
        userId,
      ]
    );

    res.json({
      message: "Profile updated successfully",
      user: result.rows[0],
    });

  } catch (error) {
    console.error("Update profile error:", error);

    res.status(500).json({
      message: "Server error",
    });
  }
};

export const forgotPassword = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required.",
      });
    }

    const result = await pool.query(
      `
      SELECT
        id,
        email
      FROM users
      WHERE email = $1
      `,
      [email]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "No account found with this email address.",
      });
    }

    const user = result.rows[0];

    const code = Math.floor(
      100000 + Math.random() * 900000
    ).toString();

    await pool.query(
      `
      UPDATE users
      SET
        reset_code = $1,
        reset_code_expiry = NOW() + INTERVAL '10 minutes'
      WHERE id = $2
      `,
      [code, user.id]
    );

    const response = await resend.emails.send({
      from: "E-Boarding <noreply@eboarding.site>",
      to: user.email,
      subject: "Your Password Reset Code",
      html: `
        <div style="margin:0; padding:0; background-color:#f4f6f8; font-family:Arial, sans-serif;">

          <table width="100%" cellpadding="0" cellspacing="0" style="padding:20px;">
            <tr>
              <td align="center">

                <table width="500" cellpadding="0" cellspacing="0" 
                      style="background:#ffffff; border-radius:12px; padding:30px; box-shadow:0 8px 25px rgba(0,0,0,0.05);">
                  
                  <tr>
                    <td align="center" style="padding-bottom:20px;">
                      <h2 style="margin:0; color:#111;">Reset Your Password</h2>
                      <p style="margin:5px 0 0; color:#777;">Use the code below to continue</p>
                    </td>
                  </tr>

                  <tr>
                    <td style="border-top:1px solid #eee; padding-top:20px;"></td>
                  </tr>

                  <tr>
                    <td align="center" style="padding:25px 0;">
                      <div style="
                        display:inline-block;
                        padding:15px 30px;
                        font-size:28px;
                        letter-spacing:8px;
                        font-weight:bold;
                        background:#f3f4f6;
                        border-radius:10px;
                        color:#111;
                      ">
                        ${code}
                      </div>
                    </td>
                  </tr>

                  <tr>
                    <td style="color:#555; font-size:14px; line-height:1.6; text-align:center;">
                      This code will expire in <strong>10 minutes</strong>.<br>
                      If you didn’t request this, you can safely ignore this email.
                    </td>
                  </tr>

                  <tr>
                    <td style="border-top:1px solid #eee; padding-top:20px; text-align:center; font-size:12px; color:#999;">
                      © ${new Date().getFullYear()} E-Boarding House
                    </td>
                  </tr>

                </table>

              </td>
            </tr>
          </table>

        </div>
        `
    });

    console.log(response);

    return res.status(200).json({
      success: true,
      message: "Verification code sent successfully.",
    });


  } catch (error: any) {
    console.error("Forgot Password Error:");
    console.error(error);

    if (error.response) {
      console.error(error.response);
    }

    return res.status(500).json({
      message: error.message || "Server error",
    });
  }
};

export const recoverDeletedUserAccount = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const { id } = req.params;

    const userCheck = await pool.query(
      `
      SELECT *
      FROM users
      WHERE id = $1
      AND is_deleted = TRUE
      `,
      [id]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({
        message: "Deleted user not found.",
      });
    }

    const result = await pool.query(
      `
      UPDATE users
      SET
        is_deleted = FALSE,
        deleted_at = NULL,
        deleted_by = NULL,
        updated_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        user_id_no,
        first_name,
        last_name,
        email,
        username,
        user_type
      `,
      [id]
    );

    return res.status(200).json({
      message: "User account recovered successfully.",
      user: result.rows[0],
    });

  } catch (error) {
    console.error("Recover user error:", error);

    return res.status(500).json({
      message: "Server error",
    });
  }
}

export const resetPassword = async (req: Request, res: Response) => {
  try {
    const { email, code, newPassword } = req.body;

    const result = await pool.query(
      `SELECT * FROM users 
       WHERE email=$1 
       AND reset_code=$2 
       AND reset_code_expiry > NOW()`,
      [email, code]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ message: "Invalid or expired code" });
    }

    const user = result.rows[0];

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await pool.query(
      `UPDATE users 
       SET password=$1, reset_code=NULL, reset_code_expiry=NULL 
       WHERE id=$2`,
      [hashedPassword, user.id]
    );

    res.json({ message: "Password reset successful" });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

export const checkAuthenticated = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    res.json({
      message: "Authenticated",
      user: req.user,
    });

  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

export const countTotalBoarders = async (req: Request, res: Response) => {
  try {
    const total = await pool.query("SELECT COUNT(*) FROM users WHERE user_type='Boarder' AND is_deleted = FALSE");
    res.json({ total: total.rows[0].count });
  }
  catch (error: any) {
    console.log(error);
    res.status(500).json({ message: error.message, });
  }
}

export const updateProfileSettings = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;

    const {
      first_name,
      last_name,
      email,
      password,
    } = req.body;

    console.log("📝 Update profile settings request:", {
      userId,
      hasFile: !!req.file,
      fileName: req.file?.originalname,
      fileSize: req.file?.size,
      fields: { first_name, last_name, email, hasPassword: !!password }
    });

    let avatar_url: string | null = null;
    let hasSetAvatar = false;

    if (req.file) {
      try {
        const uploadResult = await new Promise<UploadApiResponse>((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: "avatars" },
            (error, result) => {
              if (error || !result) {
                console.error("❌ Cloudinary upload error:", error);
                return reject(error);
              }
              console.log("✅ Cloudinary upload success:", result.secure_url);
              resolve(result);
            }
          );
          stream.on("error", (err) => {
            console.error("❌ Stream error:", err);
            reject(err);
          });
          stream.end(req.file!.buffer);
        });

        avatar_url = uploadResult.secure_url;
        hasSetAvatar = true;
      } catch (uploadError) {
        console.error("❌ Avatar upload failed:", uploadError);
        throw uploadError;
      }
    }

    let hashedPassword: string | null = null;

    if (password && password.trim() !== "") {
      hashedPassword = await bcrypt.hash(password, 10);
    }

    const updateQuery = `
        UPDATE users
        SET
          first_name = COALESCE($1, first_name),
          last_name = COALESCE($2, last_name),
          email = COALESCE($3, email),
          password = COALESCE($4, password),
          ${hasSetAvatar ? "avatar_url = $5" : "avatar_url = COALESCE($5, avatar_url)"},
          updated_at = NOW()
        WHERE id = $6
        RETURNING
          id,
          first_name,
          last_name,
          email,
          username,
          avatar_url,
          user_type,
          contact_number,
          address,
          created_at,
          updated_at
      `;

    const result = await pool.query(updateQuery, [
      first_name,
      last_name,
      email,
      hashedPassword,
      avatar_url,
      userId,
    ]);

    if (!result.rows[0]) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    console.log("✅ Profile updated successfully:", {
      userId,
      hasAvatar: !!result.rows[0].avatar_url,
    });

    res.status(200).json({
      message: "Profile updated successfully",
      user: result.rows[0],
    });

  } catch (error) {
    console.error("❌ Update profile settings error:", error);

    res.status(500).json({
      message:
        "Failed to update profile: " + (error instanceof Error ? error.message : "Unknown error"),
    });
  }
};


export const deactivateUserAccount = async (
  req: Request,
  res: Response
) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      UPDATE users
      SET account_status = 'Deactivate'
      WHERE id = $1
      RETURNING
        id,
        user_id_no,
        first_name,
        last_name,
        email,
        username,
        account_status
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    return res.status(200).json({
      message: "User account deactivated successfully",
      user: result.rows[0],
    });

  } catch (error) {
    console.error("Deactivate User Error:", error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};

export const activateUserAccount = async (
  req: Request,
  res: Response
) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      UPDATE users
      SET account_status = 'Active'
      WHERE id = $1
      RETURNING
        id,
        user_id_no,
        first_name,
        last_name,
        email,
        username,
        account_status
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    return res.status(200).json({
      message: "User account activated successfully",
      user: result.rows[0],
    });

  } catch (error) {
    console.error("Activate User Error:", error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};


export const updateUserStatus = async (
  req: Request,
  res: Response
) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const allowedStatus = [
      "Pending",
      "Approved",
      "Rejected",
    ];

    if (!allowedStatus.includes(status)) {
      return res.status(400).json({
        message: "Invalid status.",
      });
    }

    const result = await pool.query(
      `
      UPDATE users
      SET
        status = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING
        id,
        user_id_no,
        first_name,
        last_name,
        email,
        username,
        country_code,
        nationality,
        contact_number,
        address,
        avatar_url,
        gender,
        age,
        valid_id_image,
        emergency_contact_name,
        emergency_contact_number,
        emergency_contact_relationship,
        user_type,
        status,
        account_status,
        created_at,
        updated_at
      `,
      [status, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    return res.status(200).json({
      message: `User ${status.toLowerCase()} successfully.`,
      user: result.rows[0],
    });

  } catch (error) {
    console.error("Update user status:", error);

    return res.status(500).json({
      message: "Server error.",
    });
  }
};


export const getAvailableStaff = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const result = await pool.query(`
      SELECT
        u.id,
        u.user_id_no,
        u.first_name,
        u.last_name,
        u.email,
        u.contact_number,
        u.avatar_url,

        COUNT(mr.id) FILTER (
          WHERE mr.status IN ('Assigned','In Progress')
        ) AS active_requests,

        COUNT(mr.id) FILTER (
          WHERE mr.status = 'Completed'
        ) AS completed_requests,

        COUNT(mr.id) FILTER (
          WHERE mr.status = 'Closed'
        ) AS closed_requests

      FROM users u

      LEFT JOIN maintenance_requests mr
        ON mr.assigned_staff_id = u.id

      WHERE
        u.user_type = 'Staff'
        AND u.status = 'Approved'
        AND u.account_status = 'Active'
        AND u.is_deleted = FALSE

      GROUP BY
        u.id

      ORDER BY
        active_requests ASC,
        u.first_name ASC,
        u.last_name ASC
    `);

    return res.status(200).json(result.rows);

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      message: "Server error",
    });

  }
};


export const getStaffDashboardStats = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const [
      currentBoarders,
      previousBoarders,
      totalRooms,
      activePenalties,
      previousPenalties,
      revenue,
    ] = await Promise.all([
      // Current active boarders
      pool.query(`
        SELECT COUNT(*)::int AS count
        FROM users
        WHERE user_type = 'Boarder'
        AND account_status = 'Active'
      `),

      // Boarders registered last month
      pool.query(`
        SELECT COUNT(*)::int AS count
        FROM users
        WHERE user_type = 'Boarder'
        AND account_status = 'Active'
        AND DATE_TRUNC('month', created_at)
          = DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
      `),

      // Total rooms
      pool.query(`
        SELECT COUNT(*)::int AS count
        FROM rooms
      `),

      // Current active penalties
      pool.query(`
        SELECT COUNT(*)::int AS count
        FROM billings
        WHERE late_fee > 0
        AND status IN ('Pending', 'Partial', 'Overdue')
      `),

      // Previous month penalties
      pool.query(`
        SELECT COUNT(*)::int AS count
        FROM billings
        WHERE late_fee > 0
        AND status IN ('Pending', 'Partial', 'Overdue')
        AND DATE_TRUNC('month', created_at)
          = DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
      `),

      // Revenue
      // Revenue (same logic as Admin Dashboard)
      pool.query(`
      SELECT
        COALESCE(
          SUM(
            CASE
              WHEN DATE_TRUNC('month', received_at)
                = DATE_TRUNC('month', CURRENT_DATE)
              THEN amount
              ELSE 0
            END
          ),
          0
        ) AS current_month,

        COALESCE(
          SUM(
            CASE
              WHEN DATE_TRUNC('month', received_at)
                = DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
              THEN amount
              ELSE 0
            END
          ),
          0
        ) AS previous_month

      FROM billing_payments
    `),
    ]);

    const boardersCurrent = Number(
      currentBoarders.rows[0].count
    );

    const boardersPrevious = Number(
      previousBoarders.rows[0].count
    );

    const penaltiesCurrent = Number(
      activePenalties.rows[0].count
    );

    const penaltiesPrevious = Number(
      previousPenalties.rows[0].count
    );

    const revenueCurrent = Number(
      revenue.rows[0].current_month
    );

    const revenuePrevious = Number(
      revenue.rows[0].previous_month
    );

    const calculateDelta = (
      current: number,
      previous: number
    ): number => {
      if (previous === 0) {
        return current > 0 ? 100 : 0;
      }

      return Number(
        (
          ((current - previous) / previous) *
          100
        ).toFixed(1)
      );
    };

    return res.status(200).json({
      totalBoarders: {
        value: boardersCurrent,
        delta: calculateDelta(
          boardersCurrent,
          boardersPrevious
        ),
      },

      totalRooms: {
        value: Number(totalRooms.rows[0].count),
        delta: 0,
      },

      activePenalties: {
        value: penaltiesCurrent,
        delta: calculateDelta(
          penaltiesCurrent,
          penaltiesPrevious
        ),
      },

      monthlyRevenue: {
        value: revenueCurrent,
        delta: calculateDelta(
          revenueCurrent,
          revenuePrevious
        ),
      },
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Failed to load dashboard stats",
    });
  }
};

export const getBoarderStats = async (
  req: Request,
  res: Response
) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) FILTER (
          WHERE user_type = 'Boarder'
        ) AS total_boarders,

        COUNT(*) FILTER (
          WHERE user_type = 'Boarder'
          AND gender = 'Male'
        ) AS male_boarders,

        COUNT(*) FILTER (
          WHERE user_type = 'Boarder'
          AND gender = 'Female'
        ) AS female_boarders,

        COUNT(*) FILTER (
          WHERE user_type = 'Boarder'
          AND account_status = 'Active'
        ) AS active_boarders
      FROM users
      WHERE is_deleted = FALSE
    `);

    const stats = result.rows[0];

    const total = Number(stats.total_boarders);
    const male = Number(stats.male_boarders);
    const female = Number(stats.female_boarders);
    const active = Number(stats.active_boarders);

    return res.json({
      totalBoarders: total,
      maleBoarders: male,
      femaleBoarders: female,
      activeBoarders: active,

      malePercentage:
        total > 0
          ? parseFloat(((male / total) * 100).toFixed(1))
          : 0,

      femalePercentage:
        total > 0
          ? parseFloat(((female / total) * 100).toFixed(1))
          : 0,

      activePercentage:
        total > 0
          ? parseFloat(((active / total) * 100).toFixed(1))
          : 0,
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Failed to load boarder statistics",
    });
  }
};

export const getBoarderStatusStats = async (
  req: Request,
  res: Response
) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) FILTER (
          WHERE user_type = 'Boarder'
          AND account_status = 'Active'
        ) AS active_count,

        COUNT(*) FILTER (
          WHERE user_type = 'Boarder'
          AND account_status = 'Deactivate'
        ) AS deactivate_count,

        COUNT(*) FILTER (
          WHERE user_type = 'Boarder'
        ) AS total_count

      FROM users
      WHERE is_deleted = FALSE
    `);

    const active = Number(result.rows[0].active_count);
    const deactivate = Number(result.rows[0].deactivate_count);
    const total = Number(result.rows[0].total_count);

    const activePct =
      total > 0
        ? ((active / total) * 100).toFixed(1)
        : "0.0";

    const deactivatePct =
      total > 0
        ? ((deactivate / total) * 100).toFixed(1)
        : "0.0";

    return res.status(200).json([
      {
        name: "Active",
        value: active,
        pct: `${activePct}%`,
        color: "#059669",
      },
      {
        name: "Deactivate",
        value: deactivate,
        pct: `${deactivatePct}%`,
        color: "#eab308",
      },
    ]);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Failed to load boarder status statistics",
    });
  }
};

export const getBoardersOverTime = async (
  req: Request,
  res: Response
) => {
  try {
    const result = await pool.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', created_at), 'Mon') AS month,
        COUNT(*)::int AS total
      FROM users
      WHERE user_type = 'Boarder'
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY DATE_TRUNC('month', created_at)
    `);

    res.status(200).json(result.rows);

  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Failed to load boarder trends",
    });
  }
};

export const getRecentBoarders = async (
  req: Request,
  res: Response
) => {
  try {
    const result = await pool.query(`
      SELECT
        u.user_id_no,

        CONCAT(
          u.first_name,
          ' ',
          u.last_name
        ) AS name,

        COALESCE(
          r.room_number,
          'Not Assigned'
        ) AS room,

        CASE
          WHEN ra.assigned_date IS NOT NULL
          THEN TO_CHAR(
            ra.assigned_date,
            'Mon DD, YYYY'
          )
          ELSE 'N/A'
        END AS check_in,

        u.account_status AS status,

        CONCAT(
          COALESCE(u.country_code, ''),
          ' ',
          COALESCE(u.contact_number, '')
        ) AS contact

      FROM users u

      LEFT JOIN LATERAL (
        SELECT *
        FROM room_assignments
        WHERE user_id = u.id
        ORDER BY assigned_date DESC
        LIMIT 1
      ) ra ON TRUE

      LEFT JOIN rooms r
        ON r.id = ra.room_id

      WHERE u.user_type = 'Boarder'
        AND u.is_deleted = FALSE
        AND u.valid_id_status = 'Approved'

      ORDER BY u.created_at DESC
      LIMIT 5
    `);

    return res.status(200).json(
      result.rows
    );

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message:
        "Failed to load recent boarders",
    });
  }
};

export const getBoardersList = async (
  req: Request,
  res: Response
) => {
  try {
    const result = await pool.query(`
      SELECT
        u.user_id_no,
        CONCAT(u.first_name, ' ', u.last_name) AS name,
        u.gender,
        u.age,
        u.contact_number,
        u.email,
        u.account_status,

        r.room_number,

        ra.assigned_date AS check_in

      FROM users u

      LEFT JOIN room_assignments ra
        ON ra.user_id = u.id
        AND ra.status = 'Active'

      LEFT JOIN rooms r
        ON r.id = ra.room_id

      WHERE
        u.user_type = 'Boarder'
        AND u.is_deleted = FALSE

      ORDER BY u.created_at DESC
    `);

    return res.status(200).json(result.rows);

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Failed to load boarders"
    });
  }
};


export const getBoarderSummary = async (
  req: Request,
  res: Response
) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) FILTER (
          WHERE user_type = 'Boarder'
          AND is_deleted = FALSE
          AND valid_id_status = 'Approved'
        )::int AS total_boarders,

        COUNT(*) FILTER (
          WHERE user_type = 'Boarder'
          AND account_status = 'Active'
          AND is_deleted = FALSE
          AND valid_id_status = 'Approved'
        )::int AS active_boarders,

        COUNT(*) FILTER (
          WHERE user_type = 'Boarder'
          AND account_status = 'Deactivate'
          AND is_deleted = FALSE
          AND valid_id_status = 'Approved'
        )::int AS deactivate_boarders,

        COUNT(*) FILTER (
          WHERE user_type = 'Boarder'
          AND gender = 'Male'
          AND is_deleted = FALSE
          AND valid_id_status = 'Approved'
        )::int AS male_boarders,

        COUNT(*) FILTER (
          WHERE user_type = 'Boarder'
          AND gender = 'Female'
          AND is_deleted = FALSE
          AND valid_id_status = 'Approved'
        )::int AS female_boarders,

        COUNT(*) FILTER (
          WHERE user_type = 'Boarder'
          AND is_deleted = FALSE
          AND valid_id_status = 'Approved'
          AND DATE_TRUNC('month', created_at)
              = DATE_TRUNC('month', CURRENT_DATE)
        )::int AS new_this_month

      FROM users
    `);

    const checkedOutResult = await pool.query(`
      SELECT COUNT(*)::int AS checked_out_this_month
      FROM room_assignments
      WHERE status = 'Checked-Out'
      AND DATE_TRUNC('month', actual_checkout)
          = DATE_TRUNC('month', CURRENT_DATE)
    `);

    const current = result.rows[0];

    const previousMonth = await pool.query(`
      SELECT COUNT(*)::int AS total
      FROM users
      WHERE user_type = 'Boarder'
      AND is_deleted = FALSE
      AND valid_id_status = 'Approved'
      AND created_at <
          DATE_TRUNC('month', CURRENT_DATE)
    `);

    const previousTotal =
      Number(previousMonth.rows[0].total);

    const currentTotal =
      Number(current.total_boarders);

    const percentageChange =
      previousTotal > 0
        ? (
            ((currentTotal - previousTotal) /
              previousTotal) *
            100
          ).toFixed(1)
        : "0";

    return res.status(200).json({
      totalBoarders: Number(
        current.total_boarders
      ),
      activeBoarders: Number(
        current.active_boarders
      ),
      deactivateBoarders: Number(
        current.deactivate_boarders
      ),
      checkedOutBoarders: Number(
        checkedOutResult.rows[0]
          .checked_out_this_month
      ),
      maleBoarders: Number(
        current.male_boarders
      ),
      femaleBoarders: Number(
        current.female_boarders
      ),
      newThisMonth: Number(
        current.new_this_month
      ),
      checkedOutThisMonth: Number(
        checkedOutResult.rows[0]
          .checked_out_this_month
      ),
      percentageChange: Number(
        percentageChange
      ),
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message:
        "Failed to load boarder summary",
    });
  }
};

export const resetUserPassword = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        message:
          "Password must be at least 6 characters long.",
      });
    }

    const userResult = await pool.query(
      `SELECT id, first_name, last_name, email, username
       FROM users
       WHERE id = $1`,
      [id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    const hashedPassword = await bcrypt.hash(
      newPassword,
      10
    );

    await pool.query(
      `UPDATE users
       SET
         password = $1,
         reset_code = NULL,
         reset_code_expiry = NULL
       WHERE id = $2`,
      [hashedPassword, id]
    );

    return res.status(200).json({
      message:
        "Password has been reset successfully.",
      user: userResult.rows[0],
    });

  } catch (error) {
    console.error("Reset User Password Error:", error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};