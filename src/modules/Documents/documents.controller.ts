import { Request, Response } from "express";
import { pool } from "../../config/db";
import { UploadApiResponse } from "cloudinary";
import  cloudinary  from "../../config/cloudinary";

export const getAllDocuments = async (
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
        u.avatar_url,

        u.valid_id_type,
        u.valid_id_image,
        u.valid_id_status,
        u.valid_id_rejection_reason,
        u.is_verified,

        verifier.id AS verified_by_id,
        verifier.first_name || ' ' || verifier.last_name AS verified_by,

        u.created_at,
        u.updated_at

      FROM users u

      LEFT JOIN users verifier
      ON verifier.id = u.valid_id_verified_by

      WHERE
          u.user_type = 'Boarder'
      AND u.valid_id_image IS NOT NULL

      ORDER BY u.created_at DESC;
    `);

    return res.status(200).json(result.rows);

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Server Error",
    });
  }
};


export const getUserSubmittedDocument = async (
  req: Request,
  res: Response
) => {
  try {
    // Assuming your auth middleware sets req.user.id
    const userId = (req as any).user.id;

    const result = await pool.query(
      `
      SELECT
        id,
        user_id_no,
        first_name,
        last_name,
        email,
        avatar_url,

        valid_id_type,
        valid_id_image,
        valid_id_status,
        valid_id_rejection_reason,

        created_at,
        updated_at

      FROM users

      WHERE
          id = $1
      AND user_type = 'Boarder';
      `,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Document not found.",
      });
    }

    return res.status(200).json(result.rows[0]);

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Server Error",
    });
  }
};

export const approveUserDocument = async (
  req: Request,
  res: Response
) => {
  try {
    const { id } = req.params;

    // Logged-in Admin/Staff
    const verifiedBy = (req as any).user.id;

    const result = await pool.query(
      `
      UPDATE users
      SET
          valid_id_status = 'Approved',
          valid_id_rejection_reason = NULL,
          valid_id_verified_by = $1,
          is_verified = TRUE
      WHERE
          id = $2
      AND user_type = 'Boarder'
      RETURNING
          id,
          user_id_no,
          first_name,
          last_name,
          valid_id_status,
          is_verified,
          updated_at;
      `,
      [verifiedBy, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        message: "Boarder not found."
      });
    }

    return res.status(200).json({
      message: "Document approved successfully.",
      user: result.rows[0]
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Server error."
    });
  }
};

export const rejectUserDocument = async (
  req: Request,
  res: Response
) => {
  try {
    const { id } = req.params;

    const { rejection_reason } = req.body;

    const verifiedBy = (req as any).user.id;

    if (!rejection_reason?.trim()) {
      return res.status(400).json({
        message: "Rejection reason is required."
      });
    }

    const result = await pool.query(
      `
      UPDATE users
      SET
          valid_id_status = 'Rejected',
          valid_id_rejection_reason = $1,
          valid_id_verified_by = $2
      WHERE
          id = $3
      AND user_type = 'Boarder'
      RETURNING
          id,
          user_id_no,
          first_name,
          last_name,
          valid_id_status,
          valid_id_rejection_reason,
          updated_at;
      `,
      [rejection_reason, verifiedBy, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        message: "Boarder not found."
      });
    }

    return res.status(200).json({
      message: "Document rejected successfully.",
      user: result.rows[0]
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Server error."
    });
  }
};


export const uploadDocument = async (
  req: Request,
  res: Response
) => {
  try {
    const userId = (req as any).user.id;

    const { valid_id_type } = req.body;

    const files = req.files as
      | {
          [fieldname: string]: Express.Multer.File[];
        }
      | undefined;

    if (!files?.valid_id_image?.[0]) {
      return res.status(400).json({
        message: "Valid ID image is required.",
      });
    }

    const uploadResult = await new Promise<UploadApiResponse>(
      (resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: "valid_ids",
          },
          (error, result) => {
            if (error || !result) return reject(error);
            resolve(result);
          }
        );

        stream.end(files.valid_id_image[0].buffer);
      }
    );

    const result = await pool.query(
      `
      UPDATE users
      SET
          valid_id_type = $1,
          valid_id_image = $2,
          valid_id_status = 'Under Review',
          valid_id_rejection_reason = NULL,
          valid_id_verified_by = NULL
      WHERE
          id = $3
      AND user_type = 'Boarder'

      RETURNING
          id,
          user_id_no,
          first_name,
          last_name,
          valid_id_type,
          valid_id_image,
          valid_id_status,
          created_at,
          updated_at;
      `,
      [
        valid_id_type,
        uploadResult.secure_url,
        userId,
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        message: "Boarder not found.",
      });
    }

    return res.status(200).json({
      message: "Document uploaded successfully.",
      document: result.rows[0],
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Server error.",
    });
  }
};