import { Request, Response } from "express";
import { pool } from "../../config/db"
import { AuthRequest } from "../../types/auth";

export const createAnnouncement = async (
  req: AuthRequest,
  res: Response
) => {
  const {
    title,
    description,
    category = "General",
    audience = "Boarders",
    status = "Active",
  } = req.body;

  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({
      message: "Unauthorized",
    });
  }

  try {
    const announcementResult = await pool.query(
      `
      WITH inserted AS (
        INSERT INTO announcements (
          title,
          description,
          category,
          audience,
          status,
          created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      )

      SELECT
        i.id,
        i.title,
        i.description,
        i.category,
        i.audience,
        i.status,
        i.created_by,
        CONCAT(u.first_name, ' ', u.last_name) AS created_by_name,
        u.avatar_url AS created_by_avatar,
        i.created_at,
        i.updated_at

      FROM inserted i
      JOIN users u
        ON i.created_by = u.id
      `,
      [
        title,
        description,
        category,
        audience,
        status,
        userId,
      ]
    );

    const announcement = announcementResult.rows[0];

    if (audience === "Boarders") {
      await pool.query(
        `
        INSERT INTO announcement_notifications (
          announcement_id,
          user_id
        )
        SELECT
          $1,
          id
        FROM users
        WHERE user_type = 'Boarder'
        `,
        [announcement.id]
      );
    } else if (audience === "Staff") {
      await pool.query(
        `
        INSERT INTO announcement_notifications (
          announcement_id,
          user_id
        )
        SELECT
          $1,
          id
        FROM users
        WHERE user_type = 'Staff'
        `,
        [announcement.id]
      );
    } else {
      await pool.query(
        `
        INSERT INTO announcement_notifications (
          announcement_id,
          user_id
        )
        SELECT
          $1,
          id
        FROM users
        `,
        [announcement.id]
      );
    }

    return res.status(201).json({
      message: "Announcement created successfully.",
      announcement,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Error creating announcement",
    });
  }
};

export const getMyAnnouncements = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;

    const result = await pool.query(
      `
      SELECT
        a.id,
        a.title,
        a.description,
        a.category,
        a.audience,
        a.status,

        a.created_by,

        CONCAT(
          u.first_name,
          ' ',
          u.last_name
        ) AS created_by_name,

        u.avatar_url AS created_by_avatar,

        a.created_at,
        a.updated_at

      FROM announcements a

      JOIN users u
        ON a.created_by = u.id

      WHERE a.created_by = $1

      ORDER BY a.created_at DESC
      `,
      [userId]
    );

    return res.json(result.rows);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};

export const updateAnnouncement = async (
  req: AuthRequest,
  res: Response
) => {
  const { id } = req.params;

  const {
    title,
    description,
    category,
    audience,
  } = req.body;

  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({
      message: "Unauthorized",
    });
  }

  try {
    const existing = await pool.query(
      `
      SELECT *
      FROM announcements
      WHERE id = $1
      `,
      [id]
    );

    if (existing.rowCount === 0) {
      return res.status(404).json({
        message: "Announcement not found",
      });
    }

    if (existing.rows[0].created_by !== userId) {
      return res.status(403).json({
        message: "Unauthorized",
      });
    }

    const updated = await pool.query(
      `
      WITH updated_announcement AS (
        UPDATE announcements
        SET
          title = COALESCE($1, title),
          description = COALESCE($2, description),
          category = COALESCE($3, category),
          audience = COALESCE($4, audience)

        WHERE id = $5

        RETURNING *
      )

      SELECT
        ua.id,
        ua.title,
        ua.description,
        ua.category,
        ua.audience,

        ua.created_by,

        CONCAT(
          u.first_name,
          ' ',
          u.last_name
        ) AS created_by_name,

        ua.created_at,
        ua.updated_at

      FROM updated_announcement ua

      JOIN users u
        ON ua.created_by = u.id
      `,
      [
        title,
        description,
        category,
        audience,
        id,
      ]
    );

    return res.json({
      message: "Announcement updated successfully.",
      announcement: updated.rows[0],
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Error updating announcement",
    });
  }
};

export const deleteAnnouncement = async (
  req: AuthRequest,
  res: Response
) => {
  const { id } = req.params;
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({
      message: "Unauthorized",
    });
  }

  try {
    const deleted = await pool.query(
      `
      DELETE FROM announcements
      WHERE
        id = $1
        AND created_by = $2
      RETURNING id
      `,
      [id, userId]
    );

    if (deleted.rowCount === 0) {
      return res.status(404).json({
        message: "Announcement not found",
      });
    }

    return res.json({
      message: "Announcement deleted successfully.",
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Error deleting announcement",
    });
  }
};

export const getUserAnnouncements = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;
    const userType = req.user?.user_type;

    if (!userId || !userType) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const audience =
      userType === "Boarder"
        ? "Boarders"
        : userType === "Staff"
        ? "Staff"
        : "All";

    const result = await pool.query(
      `
      SELECT
        an.id AS notification_id,
        an.is_read,
        an.created_at AS notified_at,

        a.id AS announcement_id,
        a.title,
        a.description,
        a.category,
        a.audience,
        a.status,

        a.created_by,

        CONCAT(
          u.first_name,
          ' ',
          u.last_name
        ) AS created_by_name,

        u.avatar_url AS created_by_avatar,

        a.created_at,
        a.updated_at

      FROM announcement_notifications an

      JOIN announcements a
        ON an.announcement_id = a.id

      JOIN users u
        ON a.created_by = u.id

      WHERE
        an.user_id = $1
        AND a.status = 'Active'
        AND (
          a.audience = 'All'
          OR a.audience = $2
        )

      ORDER BY a.created_at DESC
      `,
      [userId, audience]
    );

    return res.json(result.rows);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Error fetching announcements",
    });
  }
};

export const getUnreadCount = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;
    const userType = req.user?.user_type;

    if (!userId || !userType) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const audience =
      userType === "Boarder"
        ? "Boarders"
        : userType === "Staff"
        ? "Staff"
        : "All";

    const result = await pool.query(
      `
      SELECT COUNT(*) AS unread

      FROM announcement_notifications an

      JOIN announcements a
        ON a.id = an.announcement_id

      WHERE
        an.user_id = $1
        AND an.is_read = FALSE
        AND (
          a.audience = 'All'
          OR a.audience = $2
        )
      `,
      [userId, audience]
    );

    return res.json({
      unread: Number(result.rows[0].unread),
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Error fetching unread count",
    });
  }
};

export const markAsRead = async (
  req: AuthRequest,
  res: Response
) => {
    console.log("===== HIT markAllAsRead =====");

  try {
    const userId = req.user?.id;
    const { id } = req.params;

    const result = await pool.query(
      `
      UPDATE announcement_notifications
      SET is_read = TRUE
      WHERE
        id = $1
        AND user_id = $2
      RETURNING id
      `,
      [id, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        message: "Notification not found",
      });
    }

    res.json({
      message: "Marked as read",
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Error updating notification",
    });
  }
};


export const markAllAsRead = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    console.log("markAllAsRead called");
    console.log("req.user:", req.user);

    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = await pool.query(
      `
      UPDATE announcement_notifications
      SET is_read = TRUE
      WHERE user_id = $1
      `,
      [userId]
    );

    console.log(result);

    return res.json({
      message: "All announcements marked as read.",
    });

  } catch (error) {
    console.error("markAllAsRead error:", error);

    return res.status(500).json({
      message: "Error marking announcements as read.",
      error: error instanceof Error ? error.message : error,
    });
  }
};
