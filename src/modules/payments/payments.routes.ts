import express from "express";
import { checkAuth } from "../../middleware/checkAuth";
import { getPaymentReport, 
        sendPaymentReminders, 
        markPaymentAsPaid,
        getCalendarPayments,
        getMyPaidPayments, 
        getReport, 
        getPaymentAnalytics,
        getRevenueDashboard
        } from "./payments.controller";


const router = express.Router();

router.get("/getpayment", getPaymentReport);
router.put("/mark-as-paid/:payment_id", markPaymentAsPaid);
router.get("/calendar", getCalendarPayments);
router.get("/my-paid-payments", checkAuth, getMyPaidPayments);
router.get("/getreport", checkAuth, getReport);
router.get("/test-reminders", async (req, res) => {
  try {
    await sendPaymentReminders();
    res.json({ success: true, message: "Reminders executed" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Error running reminders" });
  }
});
router.get("/payment-analytics", checkAuth, getPaymentAnalytics);
router.get("/revenue-dashboard", checkAuth, getRevenueDashboard);
export default router;