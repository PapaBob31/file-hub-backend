import { Router } from "express";
import {
	loginHandler, signupHandler, fileUploadHandler, fileReqByHashHandler, userUploadHistoryReqHandler, moveFilesReqHandler, 
	copyFilesReqHandler, filesRequestHandler, singleFileReqHandler, authHandler, createFolderReqHandler, fileDelReqHandler, 
	sharedFileContentReqHandler, fileDownloadReqHandler, newFavFileReqHandler, fileRenameHandler, uploadDelFromHistoryHandler, sharedFileMetaDataReqdHandler,
	accessGrantReqHandler, UserSharedFilesDetailsReqHandler, searchFilesReqHandler, copySharedFilesReqHandler, revokeSharedAccessReqHandler
} from "../controllers/index.js";

const router = Router()

router.post("/login", loginHandler);
router.post("/signup", signupHandler)
router.get("/auth-user-details", authHandler)
router.post("/:folderUri/upload-file", fileUploadHandler);
router.get("/fileDetail/:fileHash", fileReqByHashHandler) // I think the file hash would be too long in a url. Make It a post req or get the file by another id
router.get("/:folderUri/files-data", filesRequestHandler) // Check what would happen if the request didn't contain it's parameters e.g. the request didn't contain a folderUri
router.get("/files/:fileUri", singleFileReqHandler)
router.post("/create-folder", createFolderReqHandler)
router.get("/upload-history", userUploadHistoryReqHandler)
router.post("/delete-file/:fileUri", fileDelReqHandler)
router.get("/add-to-favourites/:fileUri", newFavFileReqHandler)
router.post("/rename-file/:fileUri", fileRenameHandler)
router.post("/remove-from-history/:fileUri", uploadDelFromHistoryHandler)
router.post("/share", accessGrantReqHandler)
router.get("/shared/:shareId", sharedFileMetaDataReqdHandler)
router.get("/shared/:shareId/:contentUri", sharedFileContentReqHandler)
router.post("/shared/copy-files", copySharedFilesReqHandler)
router.post("/shared/revoke-access", revokeSharedAccessReqHandler)
router.get("/shared-files", UserSharedFilesDetailsReqHandler)
router.post("/move-files", moveFilesReqHandler)
router.post("/copy-files", copyFilesReqHandler) // payload{fileUri: targetFolderUri}
router.get("/search", searchFilesReqHandler) // payload{fileUri: targetFolderUri}
router.get("/download/:fileUri", fileDownloadReqHandler)

export default router;
