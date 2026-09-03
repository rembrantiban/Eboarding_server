import express from "express";
import { assignBoarder, getAllBoarders, notifyBoarderPayment,removeBoarder, getMyBoardingInfo, getActiveRoomBoarders } from "./boarder.controller";
import { checkAuth } from "../../middleware/checkAuth";

const router = express.Router();

router.post("/assign", checkAuth, assignBoarder);
router.get("/getboarders", checkAuth, getAllBoarders);
router.get("/active", checkAuth, getActiveRoomBoarders);
router.post("/notify/:boarder_id", notifyBoarderPayment);
router.delete("/remove/:boarder_id", checkAuth, removeBoarder);
router.get("/my-room", checkAuth, getMyBoardingInfo);

export default router;
