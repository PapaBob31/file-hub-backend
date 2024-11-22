import { Router } from "express";
import {
	loginHandler, signupHandler, fileUploadHandler, fileReqByHashHandler, userUploadHistoryReqHandler,
	filesRequestHandler, fileReqHandler, authHandler, createFolderReqHandler
} from "../controllers";

const router = Router()

router.post("/login", loginHandler);
router.post("/signup", signupHandler)
router.post("/auth-user", authHandler)
router.post("/:folderUri/upload-file", fileUploadHandler); // rename this route since only one file is being uploaded at a time;
router.get("/fileDetail/:fileHash", fileReqByHashHandler)
router.get("/:folderUri/files-data", filesRequestHandler)
router.get("/files/:fileUri", fileReqHandler)
router.post("/create-folder", createFolderReqHandler)
router.post("/upload-history", userUploadHistoryReqHandler)

export default router;
