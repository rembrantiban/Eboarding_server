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
  getAvailableRooms,
  updateRoomStatus,
  getRoomAvailabilityChart,
  getBedOccupancyChart,
  getRoomOccupancyChart,
  getRoomAvailabilityBed,
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
router.get("/available-rooms", checkAuth, getAvailableRooms);
router.put( "/status/:id", checkAuth, updateRoomStatus);
router.get("/availability-chart", checkAuth, getRoomAvailabilityChart);
router.get("/bed-occupancy-chart", checkAuth, getBedOccupancyChart);
router.get("/room-occupancy-chart", checkAuth, getRoomOccupancyChart);
router.get("/room-availability-bed", checkAuth, getRoomAvailabilityBed);

  export default router;