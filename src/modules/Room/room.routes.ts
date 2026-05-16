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
} from "./room.controller";
import { upload } from "../../lib/upload";

const router = Router();

router.get("/get-all", getAllRooms);
router.post("/create", upload.array("images", 5), createRoom);
router.put("/update-room/:id", verifyAdmin, upload.array("images", 5), updateRoom);
router.delete("/delete/:id", verifyAdmin, deleteRoom);
router.get("/available", getAvailableRoomsWithBeds);
router.get("/dashboard-stats", getDashboardStats);
router.get("/occupancy-trend", getOccupancyTrend);

export default router;