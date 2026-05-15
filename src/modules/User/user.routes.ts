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
       } from './user.controller'
import { verifyAdmin } from "../../middleware/authMiddleware"
import { checkAuth } from "../../middleware/checkAuth"
import { upload } from "../../lib/upload"

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/admin/users", verifyAdmin, createUserByAdmin);
router.get("/users", checkAuth, getAllUsers);
router.delete("/deleteUser/:id", deleteUserAccount);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.put("/updateUser/:id",checkAuth,updateUser);
router.put("/updateProfile", checkAuth,upload.single("avatar"), updateProfile);
router.get("/check-auth", checkAuth, checkAuthenticated);

export default router