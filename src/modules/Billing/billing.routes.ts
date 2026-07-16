import { getAllBillings } from "./billing.controller"
import express from "express"
import { checkAuth } from "../../middleware/checkAuth"

const router =  express.Router()

router.get("/get-all", checkAuth, getAllBillings)

export default router