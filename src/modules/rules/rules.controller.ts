import { Request, Response } from "express";
import { pool } from "../../config/db";
import { AuthRequest } from "../../types/auth";


export const createRule = async (
  req: AuthRequest,
  res: Response
) => {
  const {
    title,
    description,
    status = "Unpublished",
  } = req.body;

  const userId = req.user?.id;

  try {
    const result = await pool.query(
      `
      INSERT INTO rules_and_regulations
      (
        title,
        description,
        status,
        created_by
      )
      VALUES
      ($1,$2,$3,$4)
      RETURNING *
      `,
      [
        title,
        description,
        status,
        userId,
      ]
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

export const getPublishedRules = async (
  req: Request,
  res: Response
) => {
  try {

    const result = await pool.query(
      `
      SELECT
        id,
        title,
        description,
        created_at

      FROM rules_and_regulations

      WHERE status = 'Published'

      ORDER BY created_at DESC
      `
    );

    res.json(result.rows);

  } catch (error) {

    console.error(error);

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
    status,
  } = req.body;

  try {

    const result = await pool.query(
      `
      UPDATE rules_and_regulations

      SET
        title = $1,
        description = $2,
        status = $3,
        updated_at = CURRENT_TIMESTAMP

      WHERE id = $4

      RETURNING *
      `,
      [
        title,
        description,
        status,
        id,
      ]
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

    console.error(error);

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

export const publishRule = async (
  req: AuthRequest,
  res: Response
) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `
      UPDATE rules_and_regulations
      SET
        status = 'Published',
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
      `,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        message: "Rule not found.",
      });
    }

    return res.status(200).json({
      message: "Rule published successfully.",
      rule: result.rows[0],
    });

  } catch (error) {
    console.error("Publish rule error:", error);

    return res.status(500).json({
      message: "Server error.",
    });
  }
};

export const acknowledgeRules = async (
  req: AuthRequest,
  res: Response
) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({
      message: "Unauthorized",
    });
  }

  try {
    const result = await pool.query(
      `
      INSERT INTO rule_acknowledgments (user_id, acknowledged_at)
      VALUES ($1, CURRENT_TIMESTAMP)

      ON CONFLICT (user_id)
      DO UPDATE SET acknowledged_at = CURRENT_TIMESTAMP

      RETURNING acknowledged_at
      `,
      [userId]
    );

    return res.status(200).json({
      message: "Rules acknowledged successfully.",
      acknowledgedAt: result.rows[0].acknowledged_at,
    });

  } catch (error) {
    console.error("Acknowledge rules error:", error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};

export const getAcknowledgmentStatus = async (
  req: AuthRequest,
  res: Response
) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({
      message: "Unauthorized",
    });
  }

  try {
    const [ackResult, latestRuleResult] = await Promise.all([
      pool.query(
        `
        SELECT acknowledged_at
        FROM rule_acknowledgments
        WHERE user_id = $1
        `,
        [userId]
      ),
      pool.query(
        `
        SELECT MAX(updated_at) AS latest_update
        FROM rules_and_regulations
        WHERE status = 'Published'
        `
      ),
    ]);

    const acknowledgedAt = ackResult.rows[0]?.acknowledged_at ?? null;
    const latestRuleUpdate = latestRuleResult.rows[0]?.latest_update ?? null;

    const needsAcknowledgment =
      latestRuleUpdate !== null &&
      (!acknowledgedAt || new Date(acknowledgedAt) < new Date(latestRuleUpdate));

    return res.json({
      acknowledgedAt,
      latestRuleUpdate,
      needsAcknowledgment,
    });

  } catch (error) {
    console.error("Get acknowledgment status error:", error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};

export const unpublishRule = async (
  req: AuthRequest,
  res: Response
) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `
      UPDATE rules_and_regulations
      SET
        status = 'Unpublished',
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
      `,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        message: "Rule not found.",
      });
    }

    return res.status(200).json({
      message: "Rule unpublished successfully.",
      rule: result.rows[0],
    });

  } catch (error) {
    console.error("Unpublish rule error:", error);

    return res.status(500).json({
      message: "Server error.",
    });
  }
};

