import {
    applyDiscount,
    applyLatePaymentFee,
    getAllBillings, 
    recordPayment,
    getPaymentHistory,
    getOutstandingBalance,
    getActivePenalties,
} from "./billing.controller"
import express from "express"
import { checkAuth } from "../../middleware/checkAuth"

const router = express.Router()

router.get("/get-all", checkAuth, getAllBillings)
router.put("/record-payment/:id", checkAuth, recordPayment)
router.put("/apply-late-fee/:id", checkAuth, applyLatePaymentFee);
router.put( "/apply-discount/:id",checkAuth, applyDiscount);
router.get("/payment-history", checkAuth, getPaymentHistory);
router.get("/outstanding-balance", checkAuth, getOutstandingBalance);
router.get("/active-penalties", checkAuth, getActivePenalties);

export default router