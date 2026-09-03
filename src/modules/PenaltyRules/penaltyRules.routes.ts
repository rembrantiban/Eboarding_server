import express from "express";
import { checkAuth } from "../../middleware/checkAuth";
import {
  createPenaltyRule,
  getAllPenaltyRules,
  getPenaltyRuleById,
  updatePenaltyRule,
} from "./penaltyRules.controller";
import { deactivatePenaltyRule } from "../Penalty/penalty.controller";

const router = express.Router();

router.post("/create", checkAuth, createPenaltyRule);
router.get("/get-all", checkAuth, getAllPenaltyRules);
router.get("/:id", checkAuth, getPenaltyRuleById);
router.put("/update/:id", checkAuth, updatePenaltyRule);
router.put("/deactivate/:id", checkAuth, deactivatePenaltyRule);

export default router;
