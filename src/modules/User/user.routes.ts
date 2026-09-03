import express from "express"
import {
        register,
        login,
        createUserByAdmin,
        getAllUsers,
        deleteUserAccount,
        resetPassword,
        forgotPassword,
        checkAuthenticated,
        updateUser,
        updateProfile,
        countTotalBoarders,
        updateProfileSettings,
        createUserByStaff,
        deactivateUserAccount,
        activateUserAccount,
        updateUserStatus,
        getAvailableBoarders,
        recoverDeletedUserAccount,
        getAllDeletedUserAccounts,
        getAvailableStaff,
        getStaffDashboardStats,
        getBoarderStats,
        getBoarderStatusStats,
        getBoardersOverTime,
        getRecentBoarders,
        getBoardersList,
        getBoarderSummary,
        resetUserPassword,
       } from './user.controller'
import { verifyAdmin } from "../../middleware/authMiddleware"
import { checkAuth } from "../../middleware/checkAuth"
import { upload } from "../../lib/upload"

const router = express.Router();

router.post( "/register", upload.fields([{ name: "avatar", maxCount: 1 },{ name: "valid_id_image", maxCount: 1 }, ]),
  register
)       ;
router.post("/login", login);
router.post("/admin/users",upload.fields([{ name: "avatar", maxCount: 1 },{ name: "valid_id_image", maxCount: 1 }, ]), verifyAdmin, createUserByAdmin);
router.post("/staff/users",upload.fields([{ name: "avatar", maxCount: 1 },{ name: "valid_id_image", maxCount: 1 }, ]), checkAuth, createUserByStaff);
router.get("/users", checkAuth, getAllUsers);
router.delete("/deleteUser/:id", checkAuth, deleteUserAccount);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.put("/updateUser/:id",checkAuth,updateUser);
router.put("/updateProfile", checkAuth,upload.single("avatar"), updateProfile);
router.get("/check-auth", checkAuth, checkAuthenticated);
router.get("/total-boarders",checkAuth, countTotalBoarders);
router.put("/profile-settings", checkAuth, upload.single("avatar"), updateProfileSettings);    
router.put("/deactivate-user/:id", checkAuth, deactivateUserAccount);
router.put("/activate-user/:id", checkAuth, activateUserAccount);
router.put("/update-user-status/:id", checkAuth, verifyAdmin, updateUserStatus);
router.get("/available-boarders", checkAuth, getAvailableBoarders);
router.get("/deleted-users", checkAuth, getAllDeletedUserAccounts);
router.put("/recover-deleted-user/:id", checkAuth, verifyAdmin, recoverDeletedUserAccount);
router.get("/available-staff", checkAuth, getAvailableStaff);
router.get("/get-staff-dashboard-stats", checkAuth, getStaffDashboardStats);
router.get("/boarder-stats", checkAuth, getBoarderStats);
router.get("/boarder-status-stats", checkAuth, getBoarderStatusStats);
router.get("/boarders-over-time", checkAuth, getBoardersOverTime);
router.get("/recent-boarders", checkAuth, getRecentBoarders);
router.get("/boarders-list", checkAuth, getBoardersList);
router.get("/boarder-summary", checkAuth, getBoarderSummary);
router.put("/reset-user-password/:id", checkAuth, verifyAdmin, resetUserPassword);

export default router   