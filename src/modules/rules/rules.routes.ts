import { 
      createRule,
      getRules,
      updateRule,
      deleteRule,
      publishRule,
      unpublishRule,
      getPublishedRules
      } from "./rules.controller"
import express from "express"

const router = express.Router()

router.post("/create", createRule);
router.get("/getallRules", getRules);
router.put("/update/:id", updateRule);
router.delete("/delete/:id", deleteRule);
router.get("/published", getPublishedRules);
router.put("/publish/:id", publishRule);
router.put("/unpublish/:id", unpublishRule);

export default router