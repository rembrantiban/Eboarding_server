import { Router } from "express";
import {
  createAnnouncement,
  updateAnnouncement,
  getUserAnnouncements,
  getUnreadCount,
  markAsRead
} from "./anouncements.controller";

import { checkAuth } from "../../middleware/checkAuth"; 

const router = Router();

router.use(checkAuth);

router.post("/create", createAnnouncement);

router.put("/update/:id", updateAnnouncement);

router.get("/getAnnouncements", getUserAnnouncements);

router.get("/unread/count", getUnreadCount);

router.put("/read/:id", markAsRead);

export default router;