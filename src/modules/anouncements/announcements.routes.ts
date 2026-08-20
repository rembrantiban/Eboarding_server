import { Router } from "express";
import {
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  getMyAnnouncements,
  getUserAnnouncements,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  archiveAnnouncement,
  restoreAnnouncement,
} from "./anouncements.controller";
import { checkAuth } from "../../middleware/checkAuth";

const router = Router();

// Protect all routes
router.use(checkAuth);

// Admin / Staff
router.post("/",checkAuth, createAnnouncement);
router.get("/my-announcements", getMyAnnouncements);

// Boarder
router.get("/", getUserAnnouncements);
router.put("/read-all",  markAllAsRead);

// Notifications
router.get("/unread/count", getUnreadCount);
router.put("/read/:id", markAsRead);


router.put("/:id", updateAnnouncement);
router.delete("/:id", deleteAnnouncement);
router.put("/archive/:id", archiveAnnouncement);
router.put("/restore/:id", restoreAnnouncement);

export default router;
