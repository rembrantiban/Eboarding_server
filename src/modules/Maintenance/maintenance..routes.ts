import {
    createMaintenanceRequest,
    getSubmittedMaintenance,
    assignMaintenanceRequest,
    updateMaintenanceStatus,
    updateMaintenanceRequest,
    getMyAssignedMaintenance,
} from "./maintenance.controller";
import express from "express";
import { upload } from "../../lib/upload";
import { checkAuth } from "../../middleware/checkAuth";


const router = express.Router()


router.post("/requests", checkAuth, upload.single("image"), createMaintenanceRequest)
router.get("/get-requests", checkAuth, getSubmittedMaintenance)
router.put("/assign/:id", checkAuth, assignMaintenanceRequest)
router.put("/status/:id", checkAuth, updateMaintenanceStatus)
router.put("/requests/:id", checkAuth, updateMaintenanceRequest)
router.get("/my-assigned", checkAuth, getMyAssignedMaintenance)


export default router