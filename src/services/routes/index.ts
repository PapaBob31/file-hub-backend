/// @ts-ignore
import { Router } from "express";

import /*loginHandler, signupHandler,*/ { sessionEndReqHandler, authHandler, deleteUserReqHandler} from "../controllers/authControllers.js";

import {
	fileUploadHandler, fileReqByHashHandler, userUploadHistoryReqHandler, moveItemsReqHandler, folderDelReqHandler,
	copyItemsReqHandler, filesRequestHandler, singleFileReqHandler, createFolderReqHandler, fileDelReqHandler, folderRenameHandler,
	fileDownloadReqHandler, newFavFileReqHandler, fileRenameHandler, uploadDelFromHistoryHandler, contentSearchReqHandler
} from "../controllers/dataControllers.js";

import { sharedFileDownloadReqHandler, sharedItemsContentReqHandler, sharedFileMetaDataReqdHandler,
	accessGrantReqHandler, UserSharedFilesDetailsReqHandler, copySharedContentReqHandler, revokeSharedAccessReqHandler
} from "../controllers/sharedDataControllers.js";


const router = Router()

/*
things to cache

files data?
shared content data?
file content?

Date
Etag
last-modified
no-cache
no-store

*/



// router.post("/login", loginHandler);
// router.post("/signup", signupHandler)
router.get("/auth-user-details", authHandler)
router.post("/:folderUri/upload-file", fileUploadHandler);
router.get("/fileDetail/:fileHash", fileReqByHashHandler) // I think the file hash would be too long in a url. Make It a post req or get the file by another id
router.get("/:folderUri/files-data", filesRequestHandler)
router.get("/files/:fileUri", singleFileReqHandler)
router.post("/create-folder", createFolderReqHandler)
router.get("/upload-history", userUploadHistoryReqHandler)
router.post("/delete-file/:fileUri", fileDelReqHandler)
router.post("/delete-folder/:folderUri", folderDelReqHandler)
router.post("/add-to-favourites/:fileUri", newFavFileReqHandler)
router.post("/rename-file", fileRenameHandler)
router.post("/rename-folder", folderRenameHandler)
router.post("/remove-from-history/:fileUri", uploadDelFromHistoryHandler)
router.post("/share", accessGrantReqHandler)
router.get("/shared/:shareId", sharedFileMetaDataReqdHandler)
router.get("/shared/:shareId/:contentUri", sharedItemsContentReqHandler)
router.post("/shared/copy-items", copySharedContentReqHandler) // todo: change the endpoint from 'copy-files' to 'copy-content'
router.post("/shared/revoke-access", revokeSharedAccessReqHandler)
router.get("/shared-files", UserSharedFilesDetailsReqHandler)
router.get("/shared/download/:shareId/:fileUri", sharedFileDownloadReqHandler)
router.post("/move-items", moveItemsReqHandler)
router.post("/copy-items", copyItemsReqHandler) // payload{fileUri: targetFolderUri}
router.get("/search", contentSearchReqHandler)
router.get("/download/:fileUri", fileDownloadReqHandler)
router.post("/logout", sessionEndReqHandler)
router.post("/delete-account", deleteUserReqHandler)
export default router;
