import dotenv from "dotenv";
dotenv.config();

import app from "./app";
import { startBillingCron } from "./jobs/cron";

const PORT = Number(process.env.PORT) || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is running on port ${PORT}`);
  console.log("Database connected successfully");

  try {
    startBillingCron();
    console.log("Billing cron initialized.");
  } catch (error) {
    console.error("Cron startup error:", error);
  }
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled Rejection:", error);
});