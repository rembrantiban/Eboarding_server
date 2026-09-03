import { Response } from "express";
import { pool } from "../../config/db";
import { AuthRequest } from "../../types/auth";

export const createPenalty = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const assignedBy = req.user?.id;

    if (!assignedBy) {
      return res.status(401).json({
        message: "Unauthorized.",
      });
    }

    const {
      penalty_rule_id,
      boarder_id,
      reason,
      due_date,
    } = req.body;

    // Get penalty rule
    const ruleResult = await pool.query(
      `
      SELECT *
      FROM penalty_rules
      WHERE id = $1
      AND is_active = TRUE
      `,
      [penalty_rule_id]
    );

    if (ruleResult.rows.length === 0) {
      return res.status(404).json({
        message: "Penalty rule not found.",
      });
    }

    const rule = ruleResult.rows[0];

    const result = await pool.query(
      `
      INSERT INTO penalties (
        penalty_rule_id,
        boarder_id,
        assigned_by,
        amount,
        reason,
        due_date
      )
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING *
      `,
      [
        penalty_rule_id,
        boarder_id,
        assignedBy,
        rule.amount,
        reason,
        due_date,
      ]
    );

    return res.status(201).json({
      message: "Penalty assigned successfully.",
      penalty: result.rows[0],
    });
  } catch (error) {
    console.error("Create Penalty Error:", error);

    return res.status(500).json({
      message: "Server error.",
    });
  }
};

export const getAllUsersWithPenalties = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const result = await pool.query(
      `
      SELECT
        p.id AS penalty_id,

        u.id AS boarder_id,
        u.first_name,
        u.last_name,
        u.email,

        pr.penalty_name,

        p.amount,
        p.reason,
        p.status,
        p.penalty_date,
        p.due_date,

        assigner.first_name || ' ' || assigner.last_name
          AS assigned_by,

        p.created_at,
        p.updated_at

      FROM penalties p

      INNER JOIN users u
        ON u.id = p.boarder_id

      LEFT JOIN penalty_rules pr
        ON pr.id = p.penalty_rule_id

      LEFT JOIN users assigner
        ON assigner.id = p.assigned_by

      WHERE p.is_deleted = FALSE

      ORDER BY p.created_at DESC
      `
    );

    return res.status(200).json({
      penalties: result.rows,
    });
  } catch (error) {
    console.error(
      "Get Users With Penalties Error:",
      error
    );

    return res.status(500).json({
      message: "Server error.",
    });
  }
};

export const removePenalty = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const userRole = req.user?.user_type;

    if (userRole !== "Administrator") {
      return res.status(403).json({
        message: "Only administrators can remove penalties.",
      });
    }

    const { id } = req.params;

    const result = await pool.query(
      `
      UPDATE penalties
      SET
        is_deleted = TRUE,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Penalty record not found.",
      });
    }

    return res.status(200).json({
      message: "Penalty removed successfully.",
      penalty: result.rows[0],
    });
  } catch (error) {
    console.error("Remove Penalty Error:", error);

    return res.status(500).json({
      message: "Server error.",
    });
  }
};


export const updatePenalty = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const { id } = req.params;

    const {
      penalty_rule_id,
      amount,
      reason,
      due_date,
      status,
    } = req.body;

    const existingPenalty = await pool.query(
      `
      SELECT *
      FROM penalties
      WHERE id = $1
      AND is_deleted = FALSE
      `,
      [id]
    );

    if (existingPenalty.rows.length === 0) {
      return res.status(404).json({
        message: "Penalty not found.",
      });
    }

    const result = await pool.query(
      `
      UPDATE penalties
      SET
        penalty_rule_id = COALESCE($1, penalty_rule_id),
        amount = COALESCE($2, amount),
        reason = COALESCE($3, reason),
        due_date = COALESCE($4, due_date),
        status = COALESCE($5, status),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $6
      RETURNING *
      `,
      [
        penalty_rule_id,
        amount,
        reason,
        due_date,
        status,
        id,
      ]
    );

    return res.status(200).json({
      message: "Penalty updated successfully.",
      penalty: result.rows[0],
    });
  } catch (error) {
    console.error("Update Penalty Error:", error);

    return res.status(500).json({
      message: "Server error.",
    });
  }
};

export const recordPenaltySettlement = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const { id } = req.params;
    const { amount_paid } = req.body;

    const penaltyResult = await pool.query(
      `
      SELECT *
      FROM penalties
      WHERE id = $1
      AND is_deleted = FALSE
      `,
      [id]
    );

    if (penaltyResult.rows.length === 0) {
      return res.status(404).json({
        message: "Penalty not found.",
      });
    }

    const penalty = penaltyResult.rows[0];

    const newAmountPaid =
      Number(penalty.amount_paid || 0) +
      Number(amount_paid);

    if (newAmountPaid > Number(penalty.amount)) {
      return res.status(400).json({
        message: "Payment exceeds penalty amount.",
      });
    }

    let status = "Pending";

    if (newAmountPaid === Number(penalty.amount)) {
      status = "Paid";
    } else if (newAmountPaid > 0) {
      status = "Partially Paid";
    }

    const result = await pool.query(
      `
      UPDATE penalties
      SET
        amount_paid = $1,
        status = $2,
        settled_at = CASE
          WHEN $2 = 'Paid'
          THEN CURRENT_TIMESTAMP
          ELSE settled_at
        END,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
      `,
      [
        newAmountPaid,
        status,
        id,
      ]
    );

    return res.status(200).json({
      message:
        "Penalty settlement recorded successfully.",
      penalty: result.rows[0],
      remaining_balance:
        Number(penalty.amount) - newAmountPaid,
    });
  } catch (error) {
    console.error(
      "Record Penalty Settlement Error:",
      error
    );

    return res.status(500).json({
      message: "Server error.",
    });
  }
};

export const deactivatePenaltyRule = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      UPDATE penalty_rules
      SET
        is_active = FALSE,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Penalty rule not found.",
      });
    }

    return res.status(200).json({
      message: "Penalty rule deactivated successfully.",
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Server error.",
    });
  }
};