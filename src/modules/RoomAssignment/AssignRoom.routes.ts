import { assignRoom } from "./AssignRoom.contoller"
import express from "express"
import { checkAuth } from "../../middleware/checkAuth";

const router = express.Router();

router.post("/assign", checkAuth, assignRoom);

export default router;