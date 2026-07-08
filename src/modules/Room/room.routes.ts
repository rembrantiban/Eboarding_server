import { Router } from "express";
import { verifyAdmin } from "../../middleware/authMiddleware";
import {
  getAllRooms,
  createRoom,
  updateRoom,
  deleteRoom,
  getAvailableRoomsWithBeds,
  getDashboardStats,
  getOccupancyTrend,
  getMyDashboard,
} from "./room.controller";
import { upload } from "../../lib/upload";
import { checkAuth } from "../../middleware/checkAuth";

const router = Router();

router.get("/get-all", getAllRooms);
router.post("/create", upload.array("images", 5), createRoom);
router.put("/update-room/:id", verifyAdmin, upload.array("images", 5), updateRoom);
router.delete("/delete/:id", verifyAdmin, deleteRoom);
router.get("/available", getAvailableRoomsWithBeds);
router.get("/dashboard-stats", getDashboardStats);
router.get("/occupancy-trend", getOccupancyTrend);
router.get("/my-stats-dashboard", checkAuth, getMyDashboard);

export default router;