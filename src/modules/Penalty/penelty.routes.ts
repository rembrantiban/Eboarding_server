import express from "express";
import { checkAuth } from "../../middleware/checkAuth";
import {
  createPenalty,
  getAllUsersWithPenalties,
  getMyPenalties,
  getMyPenaltyRecords,
  updatePenalty,
  removePenalty,
  recordPenaltySettlement,
  getPenaltySettlements,
} from "./penalty.controller";

const router = express.Router();

router.post("/create", checkAuth, createPenalty);
router.get("/get-all", checkAuth, getAllUsersWithPenalties);
router.get("/my", checkAuth, getMyPenalties);
router.get("/my/records", checkAuth, getMyPenaltyRecords);
router.put("/update/:id", checkAuth, updatePenalty);
router.delete("/remove/:id", checkAuth, removePenalty);
router.put("/settle/:id", checkAuth, recordPenaltySettlement);
router.get("/settlements/:id", checkAuth, getPenaltySettlements);

export default router;
