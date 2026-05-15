import { 
      createRule,
      getRules,
      updateRule,
      deleteRule,
      } from "./rules.controller"
import express from "express"

const router = express.Router()

router.post("/create", createRule);
router.get("/getallRules", getRules);
router.put("/update/:id", updateRule);
router.delete("/delete/:id", deleteRule);

export default router