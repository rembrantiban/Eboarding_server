import cron from "node-cron";
import { sendPaymentReminders } from "../modules/payments/payments.controller";

cron.schedule("0 8 * * *", async () => {
  console.log("⏰ Running payment reminders...");

  try {
    await sendPaymentReminders();
    console.log("Reminders completed");
  } catch (error) {
    console.error("Cron job failed:", error);
  }

}, {
  timezone: "Asia/Manila"
});