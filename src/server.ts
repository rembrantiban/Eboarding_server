import dotenv from "dotenv"
import app from "./app"
import  "./jobs/cron"
import { sendPaymentReminders } from "./modules/payments/payments.controller"
dotenv.config()

const PORT = process.env.PORT || 5000


app.listen(PORT, async () => {
  console.log(
    `Server is running on http://localhost:${PORT}`
  );
  console.log("Database connected successfully")
  await sendPaymentReminders();
});