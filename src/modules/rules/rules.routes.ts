import {
      createRule,
      getRules,
      updateRule,
      deleteRule,
      publishRule,
      unpublishRule,
      getPublishedRules,
      acknowledgeRules,
      getAcknowledgmentStatus
      } from "./rules.controller"
import express from "express"
import { checkAuth } from "../../middleware/checkAuth"

const router = express.Router()

router.post("/create", createRule);
router.get("/getallRules", getRules);
router.put("/update/:id", updateRule);
router.delete("/delete/:id", deleteRule);
router.get("/published", getPublishedRules);
router.put("/publish/:id", publishRule);
router.put("/unpublish/:id", unpublishRule);
router.post("/acknowledge", checkAuth, acknowledgeRules);
router.get("/acknowledgment/status", checkAuth, getAcknowledgmentStatus);

export default router