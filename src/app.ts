import express from "express"
import cors from "cors"
import userRoutes  from "./modules/User/user.routes"
import roomRoutes from "./modules/Room/room.routes"
import boarderRoutes from "./modules/Boarder/boarder.routes"
import paymentRoutes from "./modules/payments/payments.routes"
import announcements from "./modules/anouncements/announcements.routes"
import rules from "./modules/rules/rules.routes"
import documents from "./modules/Documents/documents.routes"
import roomAssignmentRoutes from "./modules/RoomAssignment/AssignRoom.routes";
import BillingRoutes from "./modules/Billing/billing.routes"
import MaintenanceRoutes from "./modules/Maintenance/maintenance..routes"
import penaltyRoutes from "./modules/Penalty/penelty.routes"
import penaltyRulesRoutes from "./modules/PenaltyRules/penaltyRules.routes"


import dotenv from "dotenv"
dotenv.config()

const app = express()

const allowedOrigins = [
  "http://localhost:5173",
  process.env.CLIENT_URL,
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

app.use(express.json())


app.use("/api/auth", userRoutes)
app.use("/api/rooms", roomRoutes)
app.use("/api/boarders", boarderRoutes)
app.use("/api/payments", paymentRoutes)
app.use("/api/announcements", announcements)
app.use("/api/room-assignment", roomAssignmentRoutes)
app.use("/api/rules", rules)  
app.use("/api/documents", documents)
app.use("/api/billings", BillingRoutes)
app.use("/api/maintenance", MaintenanceRoutes)
app.use("/api/penalties", penaltyRoutes)
app.use("/api/penalty-rules", penaltyRulesRoutes)

app.get("/", (req, res) => {
  res.send("API is running ")
})

export default app  