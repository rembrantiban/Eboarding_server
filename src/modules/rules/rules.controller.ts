import { Response } from "express";
import { pool } from "../../config/db";
import { AuthRequest } from "../../types/auth";


export const createRule = async (
  req: AuthRequest,
  res: Response
) => {
  const { title, description } = req.body;
  const userId = req.user?.id;

  try {
    const result = await pool.query(
      `
      INSERT INTO rules_and_regulations
      (title, description, created_by)

      VALUES ($1, $2, $3)

      RETURNING *
      `,
      [title, description, userId]
    );

    res.status(201).json({
      message: "Rule created successfully",
      rule: result.rows[0],
    });

  } catch (error) {
    console.error("Create rule error:", error);

    res.status(500).json({
      message: "Server error",
    });
  }
};


export const getRules = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const result = await pool.query(
      `
      SELECT
        r.*,
        u.first_name,
        u.last_name

      FROM rules_and_regulations r

      LEFT JOIN users u
      ON r.created_by = u.id

      WHERE r.is_active = TRUE

      ORDER BY r.created_at DESC
      `
    );

    res.json(result.rows);

  } catch (error) {
    console.error("Get rules error:", error);

    res.status(500).json({
      message: "Server error",
    });
  }
};

export const updateRule = async (
  req: AuthRequest,
  res: Response
) => {
  const { id } = req.params;

  const {
    title,
    description,
    is_active,
  } = req.body;

  try {
    const result = await pool.query(
      `
      UPDATE rules_and_regulations

      SET
        title = $1,
        description = $2,
        is_active = $3,
        updated_at = CURRENT_TIMESTAMP

      WHERE id = $4

      RETURNING *
      `,
      [title, description, is_active, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        message: "Rule not found",
      });
    }

    res.json({
      message: "Rule updated successfully",
      rule: result.rows[0],
    });

  } catch (error) {
    console.error("Update rule error:", error);

    res.status(500).json({
      message: "Server error",
    });
  }
};


export const deleteRule = async (
  req: AuthRequest,
  res: Response
) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `
      DELETE FROM rules_and_regulations
      WHERE id = $1
      RETURNING *
      `,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        message: "Rule not found",
      });
    }

    res.json({
      message: "Rule deleted successfully",
    });

  } catch (error) {
    console.error("Delete rule error:", error);

    res.status(500).json({
      message: "Server error",
    });
  }
};