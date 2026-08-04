import dotenv from "dotenv"
dotenv.config()
import app from "./app"
import { startBillingCron } from "./jobs/cron";

const PORT = process.env.PORT || 5000


app.listen(PORT, async () => {
  console.log(
    `Server is running on http://localhost:${PORT}`
  );
  console.log("Database connected successfully")
    startBillingCron();
});