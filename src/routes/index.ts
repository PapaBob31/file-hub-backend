import { Router } from "express";
import {
	loginHandler, signupHandler, fileUploadHandler, fileReqByHashHandler, userUploadHistoryReqHandler,
	filesRequestHandler, singleFileReqHandler, authHandler, createFolderReqHandler, fileDelReqHandler,
	newFavFileReqHandler, fileRenameHandler, uploadDelFromHistoryHandler
} from "../controllers";

const router = Router()

router.post("/login", loginHandler);
router.post("/signup", signupHandler)
router.get("/auth-user-details", authHandler)
router.post("/:folderUri/upload-file", fileUploadHandler);
router.get("/fileDetail/:fileHash", fileReqByHashHandler) // I think the file hash would be too long in a url. Make It a post req or get the file by another id
router.get("/:folderUri/files-data", filesRequestHandler)
router.get("/files/:fileUri", singleFileReqHandler)
router.post("/create-folder", createFolderReqHandler)
router.get("/upload-history", userUploadHistoryReqHandler)
router.post("/delete-file/:fileUri", fileDelReqHandler)
router.get("/add-to-favourites/:fileUri", newFavFileReqHandler)
router.post("/rename-file/:fileUri", fileRenameHandler)
router.post("/remove-from-history/:fileUri", uploadDelFromHistoryHandler)

export default router;
