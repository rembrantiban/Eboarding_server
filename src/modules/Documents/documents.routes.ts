import { getAllDocuments,
         getUserSubmittedDocument,
         rejectUserDocument,
         approveUserDocument,
         verifyUserDocument,
         uploadDocument,
 } from "./documents.controller";
import { checkAuth } from "../../middleware/checkAuth"
import express from "express"
import { upload } from "../../lib/upload"

const router = express.Router();

router.get("/get-all", checkAuth, getAllDocuments);
router.get("/get-my-document", checkAuth, getUserSubmittedDocument);
router.put("/approve/:id", checkAuth, approveUserDocument);
router.put("/reject/:id", checkAuth, rejectUserDocument);
router.put("/verify/:id", checkAuth, verifyUserDocument);
router.put("/upload", checkAuth, upload.fields([{ name: "valid_id_image", maxCount: 1 }]), uploadDocument);
export default router