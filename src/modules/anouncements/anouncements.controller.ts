import { Request, Response } from "express";
import { pool } from "../../config/db"
import { AuthRequest } from "../../types/auth";

export const createAnnouncement = async (req: AuthRequest, res: Response) => {
  const { title, description } = req.body;
  const userId = req.user?.id;

  try {
    const result = await pool.query(
      `INSERT INTO announcements (title, description, created_by)
       VALUES ($1, $2, $3)
       RETURNING id, title, description, created_at`,
      [title, description, userId]
    );

    const announcement = result.rows[0];

    await pool.query(
      `INSERT INTO announcement_notifications (announcement_id, user_id)
       SELECT $1, id FROM users`,
      [announcement.id]
    );

    res.status(201).json({
      message: "Announcement created and users notified",
      announcement,
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error creating announcement" });
  }
};

export const updateAnnouncement = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { title, description, is_active } = req.body;
  const userId = req.user?.id;

  try {
    const existing = await pool.query(
      `SELECT * FROM announcements WHERE id = $1`,
      [id]
    );

    if (existing.rowCount === 0) {
      return res.status(404).json({ message: "Announcement not found" });
    }

    if (existing.rows[0].created_by !== userId) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const updated = await pool.query(
      `UPDATE announcements
       SET 
         title = COALESCE($1, title),
         description = COALESCE($2, description),
         is_active = COALESCE($3, is_active)
       WHERE id = $4
       RETURNING *`,
      [title, description, is_active, id]
    );

    res.json({
      message: "Announcement updated successfully",
      announcement: updated.rows[0],
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error updating announcement" });
  }
};

export const getUserAnnouncements = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;

  try {
    const result = await pool.query(
      `SELECT 
          an.id AS notification_id,
          an.is_read,
          an.created_at AS notified_at,
          a.id AS announcement_id,
          a.title,
          a.description,
          a.created_at
       FROM announcement_notifications an
       JOIN announcements a ON a.id = an.announcement_id
       WHERE an.user_id = $1
         AND a.is_active = TRUE
       ORDER BY a.created_at DESC`,
      [userId]
    );

    res.json(result.rows);

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error fetching announcements" });
  }
};


export const getUnreadCount = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;

  const result = await pool.query(
    `SELECT COUNT(*) 
     FROM announcement_notifications
     WHERE user_id = $1 AND is_read = FALSE`,
    [userId]
  );

  res.json({ unread: result.rows[0].count });
};

export const markAsRead = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  try {
    await pool.query(
      `UPDATE announcement_notifications
       SET is_read = TRUE
       WHERE id = $1`,
      [id]
    );

    res.json({ message: "Marked as read" });

  } catch (error) {
    res.status(500).json({ message: "Error updating notification" });
  }
};