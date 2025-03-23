import { type Request, type Response } from "express";
import fs from "fs";
import fsPromises from "fs/promises"
import dbClient from "../db/client.js"
import { type FileData, type CopiedNestedFileData, } from "../db/files.js"
import { type Folder } from "../db/folders.js"
import { type User } from "../db/users.js"
// import escapeHtml from "escape-html"
import { ObjectId } from "mongodb"
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "node:crypto"
import { nanoid } from "nanoid"
import escape from "escape-html"
import path from "path"

import { generateCopiedContentDict, getFileStream } from "./utilities.js"

// generates a unique file name for an uploaded file 
function generateUniqueFileName(request: Request) {
	return request.headers["x-local-name"] + nanoid() + ".UFILE"; // u need to remove the file extension first if any
}

// checks if the request headers for a file upload are valid according to my requirements
function validateHeaders(request: Request) {
	if (!request.headers["x-file-hash"] || Array.isArray(request.headers["x-file-hash"]))
		return {isValid: false, errorMsg: "A single File hash must be present"}
	if (!request.headers["x-local-name"] || Array.isArray(request.headers["x-local-name"]))
		return {isValid: false, errorMsg: "A single file name request header must be specified"}
	if (request.headers["x-local-name"].indexOf('\0') !== -1) 
		return {isValid: false, errorMsg: "Invalid file name"}

	const relativePathName = path.join("../uploads/",request.headers["x-local-name"])
	if (!relativePathName.startsWith("../uploads") && !relativePathName.startsWith("..\\uploads")) // path traversal detected
		return {isValid: false, errorMsg: "Invalid file name"}

	if (!request.headers["x-local-name"]!.trim() || request.headers["x-local-name"]!.length > 150)
		return {isValid: false, errorMsg: "File names must be between 1 and 150 characters"}
	if (request.headers["content-length"] === "0") {
		return {isValid: false, errorMsg: "Cannot upload file of length zero"}
	}
	return {isValid: true, errorMsg: ""};
}

/** Handles a request to get an authenticated user's upload history 
 * @param {Request} req - http Request object
 * @param {Response} res - http Response object
 * @param {string} req.session.userId - id of the currently logged in user */
export async function userUploadHistoryReqHandler(req: Request, res: Response) {
	const userUploadHistory = await dbClient.files.getUserUploadHistory(req.session.userId as string)
	if (!userUploadHistory) {
		res.status(500).json({errorMsg: "Internal db error"})
	}else {
		res.status(200).json({data: userUploadHistory})
	}
}

/** Writes some chunk of data to a file on disk
 * @param {string} filename - path where the file is located 
 * @param {any} data - data to be written to the file
 * @param {string} mode - write mode i.e 'w', 'a'*/
function writeToFile(filename: string, data: any, mode: string) {
	const fd = fs.openSync(filename, mode)
	fs.writeSync(fd, data)
	fs.closeSync(fd)
}


/** Handles a request to delete a user's file 
 * @param {Request} req - http Request object
 * @param {Response} res - http Response object
 * @param {string} req.session.userId - id of the currently logged in user 
 * @param {string} req.params.fileUri - uri of the file to be deleted*/
export async function fileDelReqHandler(req: Request, res: Response) {
	const results = await dbClient.files.deleteFile(req.session.userId as string, req.params.fileUri)
	if (results.acknowledged) {
		res.status(200).json({msg: "File deleted successfully"})
	}else {
		res.status(404).json({msg: "Target resource was not found"}) // or should it be 403?
	}
}

/** Handles a request to delete a user's folder 
 * @param {Request} req - http Request object
 * @param {Response} res - http Response object
 * @param {string} req.session.userId - id of the currently logged in user 
 * @param {string} req.params.folderUri - uri of the file to be deleted */
export async function folderDelReqHandler(req: Request, res: Response) {
	const results = await dbClient.folders.deleteFolder(req.session.userId as string, req.params.folderUri)
	res.status(results.statusCode).json({msg: results, errorMsg: results.errorMsg})
}

/** Handles a request to add a file to a user's favourites 
 * @param {Request} req - http Request object
 * @param {Response} res - http Response object
 * @param {string} req.session.userId - id of the currently logged in user */
export async function newFavFileReqHandler(req: Request, res: Response) {
	const result = await dbClient.files.addFileToFavourites(req.session.userId as string, req.params.fileUri)
	if (result.acknowledged){
		res.status(200).json({msg: "File added to favourites", errorMsg: null, data: null})
	}else {
		res.status(404).json({errorMsg: "Target resource was not found", msg: null, data: null}) // or should it be 403?
	}	
}

/** Handles a request to change the name attribute in a file's metadata stored in the db
 * @param {Request} req - http Request object
 * @param {Response} res - http Response object
 * @param {string} req.session.userId - id of the currently logged in user
 * @param {string} req.body.newName - name that the old name will be changed to
 * @param {string} req.body.fileUri - uri of the file to be changed */
export async function fileRenameHandler(req: Request, res: Response) {
	if (!req.body.newName || !req.body.fileUri){
		res.status(400).json({msg: "Invalid request body"})
		return;
	}

	const results = await dbClient.files.renameFile(req.session.userId as string, req.body.fileUri, escape(req.body.newName))
	if (results.modifiedCount === 0) {
		res.status(404).json({msg: "Target resource was not found"})
	}else {
		res.status(200).json({msg: "File Renamed successfully"})
		
	}
}

/** Handles a request to change the name attribute in a folder's metadata stored in the db
 * @param {Request} req - http Request object
 * @param {Response} res - http Response object
 * @param {string} req.session.userId - id of the currently logged in user
 * @param {string} req.body.newName - name that the old name will be changed to
 * @param {string} req.body.fileUri - uri of the file to be changed */
export async function folderRenameHandler(req: Request, res: Response) {
	if (!req.body.newName || !req.body.fileUri){
		res.status(400).json({msg: "Invalid request body"})
		return;
	}

	const results = await dbClient.folders.renameFolder(req.session.userId as string, req.body.fileUri, escape(req.body.newName))
	if (results.modifiedCount === 0) {
		res.status(404).json({msg: "Target resource was not found"})
	}else {
		res.status(200).json({msg: "File Renamed successfully"})	
	}
}

/** The first parameter is a dictionary that maps folder uri strings to an Array of it's immediate children files/folders.
 * This function changes the id, name and parentFolderUri of all the objects in each array values of the dictionary recursively
 * @param {any} parentUriChildDict - dictionary mapping parent folder uris to an array of it's immediate children
 * @param {string} parentFolderUri - uri of the folder whose children would be modified first
 * @param {string} newParentFolderUri - uri the parentFolderUri each child attribute will be changed to*/
function modifyCopiedContent(parentUriChildDict: {[key:string]: (CopiedNestedFileData|Folder)[]}, parentFolderUri: string, newParentFolderUri: string) {
	if (!parentUriChildDict[parentFolderUri]) { // folder has no content
		return;
	}
	for (let content of parentUriChildDict[parentFolderUri]) {
		const oldContentUri = content.uri
		content._id = new ObjectId()
		content.uri = nanoid()
		content.parentFolderUri = newParentFolderUri
		if (content.type === "folder") {
			// only folders can have files nested in them, so we only try to modify the children of this folder if any
			modifyCopiedContent(parentUriChildDict, oldContentUri, content.uri)
		}else {
			// change the file path on disk. It will be used when the file is eventually copied
			// TODO: change the iv for secure encryption. Maybe if it ever becomes a product I can sell
			(content as CopiedNestedFileData).newPathName = content.name + nanoid() + ".UFILE"
		}
	}
}

/** Uses the header values of a file upload request to generate and return 
 * an object containing relevant details about the file*/
function generateMetaData(request: Request):FileData {
	return  {
		name: escape(request.headers["x-local-name"]) as string,
		pathName: generateUniqueFileName(request),
		type: request.headers["content-type"] as string,
		size: parseInt(request.headers["content-length"] as string),
		hash: request.headers["x-file-hash"] as string,
		userId: new ObjectId(request.session.userId),
		sizeUploaded: 0,
		uri: nanoid(),
		timeUploaded: new Date(),
		lastModified: new Date(),
		parentFolderUri: request.params.folderUri,
		inHistory: true,
		deleted: false,
		favourite: false,
		iv: randomBytes(16).toString('hex')
	}
}

// Generates a meta data object for a file upload
async function getIncomingFileMetaData(req: Request) : Promise<{errorMsg: null|string, data: FileData|null}>  {

	if (req.headers["x-resume-upload"] === "true") {
		// the upload is being resumed so the metadata would heve been stored in the db before
		let uploadedData = await dbClient.files.getFileByHash(req.session.userId as string, req.headers["x-file-hash"] as string, req.headers["x-local-name"] as string)
		if (!uploadedData) {
			return {errorMsg: "File to be updated doesn't exist!", data: null}
		}
		return {errorMsg: null, data: uploadedData}
	}else { // new upload
		const parentFolder = await dbClient.folders.getFolderDetails(req.params.folderUri, req.session.userId as string)
		if (!parentFolder) { // folder the file ought to be uploaded into doesn't exist
			return {errorMsg: "Invalid request! Parent folder doesn't exist", data: null}
		}
		let metaData = generateMetaData(req)
		let uploadedData = await dbClient.files.storeFileDetails(metaData);
		return {errorMsg: null, data: uploadedData}
	}
}

/** Encrypts a part of a file, appendss it to the existing file content if any
 * and updates the size of the file written far 
 * @param {Request} req - http Request object
 * @param {FileData} fileData - metadata of the file whose part is being encrypted
 * @param {Object} uploadTracker - has attributes that keep track of how much data has been written to the disk so far
 * @param {CipherIv} cipher - cipher object that encrypts the file part*/
function updateFileContent(req: Request, fileData: FileData, uploadTracker: {sizeUploaded: number, fileId: string}, cipher: any) { // cipher types?
	req.on('data', (chunk)=>{
		writeToFile(path.join("../uploads/",fileData.pathName), cipher.update(chunk), 'a');
		uploadTracker.sizeUploaded += chunk.length;
	})
}

/** Performs the necessary db update and other side effects after a file's content has been updated with a new upload 
 * @param {Request} req - http Request object
 * @param {Response} res - http Response object
 * @param {FileData} fileData - metadata of the file whose part is being encrypted
 * @param {number} lengthOfRecvdData - length of the newly received file chunk
 * @param {CipherIv} cipher - cipher object that encrypts the file part*/
async function handleFileUploadEnd(req: Request, res: Response, lengthOfRecvdData: number, fileData: FileData, cipher: any) {
	if (lengthOfRecvdData === 0) {
		await dbClient.files.deleteFile(fileData.userId.toString(), fileData.uri)
		res.status(400).send(JSON.stringify({data: null, errorMsg: "Empty file upload isn't allowed", msg: null}))
		return 
	}
	const lastUploadChunk = cipher.final();
	writeToFile(path.join("../uploads/",fileData.pathName), lastUploadChunk, 'a');

	if (req.complete) {
		const newFileSize = fileData.sizeUploaded + lengthOfRecvdData
		const result = await dbClient.files.addUploadedFileSize(fileData._id as string, newFileSize, req.session.userId as string, lengthOfRecvdData)

		if (result.acknowledged) {
			fileData.sizeUploaded = fileData.sizeUploaded + lengthOfRecvdData;
			res.status(200).send(JSON.stringify({data: fileData, errorMsg: null, msg: null}))
		}else
			res.status(500).send(JSON.stringify({data: null, errorMsg: "Internal Server Error!", msg: null}))
	}else { // The upload was paused or aborted client side
		const newFileSize = fileData.sizeUploaded + lengthOfRecvdData
		const result = await dbClient.files.addUploadedFileSize(fileData._id as string, newFileSize, req.session.userId as string, lengthOfRecvdData)
		if (!result.acknowledged) {
			// do something .... but what?
		}
	}
}

/** Handles a request to upload a file 
 * @param {Request} req - http Request object
 * @param {Response} res - http Response object
 * @param {string} req.session.userId - id of the currently logged in user */
export async function fileUploadHandler(req: Request, res: Response) {
	// todo: implement regular clearing of uncompleted uploads after a long time
	const uploadTracker = {fileId: "", sizeUploaded: 0};

	const validatedData = validateHeaders(req)
	if (!validatedData.isValid) {
		res.status(400).json({errorMsg: validatedData.errorMsg, msg: null, data: null})
		return;
	}

	const user = await dbClient.users.getUserWithId(req.session.userId as string)
	if (!user) {
		res.status(401).json({errorMsg: "Unauthenticated user!", msg: null, data: null});
		return;
	}
	const {errorMsg, data} = await getIncomingFileMetaData(req)
	if (errorMsg) {
		res.status(400).json({errorMsg, msg: null, data: null})
		errorMsg === "File to be updated doesn't exist!" && req.destroy()
		return
	}
	let uploadedData = data as FileData
	uploadTracker.fileId = uploadedData._id as string;

	const key = scryptSync(user.password, 'notRandomSalt', 24) 
	const aesCipher = createCipheriv("aes-192-cbc", key, Buffer.from(uploadedData.iv, 'hex'))
	const aesDecipher = createDecipheriv("aes-192-cbc", key, Buffer.from(uploadedData.iv, 'hex'))

	if (uploadedData.sizeUploaded !== 0) { // The file has been partially uploaded before
		if (!fs.existsSync(path.join("../uploads/",uploadedData.pathName))) { // this should be impossible; log that the file for the record wasn't found? delete the record?
			res.status(400).json({errorMsg: "Invalid request!", msg: null, data: null});
			return
		}
		const fileStream = fs.createReadStream(path.join("../uploads/",uploadedData.pathName)) // if not fileStream??
		const tempFileName = nanoid()+".tempfile";
		writeToFile(path.join("../uploads/",tempFileName), "", 'w');

		// decrypt partial upload first so that the partial upload and the new update can be encrypted as one file
		// to avoid problems related to padding of the partial encrypted content when decrypting
		fileStream.pipe(aesDecipher) 

		aesDecipher.on("data", (chunk)=>{
			// store file content inside another file as it's being decrypted to avoid running out of memory
			writeToFile(path.join("../uploads/",tempFileName), aesCipher.update(chunk), 'a');
		})

		aesDecipher.on('end', async ()=> {
			await fsPromises.unlink("../uploads/"+uploadedData.pathName) // delete cause it's content is outdated now
			await fsPromises.rename("../uploads/"+tempFileName, "../uploads/"+uploadedData.pathName)
			// add newly uploaded content to file
			updateFileContent(req, uploadedData, uploadTracker, aesCipher)
		})
	}else {
		writeToFile(path.join("../uploads/",uploadedData.pathName), "", 'w'); // create empty file that the encrypted data will be stored in
		// add newly uploaded content to file
		updateFileContent(req, uploadedData, uploadTracker, aesCipher)
	}
	// can 'close' be emitted before the 'data' event is attached due to decrypting data when resuming file upload??
	req.on('close', () => handleFileUploadEnd(req, res, uploadTracker.sizeUploaded, uploadedData, aesCipher))
}


/** Handles a request to delete a file from the user's upload history 
 * @param {Request} req - http Request object
 * @param {Response} res - http Response object
 * @param {string} req.session.userId - id of the currently logged in user 
 * @param {string} req.params.fileUri - db uri of the file to remove history */
export async function uploadDelFromHistoryHandler(req: Request, res: Response) {
	const results = await dbClient.files.deleteFromHistory(req.params.fileUri, req.session.userId as string)
	if (results.acknowledged)
		res.status(200).json({msg: "File has been removed from upload history", errorMsg: null, data: null})
	else
		res.status(400).json({errorMsg: "Invalid request!", data: null, msg: null}) // todo: add proper status code instead of generalizing everything as a 400
}

/** Handles a request to get a file's details/metadata by it's hash and file name
 * @param {Request} req - http Request object
 * @param {Response} res - http Response object
 * @param {string} req.session.userId - id of the currently logged in user 
 * @param {string} req.params.fileUri - db uri of the file to remove from history */
export async function fileReqByHashHandler(req: Request, res: Response) {
	if (!req.headers["x-local-name"]) {
		res.status(400).json({errorMsg: "BAD REQUEST!", data: null, msg: null})
		return;
	}

	const responseData = await dbClient.files.getFileByHash(
		req.session.userId as string, decodeURIComponent(req.params.fileHash), req.headers["x-local-name"] as string
	)
	if (!responseData){
		res.status(400).json({errorMsg: "BAD REQUEST!", data: null, msg: null})
		return 
	}
	res.status(200).json(responseData)
}

/** Handles a request to get the details/metadata of all file and folders in a logical folder
 * @param {Request} req - http Request object
 * @param {Response} res - http Response object
 * @param {string} req.session.userId - id of the currently logged in user 
 * @param {string} req.params.folderUri - db uri of the folder to to get all files from */
export async function filesRequestHandler(req: Request, res: Response) {
	const dbResponse = await dbClient.content.getUserContent(req.session.userId as string, req.params.folderUri, req.query)
	res.status(dbResponse.statusCode).json({data: dbResponse.data, msg: dbResponse.msg, errorMsg: dbResponse.errorMsg})
}


/** Handles a request for the content of a file
 * @param {Request} req - http Request object
 * @param {Response} res - http Response object
 * @param {string} req.session.userId - id of the currently logged in user 
 * @param {string} req.params.fileUri - db uri of the file whose content is to be sent */
export async function singleFileReqHandler(req: Request, res: Response) {
	const {fileStream, status, msg, aesDecipher, fileDetails} = await getFileStream(req.params.fileUri, req.session.userId as string)
	if (!fileStream){
		res.status(status).send(msg);
		console.log(msg)
		return;
	}

	// we stream the data to the client cause it's being decrypted on the fly
	if (fileStream && aesDecipher){
		aesDecipher.on('error', (err) => {
			console.log(err.message)
			res.status(500).send("Something went wrong but it's not your fault")
		})
		try {
			res.setHeader("content-type", fileDetails.type)
			res.setHeader("content-lengh", fileDetails.size)
			res.setHeader("ETag", fileDetails.hash)
			res.setHeader("Last-Modified", new Date(fileDetails.lastModified).toUTCString())
			fileStream.pipe(aesDecipher).pipe(res) // stream the file to the http response as it is being decrypted 	
		}finally {
			console.log("shut the fuck up")
		}
		
	}else 
		res.status(500).send("Something went wrong but it's not your fault")
}

/** Uses the header values of folder creation request to generate and return 
 * an object containing relevant details about the folder*/
function generateFolderMetaData(req: Request): Folder|null {
	if (!req.body.name || !req.body.parentFolderUri) {
		return null
	}
	return {
		name: escape(req.body.name),
		parentFolderUri: req.body.parentFolderUri,
		userId: new ObjectId(req.session.userId as string),
		uri: nanoid(),
		type: "folder",
		timeCreated: new Date(),
		lastModified: new Date(),
		isRoot: false,
	}

}

/** Handles a request to create a logical folder inside the db
 * @param {Request} req - http Request object
 * @param {Response} res - http Response object
 * @param {string} req.body.parentFolderUri - db uri of the folder it will be created inside */
export async function createFolderReqHandler(req: Request, res: Response) {
	const parentFolder = await dbClient.folders.getFolderDetails(req.body.parentFolderUri, req.session.userId as string)
	if (!parentFolder) {
		res.status(400).json({msg: "Invalid request!"});
		return;
	}
	const payLoad = generateFolderMetaData(req);

	if (payLoad){
		const result = await dbClient.folders.createNewFolderEntry(payLoad);
		if (!result.acknowledged) {
			res.status(500).json({errorMsg: "Internal Server Error", msg: null, data: null})
		}else {
			res.status(201).json({msg: "Folder Created successfully", data: payLoad, errrorMsg: null})
		}
	}else res.status(400).json({errorMsg: "Bad Request!", msg: null, data: null})
}

/** Handles a request to move files/folders from one folder into another
 * Note that the folders aren't actually stored in the os file system. Only the meta data is stored in the db
 * @param {Request} req - http Request object
 * @param {Response} res - http Response object
 * @param {string[]} req.body.movedContentsUris - The uris of the files/folders to be moved */
export async function moveItemsReqHandler(req: Request, res: Response) {
	if (!req.body.movedContentsUris || req.body.movedContentsUris.length === 0) {
		res.status(400).json({errorMsg: "No files to copy", data: null, })
		return
	}
	const destinationFolder = await dbClient.folders.getFolderDetails(req.body.targetFolderUri, req.session.userId as string)
	if (!destinationFolder) {
		res.status(400).json({errorMsg: "Bad Request! New Parent Folder doesn't exist", data: null, msg: null})
		return
	}

	// validate the moved files/folders uris and get the details of the content to copy 
	const contentToMoveDetails = await dbClient.content.getContentToMoveData(req.body.movedContentsUris, req.session.userId as string);

	let folders: Folder[], files: FileData[];
	if (contentToMoveDetails.msg === "valid uris"){
		folders = contentToMoveDetails.folders as Folder[]
		files = contentToMoveDetails.files as FileData[]
	}else if (contentToMoveDetails.msg === "invalid uris") {
		res.status(400).json({msg: null, errorMsg: "Some of the files to be moved do not exist", data: contentToMoveDetails.invalidUris})
		return
	}else {
		res.status(500).json({msg: null, errorMsg: "Internal Server Error", data: null})
		return
	}
	// 'move' the files/folders by updating their `parentFolderUri` attribute in the db
	const querySuccessful = await dbClient.content.updateMovedContentParent(([] as (FileData|Folder)[]).concat(folders, files), destinationFolder)

	if (querySuccessful) {
		res.status(200).json({msg: "Files moved successfully!", data: null, errorMsg: null})
	}else {
		res.status(500).json({errorMsg: "Internal Server Error!", data: null, msg: null})
	}
}

/** Copies one or more of files from a old path to a new path
 * @param {string[]} oldAndNewNestedFilePaths - Array of two strings. The first string is the old file path 
 * 												while the second string is the new file path*/
function copyFilesOnDisk(oldAndNewNestedFilePaths: [string, string][]) {
	for (let paths of oldAndNewNestedFilePaths) {
		fs.copyFileSync(`../uploads/${paths[0]}`, `../uploads/${paths[1]}`)
	}
}


/** Handles a request to copy files/folders from one logical folder in the database to another 
 * @param {Request} req - http Request object
 * @param {Response} res - http Response object
 * @param {string[]} req.body.copiedContentsUris - The uris of the files/folders to be copied
 * @param {string} req.body.targetFolderUri - The uri of the folder files are to be copied into */
export async function copyItemsReqHandler(req: Request, res: Response) {
	if (!req.body.copiedContentsUris || req.body.copiedContentsUris.length === 0 ) {
		res.status(400).json({errorMsg: "No files to copy", data: null, })
		return
	}
	const destinationFolder = await dbClient.folders.getFolderDetails(req.body.targetFolderUri, req.session.userId as string)
	if (!destinationFolder) {
		res.status(400).json({errorMsg: "Bad Request! New Parent Folder doesn't exist", data: null, })
		return
	}
	// validate the copied files/folders uris and get the details of the content to copy 
	const contentToCopyDetails = await dbClient.content.getContentDataToCopy(req.body.copiedContentsUris, req.session.userId as string);

	if (contentToCopyDetails.msg === "Home folder can't be copied") {
		res.status(400).json({msg: null, errorMsg: "Home folder can't be copied", data: null})
		return
	}else if (contentToCopyDetails.msg === "invalid uris") {
		res.status(400).json({msg: null, errorMsg: "Some of the files to be copied do not exist", data: contentToCopyDetails.invalidUris})
		return
	}else if (contentToCopyDetails.msg !== "valid uris"){ // server error
		res.status(500).json({msg: null, errorMsg: "Internal Server Error", data: null})
		return
	}

	// generates a dictionary mapping a folder's uri to an array of it's direct children
	let copiedContentDict = generateCopiedContentDict(contentToCopyDetails.folders!, contentToCopyDetails.files!);
	// change the attributes of the data to copy as needed
	modifyCopiedContent(copiedContentDict, req.body.srcFolderUri, req.body.targetFolderUri)
	const allCopiedFilesData: FileData[] = [];
	const allCopiedFoldersData: Folder[] = [];
	const pathsToCopy: [string, string][]= []

	for (let key in copiedContentDict) {
		copiedContentDict[key].forEach(content => {
			if (content.type === "folder") {
				allCopiedFoldersData.push(content as Folder)
			}else {
				const {newPathName, ...fileDetails} = content as CopiedNestedFileData
				pathsToCopy.push([fileDetails.pathName, newPathName as string])
				fileDetails.pathName = newPathName as string
				allCopiedFilesData.push(fileDetails)
			}
		})
	}

	// what if the user logs in somewhere else and deletes her account b4 this hits the db
	const user = await dbClient.users.getUserWithId(req.session.userId as string) as User
	const querySuccessful = await dbClient.content.insertCopiedResources(allCopiedFilesData, allCopiedFoldersData, user) // store the new copied files details in the db 

	if (querySuccessful) {
		if (allCopiedFilesData.length > 0) {
			// todo: probably put this in a try-catch block and reverse changes incase something goes wrong
			copyFilesOnDisk(pathsToCopy) // only files are copied on disk because folders are more or less metadata
		}
		res.status(200).json({msg: "successful!", errorMsg: null, data: null})
	}else {
		res.status(500).json({msg: "", errorMsg: "Internal Server Error. Not your fault though", data: null})
	}
}

/** Handles a request to search for a file/folder with a name similar to a string
 * @param {Request} req - http Request object
 * @param {Response} res - http Response object
 * @param {string} req.query.search_query - string that's similar to the file/folder name to search for */
export async function contentSearchReqHandler(req: Request, res: Response) {
	if (!req.query.search_query)
		res.status(400).json({data: null, errorMsg: "Bad request!", msg: null})
	const {msg, data, errorMsg, status} = await dbClient.content.searchContentByName(req.query.search_query as string)
	res.status(status).json({msg, data, errorMsg})
}

/** Handles a request to download a file most likely from the user's browser
 * @param {Request} req - http Request object
 * @param {Response} res - http Response object
 * @param {string} req.params.fileUri - database uri of the file to download */
export async function fileDownloadReqHandler(req: Request, res: Response) {
	const fileDetails = await dbClient.files.getFileDetails(req.params.fileUri, req.session.userId as string);

	if (!fileDetails){
		return res.status(404).json({msg: null,  errorMsg: "File not found", data: null});
	}

	if (!fs.existsSync(`../uploads/${fileDetails.pathName}`)) {
		return res.status(404).json({msg: null,  errorMsg: "File not found", data: null});
	}

	const user = await dbClient.users.getUserWithId(req.session.userId as string) as User;
	const key = scryptSync(user.password, 'notRandomSalt', 24) 
	const aesDecipher = createDecipheriv("aes-192-cbc", key, Buffer.from(fileDetails.iv, 'hex'))
	const fileStream = fs.createReadStream(`../uploads/${fileDetails.pathName}`)

	if (fileStream && aesDecipher) {
		res.attachment(fileDetails.name)
		res.set("Content-Length", fileDetails.size.toString())
		res.type(fileDetails.type)
		fileStream.pipe(aesDecipher).pipe(res) // the content is streamed to work around the delays of decryption
	}else 
		res.status(500).json({errorMsg: "Something went wrong but it's not your fault", msg: null, data:  null})
}