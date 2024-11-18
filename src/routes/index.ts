import { Router } from "express";
import {loginHandler, signupHandler, fileUploadHandler, fileReqByHashHandler, filesRequestHandler, imgReqHandler } from "../controllers";
const router = Router()

router.post("/login", loginHandler);
router.post("/signup", signupHandler)
router.post("/upload-files", fileUploadHandler); // renmae this route since only one file is being uploaded at a time;
router.get("/fileDetail/:fileHash", fileReqByHashHandler)
router.get("/files-data", filesRequestHandler)
router.get("/images/:fileUrl", imgReqHandler)

export default router;
