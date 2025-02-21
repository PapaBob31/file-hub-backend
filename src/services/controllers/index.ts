import { type Request, type Response } from "express";
import fs from "fs";
import fsPromises from "fs/promises"
// import path from "node:path";
// import { generateUrlSlug } from "./utilities"
import dbClient, { type FileData, type User, type Folder } from "../db/client.js"
// import escapeHtml from "escape-html"
import { ObjectId } from "mongodb"
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "node:crypto"
import { nanoid } from "nanoid"
import Tokens from "csrf"

/*
todo: Standardize the format of all your responses, Change every hardcoded variable to environment variable
read up on time in js and mongodb
Query only the required fields. Stop querying all fields, encrypt and decrypt all userIds as needed
Add serious logging => response type, db errors, server errors e.t.c.
Add types to evrything!
prevent usage of stolen auth cookies
escape html from any form of user input that will be displayed later; usernames are case insensitive
handle bogus http requests, i.e 404 everyhing that ought to have a payload but doesn't and much more
filepath issues such as file path max name length; max file size, path traversing exploits, e.t.c
what happens if I set invalid response code i.e 4000 instead of 400
what happens if a file is deleted while it's still being streamed or sent to the client

ensure proper validation especially all those type assertions

LOGOUT

How does exppress work internally? Should I use threads?
--->> do everything related to time properly and deleting a file should delete it from any shared entry if any too
send a file request and abort while the page reloads to see how express reacts

How can get paramteters be dangerous if improperly parsed?

BULL?
*/


// todo: implement proper pathname and make sure we can't override existing file
function generateUniqueFileName(request: Request) {
	return request.headers["x-local-name"] + nanoid() + ".UFILE"; // u need to remove the file extension first if any
}


function writeToFile(filename: string, data: any, mode: string) {
	const fd = fs.openSync(filename, mode)
	fs.writeSync(fd, data)
	fs.closeSync(fd)
}

/** Handles a request to login a User 
 * @param {string} req.body.email - User's email
 * @param {string} req.body.password - User's password*/
export async function loginHandler(req: Request, res: Response) {
	if (!req.body || !req.body.password || !req.body.email) {
		return res.status(401).json({error: "Invalid login details!"});
	}
	const user = await dbClient.loginUser(req.body);
	if (user) {
		const tokens = new Tokens()
		req.session.userId = user._id as string
		req.session.csrfSecret = tokens.secretSync()
		return res.status(200).json({msg: "success", loggedInUserName: user.username})
	}else return res.status(401).json({error: "Invalid login details!"});
}

/** Handles a request to register a new User
 * @param {Object} req.body - {username: string, email: string, password: string, passwordExtraCheck: string}*/
export async function signupHandler(req: Request, res: Response) {
	if (!req.body.username || !req.body.email) {
		return res.status(400).json({msg: "Invalid request body"});
	}
	if (!req.body.password || req.body.password !== req.body.passwordExtraCheck || req.body.password.length < 10) {
		return res.status(400).json({msg: "Invalid request body"});
	}
	const {status, msg, errorMsg} = await dbClient.createNewUser(req.body);
	res.status(status).json({msg, errorMsg, data: null})
}

function headersAreValid(request: Request) {
	if (!request.headers["x-file-hash"] || !request.headers["x-local-name"]) {
		return false
	}
	return true;
}

function generateMetaData(request: Request):FileData {
	return  {
		name: request.headers["x-local-name"] as string,
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

async function getIncomingFileMetaData(req: Request) : Promise<{errorMsg: null|string, data: FileData|null}>  {

	if (req.headers["x-resume-upload"] === "true") {
		let uploadedData = await dbClient.getFileByHash(req.session.userId as string, req.headers["x-file-hash"] as string, req.headers["x-local-name"] as string)
		if (!uploadedData) {
			return {errorMsg: "File to be updated doesn't exist!", data: null}
		}
		return {errorMsg: null, data: uploadedData}
	}else {
		const parentFolder = await dbClient.getFolderDetails(req.params.folderUri, req.session.userId as string)
		if (!parentFolder){
			return {errorMsg: "Invalid request! Parent folder doesn't exist", data: null}
		}
		let metaData = generateMetaData(req)
		let uploadedData = await dbClient.storeFileDetails(metaData);
		return {errorMsg: null, data: uploadedData}
	}
}

/** Encrypts the body of a file upload and updates a file with the encrypted content */
function updateFileContent(req: Request, fileData: FileData, uploadTracker: {sizeUploaded: number, fileId: string}, cipher: any) { // cipher types?
	req.on('data', (chunk)=>{
		writeToFile("../uploads/"+fileData.pathName, cipher.update(chunk), 'a');
		uploadTracker.sizeUploaded += chunk.length;
		// console.log(uploadTracker.sizeUploaded)
	})
}

/** Performs the necessary db update and other side effects after a file's content has been updated with a new upload */
async function handleFileUploadEnd(req: Request, res: Response, lengthOfRecvdData: number, fileData: FileData, cipher: any) {
	const lastUploadChunk = cipher.final();
	writeToFile("../uploads/"+fileData.pathName, lastUploadChunk, 'a');

	if (req.complete) {
		const newFileSize = fileData.sizeUploaded + lengthOfRecvdData
		const result = await dbClient.addUploadedFileSize(fileData._id as string, newFileSize, req.session.userId as string, lengthOfRecvdData)

		if (result.acknowledged) {
			fileData.sizeUploaded = fileData.sizeUploaded + lengthOfRecvdData;
			res.status(200).send(JSON.stringify({data: fileData, errorMsg: null, msg: null}))
		}else
			res.status(500).send(JSON.stringify({data: null, errorMsg: "Internal Server Error!", msg: null}))
	}else { // The upload was paused or aborted client side
		const newFileSize = fileData.sizeUploaded + lengthOfRecvdData
		const result = await dbClient.addUploadedFileSize(fileData._id as string, newFileSize, req.session.userId as string, lengthOfRecvdData)
		if (!result.acknowledged) {
			// do something .... but what?
		}
	}
}

/** Handles a request to upload a file */
export async function fileUploadHandler(req: Request, res: Response) {
	// todo: implement regular clearing of uncompleted uploads after a long time
	const uploadTracker = {fileId: "", sizeUploaded: 0};

	if (!headersAreValid(req)) {
		res.status(400).json({msg: "Invalid headers!"})
		return;
	}

	const user = await dbClient.getUserWithId(req.session.userId as string)
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
		if (!fs.existsSync("../uploads/"+uploadedData.pathName)) { // this should be impossible; log that the file for the record wasn't found? delete the record?
			res.status(400).json({errorMsg: "Invalid request!", msg: null, data: null});
			return
		}
		const fileStream = fs.createReadStream("../uploads/"+uploadedData.pathName) // if not fileStream??
		const tempFileName = nanoid()+".tempfile";
		writeToFile("../uploads/"+tempFileName, "", 'w');

		// decrypt partial upload first so that the partial upload and the new update can be encrypted as one file
		// to avoid problems related to padding of the partial encrypted content when decrypting
		fileStream.pipe(aesDecipher) 

		aesDecipher.on("data", (chunk)=>{
			// store file content inside another file as it's being decrypted to avoid running out of memory
			writeToFile("../uploads/"+tempFileName, aesCipher.update(chunk), 'a');
		})

		aesDecipher.on('end', async ()=> {
			await fsPromises.unlink("../uploads/"+uploadedData.pathName) // delete cause it's content is outdated now
			await fsPromises.rename("../uploads/"+tempFileName, "../uploads/"+uploadedData.pathName)
			// add newly uploaded content to file
			updateFileContent(req, uploadedData, uploadTracker, aesCipher)
		})
	}else {
		writeToFile("../uploads/"+uploadedData.pathName, "", 'w'); // create empty file that the encrypted data will be stored in
		// add newly uploaded content to file
		updateFileContent(req, uploadedData, uploadTracker, aesCipher)
	}
	// can 'close' be emitted before the 'data' event is attached due to decrypting data when resuming file upload
	req.on('close', () => handleFileUploadEnd(req, res, uploadTracker.sizeUploaded, uploadedData, aesCipher))
}


/** Handles a request to delete a file from the user's upload history 
 * @param {string} req.params.fileUri - db uri of the file to remove history */
export async function uploadDelFromHistoryHandler(req: Request, res: Response) {
	const results = await dbClient.deleteFromHistory(req.params.fileUri, req.session.userId as string)
	if (results.acknowledged)
		res.status(200).json({msg: "File has been removed from upload history", errorMsg: null, data: null})
	else
		res.status(400).json({errorMsg: "Invalid request!", data: null, msg: null}) // todo: add proper status code instead of generalizing everything as a 400
}

/** Handles a request to get a file's details/metadata by it's hash and file name
 * @param {string} req.params.fileUri - db uri of the file to remove from history */
export async function fileReqByHashHandler(req: Request, res: Response) {
	if (!req.headers["x-local-name"]) {
		res.status(400).json({errorMsg: "BAD REQUEST!", data: null, msg: null})
		return;
	}
	// readup on accepted characters in urls
	const responseData = await dbClient.getFileByHash(
		req.session.userId as string, decodeURIComponent(req.params.fileHash), req.headers["x-local-name"] as string
	)
	if (!responseData){
		res.status(400).json({errorMsg: "BAD REQUEST!", data: null, msg: null})
		return 
	}
	res.status(200).json(responseData)
}

/** Handles a request to get the details/metadata of all files in a logical folder
 * @param {string} req.params.folderUri - db uri of the folder to to get all files from */
export async function filesRequestHandler(req: Request, res: Response) {
	const dbResponse = await dbClient.getFilesData(req.session.userId as string, req.params.folderUri, req.query)
	console.log(dbResponse);
	res.status(dbResponse.statusCode).json({data: dbResponse.data, msg: dbResponse.msg, errorMsg: dbResponse.errorMsg})
}

export async function authHandler(req: Request, res: Response) { // yep. turn it into a middleware
	const user = await dbClient.getUserWithId(req.session.userId as string)
	if (user) {
		const tokens = new Tokens()
		res.status(200).json({data: {...user, csrfToken: tokens.create(req.session.csrfSecret as string)}, errorMsg: null, msg: null})
	}else {
		res.status(401).json({errorMsg: "Invalid Request! Unauthenticated User!", data: {username: null}, msg: null})
	}
}


async function getFileStream(fileUri: string, userId: string) {
	const fileDetails = await dbClient.getFileDetails(fileUri, userId);
	if (!fileDetails){
		return {status: 404, msg: "File not found", fileStream: null, aesDecipher: null};
	}
	if (!fileDetails.type.startsWith("image/") && !fileDetails.type.startsWith("video/")) {
		return {status: 400, msg: "Bad Request", fileStream: null, aesDecipher: null};
	}
	// todo: add proper path name and try and make every type of video supported on most browsers [start from firefox not supporting mkv]
	if (!fs.existsSync(`../uploads/${fileDetails.pathName}`)) {
		return {status: 404, msg: "File not found", fileStream: null, aesDecipher: null};
	}
	const user = await dbClient.getUserWithId(userId) as User;
	const key = scryptSync(user.password, 'notRandomSalt', 24)
	const aesDecipher = createDecipheriv("aes-192-cbc", key, Buffer.from(fileDetails.iv, 'hex'))
	// what if it doesn't return a file stream?
	const fileStream = fs.createReadStream(`../uploads/${fileDetails.pathName}`)
	return {status: null, msg: null, fileStream, aesDecipher};
}

/** Handles a request for the content of a file
 * @param {string} req.params.fileUri - db uri of the file whose content is to be sent */
export async function singleFileReqHandler(req: Request, res: Response) {
	const {fileStream, status, msg, aesDecipher} = await getFileStream(req.params.fileUri, req.session.userId as string)
	if (!fileStream){
		res.status(status).send(msg);
		console.log(msg)
		return;
	}

	if (fileStream && aesDecipher)
		fileStream.pipe(aesDecipher).pipe(res) // stream the file to the http response as it is being decrypted 
	else 
		res.status(500).send("Something went wrong but it's not your fault")
}

function generateFolderMetaData(req: Request): Folder|null {
	if (!req.body.name || !req.body.parentFolderUri) {
		return null
	}
	return {
		name: req.body.name,
		parentFolderUri: req.body.parentFolderUri,
		userId: new ObjectId(req.session.userId as string),
		uri: nanoid(),
		type: "folder",
		timeCreated: (new Date()).toISOString(),
		lastModified: (new Date()).toISOString(),
		isRoot: false,
	}

}

/** Handles a request to create a logical folder inside the db
 * @param {string} req.body.parentFolderUri - db uri of the folder it will be created inside */
export async function createFolderReqHandler(req: Request, res: Response) {
	const parentFolder = await dbClient.getFolderDetails(req.body.parentFolderUri, req.session.userId as string)
	if (!parentFolder){
		res.status(400).json({msg: "Invalid request!"});
		return;
	}
	const payLoad = generateFolderMetaData(req);

	if (payLoad){
		const result = await dbClient.createNewFolderEntry(payLoad);
		if (!result.acknowledged) {
			res.status(500).json({errorMsg: "Internal Server Error", msg: null, data: null})
		}else {
			res.status(201).json({msg: "Folder Created successfully", data: result.uri, errrorMsg: null})
		}
	}else res.status(400).json({errorMsg: "Bad Request!", msg: null, data: null})
}

/** Handles a request to get an authenticated user's request handler */
export async function userUploadHistoryReqHandler(req: Request, res: Response) {
	const userUploadHistory = await dbClient.getUserUploadHistory(req.session.userId as string)
	if (!userUploadHistory) {
		res.status(500).json({errorMsg: "Internal db error"})
	}else {
		res.status(200).json({data: userUploadHistory})
	}
}

// todo, revoke all shared file access
export async function fileDelReqHandler(req: Request, res: Response) {
	const results = await dbClient.deleteFile(req.session.userId as string, req.params.fileUri)
	if (results.acknowledged) {
		res.status(200).json({msg: "File deleted successfully"})
	}else {
		res.status(404).json({msg: "Target resource was not found"}) // or should it be 403?
	}
}

/** Handles a request to add a file to a user's favourites */
export async function newFavFileReqHandler(req: Request, res: Response) {
	const result = await dbClient.addFileToFavourites(req.session.userId as string, req.params.fileUri)
	if (result.acknowledged){
		res.status(200).json({msg: "File added to favourites", errorMsg: null, data: null})
	}else {
		res.status(404).json({errorMsg: "Target resource was not found", msg: null, data: null}) // or should it be 403?
	}	
}

/** Handles a request to change the name attribute in a file's metadata stored in the db
 * @param {string} req.body.newName - name that the old name will be changed to
 * @param {string} req.body.fileUri - uri of the file to be changed */
export async function fileRenameHandler(req: Request, res: Response) { // can it rename folders too?
	if (!req.body.newName || !req.body.fileUri){
		res.status(400).json({msg: "Invalid request body"})
		return;
	}

	const results = await dbClient.renameFile(req.session.userId as string, req.body.fileUri, req.body.newName)
	if (results.acknowledged) {
		res.status(200).json({msg: "File Renamed successfully"})
	}else {
		res.status(404).json({msg: "Target resource was not found"}) // or should it be 403?
	}
}

/** Handles a request to share files/folders with other users.
 * The users the files/folders are shared with are granted limited access to the files/folder 
 * @param {string[]} req.body.grantees - usernames of the users to share the file/folders with
 * @param {resourcesData[]} req.body.resourcesData {uri: string, type: string, excludedEntriesUris: string[]} - data of the files/folders to be shared */
export async function accessGrantReqHandler(req: Request, res: Response) {
	if (!req.body.grantees || !req.body.resourcesData) {
		res.status(400).json({errorMsg: "Invalid request body"})
	}else {
		const queryResult = await dbClient.grantResourcesPermission(req.body, req.session.userId as string)
		if (queryResult.status === 200)
			res.status(queryResult.status).json({errorMsg: queryResult.msg, msg: null, data: null})
		res.status(queryResult.status).json({msg: queryResult.msg})
	}	
}

/** Handles the request to revoke a user's access to the file/folder shared with them 
 * @param {string[]} req.body.shareIds -  ids of the file's to be revoked */
export async function revokeSharedAccessReqHandler(req: Request, res: Response) {
	if (!req.body.shareIds) {
		res.status(400).json({msg: null, errorMsg: "Bad Request!", data: null})
	}else {
		const querySuccessful = await dbClient.deleteSharedFileEntry(req.body.shareIds, req.session.userId as string)
		if (querySuccessful){
			res.status(200).json({msg: "Files access revoked", data: null, errorMsg: null})
		}else {
			res.status(500).json({errrorMsg: "Something went wrong", data: null, errorMsg: null})
		}
	}
}

/** Handles a request from an authenticated user for a resource's (file|folder) content that was shared with him/her
 * @param {string} req.params.shareId - unique id associated with the shared resoource
 * @param {string} req.params.fileUri - uri of the shared resoource
 * @param {string} req.query.type - can either have values 'file' or 'folder'
 * */
export async function sharedFileContentReqHandler(req: Request, res: Response) {
	if (!req.query.type) {
		res.status(400).json({errorMsg: "no 'type' parameter was specified!", data: null})
		return
	}

	const resource = await dbClient.getSharedResourceDetails(req.params.shareId, req.session.userId as string)
	if (!resource) {
		res.status(404).json({errorMsg: "File not found!", msg: null, data: null})
		return;
	}

	let targetContentUri;

	if (req.params.contentUri === resource.grantedResourceUri) {
		targetContentUri = resource.grantedResourceUri;
	}else {
		// gets a resource uri if it's a child of a shared folder cos sharing a folder is 
		// sharing all the folder's children by default, no matter how deeply nested
		const contentIsFolderChild = await dbClient.checkIfFileIsNestedInFolder(resource.grantedResourceUri, req.params.contentUri, req.query.type as "folder"|"file")
		if (contentIsFolderChild) {
			targetContentUri = contentIsFolderChild
		}else {
			res.status(404).json({errorMsg: "File not found!", msg: null, data: null});
			return
		}
	}
	
	if (resource.excludedEntriesUris.includes(targetContentUri)) {
		res.status(403).json({errorMsg: "You don't have access to this resource", msg: null, data: null})
		return;
	}else if (req.query.type === "file"){
		const {fileStream, status, msg, aesDecipher} = await getFileStream(targetContentUri, resource.grantorId as string)
		if (!fileStream)
			res.status(status).json({errorMsg: msg, msg: null, data:  null});

		if (fileStream && aesDecipher)
			fileStream.pipe(aesDecipher).pipe(res) // stream the file to the http response as it is being decrypted 
		else 
			res.status(500).json({errorMsg: "Something went wrong but it's not your fault", msg: null, data:  null})
	}else if (req.query.type === "folder") {
		// get the metadata of all shared files or folder nested inside the shared folder
		const responseData = await dbClient.getSharedFolderData(targetContentUri, resource.excludedEntriesUris)
		res.status(200).json({data: responseData, msg: null, errorMsg: null})
	}
}

/** Gets the meta data of a shared file/folder using the shared resource uri */
export async function sharedFileMetaDataReqdHandler(req: Request, res: Response) {
	const resource = await dbClient.getSharedResourceDetails(req.params.shareId, req.session.userId as string)

	if (!resource) {
		res.status(404).json({errorMsg: "File not found!", msg: null, data: null})
		return;
	}

	if (resource.resourceType === "file") {
		const fileDetails = await dbClient.getFileDetails(resource.grantedResourceUri, resource.grantorId as string)
		if (fileDetails)
			res.status(200).json({data: [fileDetails],  msg: null, errorMsg: null})
		else
			res.status(500).json({errorMsg: "Something went wrong", data: null, msg: null})
	}else {
		const folderDetails = await dbClient.getFolderDetails(resource.grantedResourceUri, resource.grantorId as string)
		if (folderDetails)
			res.status(200).json({data: [folderDetails],  msg: null, errorMsg: null})
		else
			res.status(500).json({errorMsg: "Something went wrong", data: null, msg: null})

	}
}

/** Handles a request for all files/folders shared by a user */
export async function UserSharedFilesDetailsReqHandler(req: Request, res: Response) {
	const sharedFileLinks = await dbClient.getUserSharedFiles(req.session.userId as string)
	if (sharedFileLinks) {
		res.status(200).json({data: sharedFileLinks})
	}else {
		res.status(500).json({msg: "Internal Server Error"})
	}
}

/** Handles a request to move files/folders from one logical folder into another 
 * @param {string[]} req.body.movedContentsUris - The uris of the files/folders to be moved */
export async function moveFilesReqHandler(req: Request, res: Response) {
	if (!req.body.movedContentsUris || req.body.movedContentsUris.length === 0) {
		res.status(400).json({errorMsg: "No files to copy", data: null, })
		return
	}
	const destinationFolder = await dbClient.getFolderDetails(req.body.targetFolderUri, req.session.userId as string)
	if (!destinationFolder) {
		res.status(400).json({errorMsg: "Bad Request! New Parent Folder doesn't exist", data: null, msg: null})
		return
	}

	// validate the moved files/folders uris and get the details of the content to copy 
	const contentToMoveDetails = await dbClient.getContentDataToCopy(req.body.movedContentsUris, req.session.userId as string);

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
	const querySuccessful = await dbClient.updateMovedFiles(([] as (FileData|Folder)[]).concat(folders, files), destinationFolder)

	if (querySuccessful) {
		res.status(200).json({msg: "Files moved successfully!", data: null, errorMsg: null})
	}else {
		res.status(500).json({errorMsg: "Internal Server Error!", data: null, msg: null})
	}
}


function copyFilesOnDisk(files: FileData[], newlyCopiedFiles: FileData[]) {
	for (let i=0; i<files.length; i++) {
		fs.copyFileSync( // this would block!! Do something about it
			`../uploads/${files[i].pathName}`, 
			`../uploads/${newlyCopiedFiles[i].pathName}`
		)
	}
}

/** Handles a request to copy a file shared with the user
 * The user becomes the owner of the copied  */
export async function copySharedFilesReqHandler(req: Request, res: Response) {
	if (!req.body.copiedFilesUris || req.body.copiedFilesUris.length === 0) {
		res.status(400).json({errorMsg: "No files to copy", data: null, })
		return
	}
	const destinationFolder = await dbClient.getFolderDetails(req.body.targetFolderUri, req.session.userId as string)
	const queryResponse = await dbClient.getSharedFilesGrantorId(req.body.copiedFilesUris, req.session.userId as string)
	// const resource = await dbClient.getSharedResourceDetails(req.params.shareId, req.session.userId as string)

	if (queryResponse.status !== 200) {
		res.status(queryResponse.status).json(queryResponse.payload)
		return;
	}

	const grantorId = queryResponse.payload

	if (!destinationFolder) {
		res.status(400).json({errorMsg: "Bad Request! New Parent Folder doesn't exist", data: null, })
		return
	}
	const contentToCopyDetails = await dbClient.getContentDataToCopy(req.body.copiedFilesUris, grantorId as string);
	let folders: Folder[], files: FileData[];
	if (contentToCopyDetails.msg === "valid uris"){
		folders = contentToCopyDetails.folders as Folder[]
		files = contentToCopyDetails.files as FileData[]
	}else if (contentToCopyDetails.msg === "invalid uris") {
		res.status(400).json({msg: null, errorMsg: "Some of the files to be copied do not exist", data: contentToCopyDetails.invalidUris})
		return
	}else {
		res.status(500).json({msg: null, errorMsg: "Internal Server Error", data: null})
		return
	}

	let copiedFilesData: FileData[] = files.map((file) => {
		return {...file, _id: new ObjectId(), userId: new ObjectId(req.session.userId as string), 
		pathName: file.name + nanoid() + ".UFILE", uri: nanoid(), parentFolderUri: req.body.targetFolderUri}
	})
	let copiedFolders: Folder[] = folders.map((folder) => {
		return {...folder, _id: new ObjectId(), userId: new ObjectId(req.session.userId as string), 
		pathName: folder.name + nanoid() + ".UFILE", uri: nanoid(), parentFolderUri: req.body.targetFolderUri}  // u need to remove the file extension first if any
	})
	const user = await dbClient.getUserWithId(req.session.userId as string) as User
	const querySuccessful = await dbClient.insertCopiedResources(copiedFilesData, copiedFolders, user)
	if (querySuccessful) {
		if (files.length > 0) {
			// todo: probably put this in a try-catch block and reverse changes incase something goes wrong
			copyFilesOnDisk(files, copiedFilesData)
		}
		res.status(200).json({msg: "successful!", errorMsg: null, data: null})
	}else {
		res.status(500).json({msg: "", errorMsg: "Internal Server Error. Not your fault though", data: null})
	}
}

/** Handles a request to copy files/folders from one logical folder in the database to another 
 * @param {string[]} req.body.copiedContentsUris - The uris of the files/folders to be copied
 * @param {string} req.body.targetFolderUri - The uri of the folder files are to be copied into */
export async function copyFilesReqHandler(req: Request, res: Response) {
	if (!req.body.copiedContentsUris || req.body.copiedContentsUris.length === 0) {
		res.status(400).json({errorMsg: "No files to copy", data: null, })
		return
	}
	const destinationFolder = await dbClient.getFolderDetails(req.body.targetFolderUri, req.session.userId as string)
	if (!destinationFolder) {
		res.status(400).json({errorMsg: "Bad Request! New Parent Folder doesn't exist", data: null, })
		return
	}
	// validate the copied files/folders uris and get the details of the content to copy 
	const contentToCopyDetails = await dbClient.getContentDataToCopy(req.body.copiedContentsUris, req.session.userId as string);

	let folders: Folder[], files: FileData[];
	if (contentToCopyDetails.msg === "valid uris"){
		folders = contentToCopyDetails.folders as Folder[]
		files = contentToCopyDetails.files as FileData[]
	}else if (contentToCopyDetails.msg === "invalid uris") {
		res.status(400).json({msg: null, errorMsg: "Some of the files to be copied do not exist", data: contentToCopyDetails.invalidUris})
		return
	}else { // server error
		res.status(500).json({msg: null, errorMsg: "Internal Server Error", data: null})
		return
	}

	// generate the new copied files details that will be stored in the db
	let copiedFilesData: FileData[] = files.map((file) => {
		return {...file, _id: new ObjectId(), pathName: file.name + nanoid() + ".UFILE", uri: nanoid(), parentFolderUri: req.body.targetFolderUri}
	})
	// generate the new copied folders details that will be stored in the db
	let copiedFolders: Folder[] = folders.map((folder) => {
		return {...folder, _id: new ObjectId(), pathName: folder.name + nanoid() + ".UFILE", uri: nanoid(), parentFolderUri: req.body.targetFolderUri}
	})
	const user = await dbClient.getUserWithId(req.session.userId as string) as User // what if the user logs in somewhere else and deletes her account b4 this hits the db
	const querySuccessful = await dbClient.insertCopiedResources(copiedFilesData, copiedFolders, user) // store the new copied files details in the db 

	if (querySuccessful) {
		if (files.length > 0) {
			// todo: probably put this in a try-catch block and reverse changes incase something goes wrong
			copyFilesOnDisk(files, copiedFilesData) // only files are copied on disk because folders are more or less metadata
		}
		res.status(200).json({msg: "successful!", errorMsg: null, data: null})
	}else {
		res.status(500).json({msg: "", errorMsg: "Internal Server Error. Not your fault though", data: null})
	}
}

/** Handles a request to search for a file with text similar to the file name 
 * @param {string} req.query.search_query - text that's similar to the file to search for */
export async function searchFilesReqHandler(req: Request, res: Response) {
	if (!req.query.search_query)
		res.status(400).json({data: null, errorMsg: "Bad request!", msg: null})
	const {msg, data, errorMsg, status} = await dbClient.searchForFile(req.query.search_query as string)
	res.status(status).json({msg, data, errorMsg})
}

/** Handles a request to download a file most likely from the user's browser
 * @param {string} req.params.fileUri - database uri of the file to download */
export async function fileDownloadReqHandler(req: Request, res: Response) {
	const fileDetails = await dbClient.getFileDetails(req.params.fileUri,  req.session.userId as string);

	if (!fileDetails){
		return res.status(404).json({msg: null,  errorMsg: "File not found", data: null});
	}

	if (!fs.existsSync(`../uploads/${fileDetails.pathName}`)) {
		return res.status(404).json({msg: null,  errorMsg: "File not found", data: null});
	}

	const user = await dbClient.getUserWithId(req.session.userId as string) as User;
	const key = scryptSync(user.password, 'notRandomSalt', 24) 
	const aesDecipher = createDecipheriv("aes-192-cbc", key, Buffer.from([1, 5, 6, 2, 9, 11, 45, 3, 7, 89, 23, 30, 17, 49, 53, 10]))
	const fileStream = fs.createReadStream(`../uploads/${fileDetails.pathName}`)

	if (fileStream && aesDecipher) {
		res.attachment(fileDetails.name)
		res.set("Content-Length", fileDetails.size.toString())
		res.type(fileDetails.type)
		fileStream.pipe(aesDecipher).pipe(res) // the content is streamed to work around the delays of encryption
	}else 
		res.status(500).json({errorMsg: "Something went wrong but it's not your fault", msg: null, data:  null})
}

export async function htmlFileReqHandler(_req: Request, res: Response) {
	res.sendFile("index.html", {root: "../static"}, function(err) {
		if (err) {
			// console.log(err)
			console.log("\nAn Error occured while trying to send index.html\n")
		}else {
			console.log("Sent:", "index.html")
		}
	})
}

/** Handles a request to end the user's session i.e. log the user out*/
export async function sessionEndReqHandler(req: Request, res: Response) {
	req.session.destroy((err) => {
		if (err) {
			console.log(err) // indicate that the error occured while trying to delete user session
			res.status(500).json({msg: null, errorMsg: "Something went wrong! Not your fault tho!", data: null})
		}else
			res.status(200).json({msg: "Logout successful!", errormsg: null, data: null})
	})
}

/** Handles a request to delete the currently logged in user's acocunt */
export async function deleteUserReqHandler(req: Request, res: Response) {
	let {status, errorMsg, msg, data} = await dbClient.deleteUserData(req.session.userId as string);
	if (status === 200) {
		req.session.destroy((err) => {
			if (err) {
				console.log(err) // todo: indicate that the error occured while trying to delete user session
				status = 500; 
				errorMsg = "Something went wrong! Not your fault tho!"; 
				msg = null
				data =  null
			}
		})
	}
	res.status(status).json({data, errorMsg, msg})
}
