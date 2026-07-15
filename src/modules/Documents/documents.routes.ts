import { getAllDocuments,
         getUserSubmittedDocument,
         rejectUserDocument,
         approveUserDocument
 } from "./documents.controller";
import { checkAuth } from "../../middleware/checkAuth"
import express from "express"

const router = express.Router();

router.get("/get-all", checkAuth, getAllDocuments);
router.get("/get-my-document", checkAuth, getUserSubmittedDocument);
router.put("/approve/:id", checkAuth, approveUserDocument);
router.put("/reject/:id", checkAuth, rejectUserDocument);

export default router