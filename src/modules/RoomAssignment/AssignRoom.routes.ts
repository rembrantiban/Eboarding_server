import { assignRoom, 
       getAssignedBoarders,
       activateAssignment,
       checkoutAssignment,
       transferAssignment,
       getOccupancyHistory,
       getBoarderAssignedRoom,
       getMyDashboard,
       getUpcomingPayments,
 } from "./AssignRoom.contoller"
import express from "express"
import { checkAuth } from "../../middleware/checkAuth";

const router = express.Router();

router.post("/assign", checkAuth, assignRoom);
router.get("/get-assigned-boarders", checkAuth, getAssignedBoarders);
router.put("/activate/:id", checkAuth, activateAssignment);
router.put("/checkout/:id", checkAuth, checkoutAssignment);
router.get("/occupancy-history", checkAuth, getOccupancyHistory);
router.put("/transfer/:id", checkAuth, transferAssignment);
router.get("/boarder-assigned-room/:id", checkAuth, getBoarderAssignedRoom);
router.get("/dashboard-stats", checkAuth, getMyDashboard);
router.get("/get-my-upcoming-payments", checkAuth, getUpcomingPayments);


export default router;