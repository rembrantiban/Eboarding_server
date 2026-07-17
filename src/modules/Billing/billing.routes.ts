import {
    getAllBillings, 
    recordPayment

} from "./billing.controller"
import express from "express"
import { checkAuth } from "../../middleware/checkAuth"

const router = express.Router()

router.get("/get-all", checkAuth, getAllBillings)
router.put("/record-payment/:id", checkAuth, recordPayment)

export default router