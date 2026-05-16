import express from "express"
import cors from "cors"
import userRoutes  from "./modules/User/user.routes"
import roomRoutes from "./modules/Room/room.routes"
import boarderRoutes from "./modules/Boarder/boarder.routes"
import paymentRoutes from "./modules/payments/payments.routes"
import announcements from "./modules/anouncements/announcements.routes"
import rules from "./modules/rules/rules.routes"
const app = express()

const normalizeUrl = (url: string) => url.replace(/\/$/, "");

app.use(cors(
   {
      origin: (origin, callback) => {
        const clientUrl = normalizeUrl(process.env.CLIENT_URL || "http://localhost:5173");
        if (!origin) return callback(null, true);
        const normalizedOrigin = normalizeUrl(origin);
        if (normalizedOrigin === clientUrl) {
          callback(null, true);
        } else {
          callback(new Error("CORS policy: Origin not allowed"));
        }
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE"],
      allowedHeaders:["Content-Type", "Authorization"]
    }
))
app.use(express.json())


app.use("/api/auth", userRoutes)
app.use("/api/rooms", roomRoutes)
app.use("/api/boarders", boarderRoutes)
app.use("/api/payments", paymentRoutes)
app.use("/api/announcements", announcements)
app.use("/api/rules", rules)  
app.get("/", (req, res) => {
  res.send("API is running ")
})

export default app  