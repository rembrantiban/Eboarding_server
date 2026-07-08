import { Router } from "express";
import {
  createAnnouncement,
  updateAnnouncement,
  getMyAnnouncements,
  getUserAnnouncements,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
} from "./anouncements.controller";
import { checkAuth } from "../../middleware/checkAuth";

const router = Router();

// Protect all routes
router.use(checkAuth);

// Admin / Staff
router.post("/",checkAuth, createAnnouncement);
router.get("/my-announcements", getMyAnnouncements);
router.put("/:id", updateAnnouncement);

// Boarder
router.get("/", getUserAnnouncements);
router.put("/read-all",  markAllAsRead);

// Notifications
router.get("/unread/count", getUnreadCount);
router.put("/read/:id", markAsRead);

export default router;