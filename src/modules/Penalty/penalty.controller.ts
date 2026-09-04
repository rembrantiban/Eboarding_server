import { Response } from "express";
import { pool } from "../../config/db";
import { AuthRequest } from "../../types/auth";

/* ============================================================
   5.2 / 5.8  ASSIGN PENALTY TO BOARDER
   ============================================================ */
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
      amount: customAmount,
    } = req.body;

    if (!boarder_id) {
      return res.status(400).json({
        message: "Boarder is required.",
      });
    }

    let amount = customAmount;

    // If a rule is provided, take its amount unless a custom amount is passed.
    if (penalty_rule_id) {
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
          message: "Penalty rule not found or inactive.",
        });
      }

      if (amount === undefined || amount === null || amount === "") {
        amount = ruleResult.rows[0].amount;
      }
    }

    if (amount === undefined || amount === null || amount === "" || Number(amount) < 0) {
      return res.status(400).json({
        message: "A valid penalty amount is required.",
      });
    }

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
        penalty_rule_id || null,
        boarder_id,
        assignedBy,
        amount,
        reason || null,
        due_date || null,
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

/* ============================================================
   5.5 / 5.6 / 5.10 / 5.11  VIEW / SEARCH PENALTY RECORDS
   Optional query params: search, status, from, to
   ============================================================ */
export const getAllUsersWithPenalties = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const { search, status, from, to } = req.query as {
      search?: string;
      status?: string;
      from?: string;
      to?: string;
    };

    const conditions: string[] = ["p.is_deleted = FALSE"];
    const values: any[] = [];

    if (search && search.trim() !== "") {
      values.push(`%${search.trim()}%`);
      const idx = values.length;
      conditions.push(`(
        u.first_name ILIKE $${idx}
        OR u.last_name ILIKE $${idx}
        OR (u.first_name || ' ' || u.last_name) ILIKE $${idx}
        OR u.email ILIKE $${idx}
        OR pr.penalty_name ILIKE $${idx}
        OR p.reason ILIKE $${idx}
      )`);
    }

    if (status && status.trim() !== "" && status !== "All Status") {
      values.push(status.trim());
      conditions.push(`p.status = $${values.length}`);
    }

    if (from && from.trim() !== "") {
      values.push(from.trim());
      conditions.push(`p.penalty_date >= $${values.length}`);
    }

    if (to && to.trim() !== "") {
      values.push(to.trim());
      conditions.push(`p.penalty_date <= $${values.length}`);
    }

    const result = await pool.query(
      `
      SELECT
        p.id AS penalty_id,

        u.id AS boarder_id,
        u.first_name,
        u.last_name,
        u.email,

        p.penalty_rule_id,
        pr.penalty_name,
        pr.description AS penalty_description,

        p.amount,
        p.amount_paid,
        p.reason,
        p.status,
        p.penalty_date,
        p.due_date,
        p.settled_at,

        assigner.first_name || ' ' || assigner.last_name
          AS assigned_by,
        assigner.user_type AS assigned_by_role,

        p.created_at,
        p.updated_at

      FROM penalties p

      INNER JOIN users u
        ON u.id = p.boarder_id

      LEFT JOIN penalty_rules pr
        ON pr.id = p.penalty_rule_id

      LEFT JOIN users assigner
        ON assigner.id = p.assigned_by

      WHERE ${conditions.join(" AND ")}

      ORDER BY p.created_at DESC
      `,
      values
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

/* ============================================================
   5.4  REMOVE PENALTY  (Administrator only)
   ============================================================ */
export const removePenalty = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const userRole = req.user?.user_type;

    if (userRole !== "Admin") {
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
      AND is_deleted = FALSE
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

/* ============================================================
   5.3 / 5.9  UPDATE PENALTY  (also handles "Waive")
   ============================================================ */
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
        settled_at = CASE
          WHEN $5 = 'Waived' THEN CURRENT_TIMESTAMP
          ELSE settled_at
        END,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $6
      RETURNING *
      `,
      [
        penalty_rule_id ?? null,
        amount ?? null,
        reason ?? null,
        due_date ?? null,
        status ?? null,
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

/* ============================================================
   5.7  RECORD PENALTY SETTLEMENT  (Administrator only)
   Writes a settlement row and rolls up the penalty totals.
   ============================================================ */
export const recordPenaltySettlement = async (
  req: AuthRequest,
  res: Response
) => {
  const client = await pool.connect();

  try {
    const userRole = req.user?.user_type;
    const receivedBy = req.user?.id;

    if (userRole !== "Admin") {
      return res.status(403).json({
        message:
          "Only administrators can record penalty settlements.",
      });
    }

    console.log("receivedBy:", receivedBy);
    console.log("user:", req.user);

    const { id } = req.params;
    const {
      amount_paid,
      payment_date,
      payment_method,
      payment_reference,
      remarks,
    } = req.body;

    const paid = Number(amount_paid);

    if (!paid || Number.isNaN(paid) || paid <= 0) {
      return res.status(400).json({
        message: "A valid payment amount is required.",
      });
    }

    await client.query("BEGIN");

    const penaltyResult = await client.query(
      `
      SELECT *
      FROM penalties
      WHERE id = $1
      AND is_deleted = FALSE
      FOR UPDATE
      `,
      [id]
    );

    if (penaltyResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        message: "Penalty not found.",
      });
    }

    const penalty = penaltyResult.rows[0];

    if (penalty.status === "Waived") {
      await client.query("ROLLBACK");
      return res.status(400).json({
        message: "This penalty has been waived.",
      });
    }

    const totalAmount = Number(penalty.amount);
    const alreadyPaid = Number(penalty.amount_paid || 0);
    const newAmountPaid = Number(
      (alreadyPaid + paid).toFixed(2)
    );

    if (newAmountPaid > totalAmount + 0.001) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        message: "Payment exceeds the outstanding penalty balance.",
      });
    }

    const isFullyPaid = newAmountPaid >= totalAmount - 0.001;
    const status = isFullyPaid ? "Paid" : "Partially Paid";

    // 1. Log the settlement
    const settlement = await client.query(
      `
      INSERT INTO penalty_settlements (
        penalty_id,
        amount_paid,
        payment_date,
        payment_method,
        payment_reference,
        remarks,
        received_by
      )
      VALUES ($1,$2,COALESCE($3, CURRENT_DATE),$4,$5,$6,$7)
      RETURNING *
      `,
      [
        id,
        paid,
        payment_date ?? null,
        payment_method ?? null,
        payment_reference ?? null,
        remarks ?? null,
        receivedBy,
      ]
    );

    // 2. Roll up the penalty
    const updated = await client.query(
      `
      UPDATE penalties
      SET
        amount_paid = $1,
        status = $2,
        settled_at = CASE
          WHEN $2 = 'Paid' THEN CURRENT_TIMESTAMP
          ELSE settled_at
        END,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
      `,
      [newAmountPaid, status, id]
    );

    await client.query("COMMIT");

    return res.status(200).json({
      message: "Penalty settlement recorded successfully.",
      penalty: updated.rows[0],
      settlement: settlement.rows[0],
      remaining_balance: Number(
        (totalAmount - newAmountPaid).toFixed(2)
      ),
    });
  } catch (error: any) {
    await client.query("ROLLBACK");
    console.error("ERROR:", error);
    console.error("MESSAGE:", error?.message);
    console.error("DETAIL:", error?.detail);
    console.error("CODE:", error?.code);
    console.error("CONSTRAINT:", error?.constraint);

    return res.status(500).json({
      message: error?.message,
      detail: error?.detail,
      code: error?.code,
      constraint: error?.constraint,
    });

  } finally {
    client.release();
  }
};

/* ============================================================
   5.7 (support)  VIEW SETTLEMENT HISTORY FOR A PENALTY
   ============================================================ */
export const getPenaltySettlements = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const { id } = req.params;

    const role = req.user?.user_type;
    const requesterId = req.user?.id;

    // Boarders may only read the settlement history of their own penalties.
    if (role !== "Admin" && role !== "Staff") {
      const owner = await pool.query(
        `
        SELECT boarder_id
        FROM penalties
        WHERE id = $1
        AND is_deleted = FALSE
        `,
        [id]
      );

      if (owner.rows.length === 0) {
        return res.status(404).json({
          message: "Penalty not found.",
        });
      }

      if (owner.rows[0].boarder_id !== requesterId) {
        return res.status(403).json({
          message: "You can only view your own penalty settlements.",
        });
      }
    }

    const result = await pool.query(
      `
      SELECT
        s.*,
        u.first_name || ' ' || u.last_name AS received_by_name
      FROM penalty_settlements s
      LEFT JOIN users u
        ON u.id = s.received_by
      WHERE s.penalty_id = $1
      ORDER BY s.created_at DESC
      `,
      [id]
    );

    return res.status(200).json({
      settlements: result.rows,
    });
  } catch (error) {
    console.error("Get Penalty Settlements Error:", error);

    return res.status(500).json({
      message: "Server error.",
    });
  }
};

/* ============================================================
   PENALTY RULES (support)  DEACTIVATE  (Administrator only)
   ============================================================ */
export const deactivatePenaltyRule = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    if (req.user?.user_type !== "Admin") {
      return res.status(403).json({
        message: "Only administrators can deactivate penalty rules.",
      });
    }

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

/* ============================================================
   BOARDER: MY ACTIVE PENALTIES
   ============================================================ */
export const getMyPenalties = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const boarderId = req.user?.id;

    if (!boarderId) {
      return res.status(401).json({
        message: "Unauthorized.",
      });
    }

    const result = await pool.query(
      `
      SELECT
        p.id AS penalty_id,

        u.id AS boarder_id,
        u.first_name,
        u.last_name,
        u.email,

        p.penalty_rule_id,
        pr.penalty_name,
        pr.description AS penalty_description,

        p.amount,
        p.amount_paid,
        p.reason,
        p.status,
        p.penalty_date,
        p.due_date,
        p.settled_at,

        assigner.first_name || ' ' || assigner.last_name
          AS assigned_by,
        assigner.user_type AS assigned_by_role,

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
        AND p.boarder_id = $1
        AND p.status IN ('Pending', 'Partially Paid')

      ORDER BY p.created_at DESC
      `,
      [boarderId]
    );

    return res.status(200).json({
      penalties: result.rows,
    });
  } catch (error) {
    console.error("Get My Penalties Error:", error);

    return res.status(500).json({
      message: "Server error.",
    });
  }
};


/* ============================================================
   5.12 / 5.13 / 5.14  BOARDER: MY PENALTY RECORDS
   Full history for the logged-in boarder (every status), used
   by the boarder-facing Penalties page. Unlike getMyPenalties
   this is not limited to active (Pending / Partially Paid) rows.
   ============================================================ */
export const getMyPenaltyRecords = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const boarderId = req.user?.id;

    if (!boarderId) {
      return res.status(401).json({
        message: "Unauthorized.",
      });
    }

    const result = await pool.query(
      `
      SELECT
        p.id AS penalty_id,

        u.id AS boarder_id,
        u.first_name,
        u.last_name,
        u.email,

        p.penalty_rule_id,
        pr.penalty_name,
        pr.description AS penalty_description,

        p.amount,
        p.amount_paid,
        p.reason,
        p.status,
        p.penalty_date,
        p.due_date,
        p.settled_at,

        assigner.first_name || ' ' || assigner.last_name
          AS assigned_by,
        assigner.user_type AS assigned_by_role,

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
        AND p.boarder_id = $1

      ORDER BY p.created_at DESC
      `,
      [boarderId]
    );

    return res.status(200).json({
      penalties: result.rows,
    });
  } catch (error) {
    console.error("Get My Penalty Records Error:", error);

    return res.status(500).json({
      message: "Server error.",
    });
  }
};
