import express from "express"
import cors from "cors"
import userRoutes  from "./modules/User/user.routes"
import roomRoutes from "./modules/Room/room.routes"
import boarderRoutes from "./modules/Boarder/boarder.routes"
import paymentRoutes from "./modules/payments/payments.routes"
import announcements from "./modules/anouncements/announcements.routes"
import rules from "./modules/rules/rules.routes"
import { assignRoom } from "./modules/RoomAssignment/AssignRoom.contoller"

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
app.use("/api/room-assignment", assignRoom)
app.use("/api/rules", rules)  
app.get("/", (req, res) => {
  res.send("API is running ")
})

export default app  