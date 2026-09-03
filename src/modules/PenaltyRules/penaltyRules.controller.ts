import { Response } from "express";
import { pool } from "../../config/db";
import { AuthRequest } from "../../types/auth";

export const createPenaltyRule = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const createdBy = req.user?.id;

    if (req.user?.user_type !== "Admin") {
      return res.status(403).json({
        message: "Only administrators can create penalty rules.",
      });
    }

    const {
      penalty_name,
      description,
      amount,
    } = req.body;

    if (!penalty_name || amount === undefined || amount === null || amount === "") {
      return res.status(400).json({
        message: "Penalty name and amount are required.",
      });
    }

    if (Number(amount) < 0 || Number.isNaN(Number(amount))) {
      return res.status(400).json({
        message: "Amount must be a valid non-negative number.",
      });
    }

    const result = await pool.query(
      `
      INSERT INTO penalty_rules (
        penalty_name,
        description,
        amount,
        created_by
      )
      VALUES ($1,$2,$3,$4)
      RETURNING *
      `,
      [
        penalty_name,
        description,
        amount,
        createdBy,
      ]
    );

    return res.status(201).json({
      message: "Penalty rule created successfully.",
      penaltyRule: result.rows[0],
    });
  } catch (error) {
    console.error("Create Penalty Rule Error:", error);

    return res.status(500).json({
      message: "Server error.",
    });
  }
};

export const getAllPenaltyRules = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const result = await pool.query(
      `
      SELECT
        pr.*,

        u.first_name,
        u.last_name

      FROM penalty_rules pr

      LEFT JOIN users u
        ON u.id = pr.created_by

      WHERE pr.is_active = TRUE

      ORDER BY pr.penalty_name ASC
      `
    );

    return res.status(200).json({
      penaltyRules: result.rows,
    });
  } catch (error) {
    console.error("Get Penalty Rules Error:", error);

    return res.status(500).json({
      message: "Server error.",
    });
  }
};

export const getPenaltyRuleById = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      SELECT *
      FROM penalty_rules
      WHERE id = $1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Penalty rule not found.",
      });
    }

    return res.status(200).json({
      penaltyRule: result.rows[0],
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Server error.",
    });
  }
};

export const updatePenaltyRule = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    if (req.user?.user_type !== "Admin") {
      return res.status(403).json({
        message: "Only administrators can update penalty rules.",
      });
    }

    const { id } = req.params;

    const {
      penalty_name,
      description,
      amount,
      is_active,
    } = req.body;

    const result = await pool.query(
      `
      UPDATE penalty_rules
      SET
        penalty_name = COALESCE($1, penalty_name),
        description = COALESCE($2, description),
        amount = COALESCE($3, amount),
        is_active = COALESCE($4, is_active),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $5
      RETURNING *
      `,
      [
        penalty_name,
        description,
        amount,
        is_active,
        id,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Penalty rule not found.",
      });
    }

    return res.status(200).json({
      message: "Penalty rule updated successfully.",
      penaltyRule: result.rows[0],
    });
  } catch (error) {
    console.error("Update Penalty Rule Error:", error);

    return res.status(500).json({
      message: "Server error.",
    });
  }
};