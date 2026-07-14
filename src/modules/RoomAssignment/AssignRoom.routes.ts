import { assignRoom } from "./AssignRoom.contoller"
import express from "express"

const router = express.Router();

router.post("/assign", assignRoom);

export default router;