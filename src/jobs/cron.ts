import cron from "node-cron";
import { pool } from "../config/db";
import { resend } from "../config/resend";
import { paymentTemplate } from "../services/paymentEmailTemplate";
import {
  OVERDUE_PENALTY_PER_WEEK,
  applyOverduePenalties,
  ensureOverduePenaltyColumn,
  overduePenaltyMessage,
} from "../modules/Billing/billing.helper";

const runOverdueBillingCheck = async () => {
  console.log("Running overdue billing checker...");

  const client = await pool.connect();
  let penalized: Awaited<ReturnType<typeof applyOverduePenalties>> = [];

  try {
    await client.query("BEGIN");

    const result = await client.query(
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

    penalized = await applyOverduePenalties(client);

    await client.query("COMMIT");

    console.log(
      `${result.rowCount} billing(s) marked as Overdue.`
    );
    console.log(
      `${penalized.length} billing(s) charged a weekly overdue penalty.`
    );

  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Billing cron error:", error);
    return;
  } finally {
    client.release();
  }

  // Emails go out after commit so a mail failure never undoes the penalty
  for (const b of penalized) {
    if (!b.email) continue;

    try {
      await resend.emails.send({
        from: "E-Boarding <noreply@eboarding.site>",
        to: b.email,
        subject: "🚨 Overdue Billing Penalty",
        html: paymentTemplate(
          { ...b, amount: b.balance },
          "Billing Overdue",
          overduePenaltyMessage(
            b.billing_no,
            b.overdue_weeks_charged,
            b.overdue_weeks_charged * OVERDUE_PENALTY_PER_WEEK
          )
        ),
      });
    } catch (error) {
      console.error(`Penalty email error (${b.billing_no}):`, error);
    }
  }
};

export const startBillingCron = async () => {
  const client = await pool.connect();

  try {
    await ensureOverduePenaltyColumn(client);
  } finally {
    client.release();
  }

  cron.schedule("0 0 * * *", runOverdueBillingCheck);

  // Catch billings that went overdue while the server was down
  await runOverdueBillingCheck();

  console.log("Billing cron initialized.");
};
