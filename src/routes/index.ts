import { Router } from "express";
import {
	loginHandler, signupHandler, fileUploadHandler, fileReqByHashHandler, userUploadHistoryReqHandler,
	filesRequestHandler, singleFileReqHandler, authHandler, createFolderReqHandler, fileDelReqHandler,
	newFavFileReqHandler, fileRenameHandler
} from "../controllers";

const router = Router()

// todo: test queries that have parameters without the parameters
router.post("/login", loginHandler);
router.post("/signup", signupHandler)
router.post("/auth-user-details", authHandler)
router.post("/:folderUri/upload-file", fileUploadHandler); // rename this route since only one file is being uploaded at a time;
router.get("/fileDetail/:fileHash", fileReqByHashHandler)
router.get("/:folderUri/files-data", filesRequestHandler)
router.get("/files/:fileUri", singleFileReqHandler)
router.post("/create-folder", createFolderReqHandler)
router.get("/upload-history", userUploadHistoryReqHandler)
router.get("/delete-file/:fileUri", fileDelReqHandler)
router.get("/add-to-favourites/:fileUri", newFavFileReqHandler)
router.post("/rename-file/:fileUri", fileRenameHandler)

export default router;
