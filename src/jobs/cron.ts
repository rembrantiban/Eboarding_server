import cron from "node-cron";
import { pool } from "../config/db";

export const startBillingCron = () => {
  cron.schedule("0 0 * * *", async () => {
    console.log("Running overdue billing checker...");

    try {
      const result = await pool.query(
        `
        UPDATE billings
        SET
          status = 'Overdue',
          updated_at = NOW()
        WHERE
          status IN ('Pending', 'Partial')
          AND due_date < CURRENT_DATE
        RETURNING billing_no;
        `
      );

      console.log(
        `${result.rowCount} billing(s) marked as Overdue.`
      );

    } catch (error) {
      console.error("Billing cron error:", error);
    }
  });

  console.log("Billing cron initialized.");
};