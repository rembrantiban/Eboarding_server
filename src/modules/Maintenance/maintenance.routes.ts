import {
    createMaintenanceRequest,
    getBoardersForRequest,
    getSubmittedMaintenance,
    getMaintenanceHistory,
    assignMaintenanceRequest,
    updateMaintenanceStatus,
    updateMaintenanceRequest,
    getMyAssignedMaintenance,
    getMySubmittedRequest,
    getBoarderRequests,
    getBoarderMaintenanceHistory,
    getAllStaffAssignedMaintenance,
    updateAssignedMaintenanceRequest,
    updateMySubmittedMaintenanceRequest,
} from "./maintenance.controller";
import express from "express";
import { upload } from "../../lib/upload";
import { checkAuth } from "../../middleware/checkAuth";


const router = express.Router()


router.post("/requests", checkAuth, upload.single("image"), createMaintenanceRequest)
router.get("/boarders", checkAuth, getBoardersForRequest)
router.get("/get-requests", checkAuth, getSubmittedMaintenance)
router.get("/history", checkAuth, getMaintenanceHistory)
router.put("/assign/:id", checkAuth, assignMaintenanceRequest)
router.put("/status/:id", checkAuth, upload.single("image"), updateMaintenanceStatus)
router.put("/requests/:id", checkAuth, updateMaintenanceRequest)
router.get("/my-assigned", checkAuth, getMyAssignedMaintenance)
router.get("/my-submitted", checkAuth, getMySubmittedRequest)
router.get("/boarder", checkAuth, getBoarderRequests)
router.get("/boarder/history", checkAuth, getBoarderMaintenanceHistory)
router.get("/all-staff-assigned", checkAuth, getAllStaffAssignedMaintenance)
router.put("/staff/update/:id", checkAuth, updateAssignedMaintenanceRequest)
router.put("/my-submitted/update/:id", checkAuth, updateMySubmittedMaintenanceRequest)

export default router
