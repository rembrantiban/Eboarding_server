import {
    applyDiscount,
    applyLatePaymentFee,
    getAllBillings, 
    recordPayment,
    getPaymentHistory,
    getOutstandingBalance,
    getActivePenalties,
    getMyPendingBilling,
    getMyPaymentHistory,
    getPaymentsOverview,
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
router.get("/my-billing",checkAuth,getMyPendingBilling);
router.get("/my-payment-history",checkAuth,getMyPaymentHistory);
router.get("/payments-overview", checkAuth, getPaymentsOverview);

export default router