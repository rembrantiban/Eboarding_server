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
      contact_number,
      address,
      password,
      user_type,
      gender,
      age,
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
        message: "User already exists",
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
        contact_number,
        address,
        password,
        avatar_url,
        gender,
        age,
        valid_id_image,
        emergency_contact_name,
        emergency_contact_number,
        emergency_contact_relationship,
        user_type
      )
      VALUES
      (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
      )
      RETURNING
        id,
        user_id_no,
        first_name,
        last_name,
        email,
        username,
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
        created_at
      `,
      [
        first_name,
        last_name,
        email,
        username,
        contact_number,
        address,
        hashedPassword,
        avatarUrl,
        gender || null,
        age ? Number(age) : null,
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
      "SELECT * FROM users WHERE email = $1 OR username = $1",
      [identifier]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const user = result.rows[0];

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    if (user.status === "Pending") {
      return res.status(403).json({
        message: "Your account is waiting for approval.",
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
        contact_number: user.contact_number,
        avatar_url: user.avatar_url
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
      contact_number,
      address,
      password,
      user_type,
      gender,
      age,
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
        contact_number,
        address,
        password,
        avatar_url,
        gender,
        age,
        valid_id_image,
        emergency_contact_name,
        emergency_contact_number,
        emergency_contact_relationship,
        user_type,
        status
      )
      VALUES
      (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'Approved'
      )

      RETURNING
        id,
        user_id_no,
        first_name,
        last_name,
        email,
        username,
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
        status
      `,
      [
        first_name,
        last_name,
        email,
        username,
        contact_number,
        address,
        hashedPassword,
        avatarUrl,
        gender,
        age || null,
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
      contact_number,
      address,
      password,
      user_type,
      gender,
      age,
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
        contact_number,
        address,
        password,
        avatar_url,
        gender,
        age,
        valid_id_image,
        emergency_contact_name,
        emergency_contact_number,
        emergency_contact_relationship,
        user_type,
        status
      )
      VALUES
      (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'Approved'
      )

      RETURNING
        id,
        user_id_no,
        first_name,
        last_name,
        email,
        username,
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
        status
      `,
      [
        first_name,
        last_name,
        email,
        username,
        contact_number,
        address,
        hashedPassword,
        avatarUrl,
        gender,
        age || null,
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
        u.contact_number,
        u.address,
        u.avatar_url,

        u.gender,
        u.age,
        u.valid_id_image,

        u.emergency_contact_name,
        u.emergency_contact_number,
        u.emergency_contact_relationship,

        u.user_type,
        u.status,

        u.created_at,
        u.updated_at,

        (b.id IS NOT NULL) AS is_assigned,

        r.room_number,
        bed.bed_number

      FROM users u

      LEFT JOIN boarders b
        ON b.user_id = u.id
        AND b.status = 'Active'

      LEFT JOIN rooms r
        ON b.room_id = r.id

      LEFT JOIN beds bed
        ON b.bed_id = bed.id

      WHERE ${userFilter}

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

export const deleteUserAccount = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const userCheck = await pool.query(
      "SELECT * FROM users WHERE id = $1",
      [id]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const user = userCheck.rows[0];

    if (user.user_type === "Admin") {
      return res.status(403).json({ message: "Cannot delete Admin account" });
    }

    await pool.query("DELETE FROM users WHERE id = $1", [id]);

    res.json({ message: "User deleted successfully" });

  } catch (error) {
    console.error("Delete user error:", error);
    res.status(500).json({ message: "Server error" });
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
      is_assigned
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
        contact_number = $8,
        updated_at = CURRENT_TIMESTAMP,
        is_assigned = $9

      WHERE id = $10
      RETURNING id, first_name, last_name, email, username, address, user_type, contact_number, is_assigned, created_at, updated_at
      `,
      [
        first_name ?? existingUser.first_name,
        last_name ?? existingUser.last_name,
        email ?? existingUser.email,
        username ?? existingUser.username,
        address ?? existingUser.address,
        hashedPassword,
        user_type ?? existingUser.user_type,
        contact_number ?? existingUser.contact_number,
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
      RETURNING id, first_name, last_name, username, user_type, contact_number, address , email, avatar_url`,
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

    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );

    if (result.rows.length === 0) {
      return res.json({ message: "If email exists, code sent" });
    }

    const user = result.rows[0];

    const code = Math.floor(100000 + Math.random() * 900000).toString();

    await pool.query(
      `UPDATE users 
       SET reset_code=$1, reset_code_expiry=NOW() + INTERVAL '10 minutes'
       WHERE id=$2`,
      [code, user.id]
    );

    await resend.emails.send({
      from: "Eboarding <noreply@eboarding.site>",
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

    res.json({ message: "Code sent successfully" });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};


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
    const total = await pool.query("SELECT COUNT(*) FROM users WHERE user_type='Boarder'");
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