import dotenv from "dotenv"
import app from "./app"
import { pool } from "./config/db"
import  "./jobs/cron"
import { sendPaymentReminders } from "./modules/payments/payments.controller"
dotenv.config()

const PORT = process.env.PORT || 5000


async function startConfig() {
  try {
    await pool.connect();
    console.log("Database connected successfully")
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`)
    })
    await sendPaymentReminders();
  }
  catch (error) {
    console.error("Error connecting to database:", error)
  }

}

startConfig()