import { assignRoom, 
       getAssignedBoarders,
       activateAssignment,
       checkoutAssignment
 } from "./AssignRoom.contoller"
import express from "express"
import { checkAuth } from "../../middleware/checkAuth";

const router = express.Router();

router.post("/assign", checkAuth, assignRoom);
router.get("/assigned-boarders", checkAuth, getAssignedBoarders);
router.put("/activate/:id", checkAuth, activateAssignment);
router.put("/checkout/:id", checkAuth, checkoutAssignment);

export default router;