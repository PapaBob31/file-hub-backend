import { type Request, type Response } from "express";
import fs from "fs";
// import path from "node:path";
// import { generateUrlSlug } from "./utilities"
import dbClient, { type FileData, type User, type Folder } from "../db/client.js"
// import escapeHtml from "escape-html"
import { ObjectId } from "mongodb"
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "node:crypto"
import { nanoid } from "nanoid"
import { pipeline } from "node:stream"
import Tokens from "csrf"

/*
todo: Standardize the format of all your responses, Change every hardcoded variable to environment variable
password encryption, better uri generations?, auth middleware?, read up on time in js and mongodb
Query only the required fields. Stop querying all fields, encrypt and decrypt all userIds as needed
Add serious logging => response type, db errors, server errors e.t.c.
Add types to evrything!
enforce password patterns on the frontend
Install enviroment variables
use it to store details and distinguish between prod and dev mode
implement all encryption and decryption such as pasword hashing, csrf tokens, sessionId e.t.c
prevent usage of stolen auth cookies
escape html from any form of user input that will be displayed later; usernames are case insensitive
handle bogus http requests, i.e 404 everyhing that ought to have a payload but doesn't ans much more
filepath issues such as file path max name length; max file size, path traversing exploits, e.t.c
what happens if I set invalid response code i.e 4000 instead of 400

LOGOUT

How does exppress work internally? Should I use threads?

send a file request and abort while the page reloads to see how express reacts

test endpoints that have parameters without the parameters preferrably using postman

check if it's safe to perform side effects with GET requests

BULL?
*/

/* file sharing implementation
1. make a file or folder publicly accessible to anybody
2. every user should have a unique shareId

*/


// todo: implement proper pathname and make sure we can't override existing file
function generateUniqueFileName(request: Request) {
	return request.headers["x-local-name"] + nanoid() + ".UFILE";
}

function generateMetaData(request: Request, parentFolder: Folder):FileData {
	return  {
		name: request.headers["x-local-name"] as string,
		pathName: generateUniqueFileName(request), // escape the names or something incase of path traversing file names if that's even a thing
		type: request.headers["content-type"] as string,
		size: parseInt(request.headers["content-length"] as string),
		hash: request.headers["x-file-hash"] as string,
		userId: new ObjectId(request.session.userId),
		sizeUploaded: 0,
		uri: nanoid(),
		timeUploaded: (new Date()).toISOString(),
		lastModified: (new Date()).toISOString(),
		parentFolderUri: request.params.folderUri,
		inHistory: true,
		deleted: false,
		favourite: false,
		iv: ""
	}
}

function writeToFile(filename: string, data: any, mode: string) {
	const fd = fs.openSync(filename, mode)
	fs.writeSync(fd, data)
	fs.closeSync(fd)
}


export async function loginHandler(req: Request, res: Response) {
	if (!req.body || !req.body.password || !req.body.email) {
		return res.status(401).json({error: "Invalid login details!"});
	}
	const user = await dbClient.loginUser(req.body);
	if (user) {
		const tokens = new Tokens()
		req.session.userId = user._id
		req.session.csrfSecret = tokens.secretSync()
		return res.status(200).json({msg: "success", loggedInUserName: user.username})
	}else return res.status(401).json({error: "Invalid login details!"});
}

export async function signupHandler(req: Request, res: Response) {
	if (!req.body || !req.body.password || req.body.password !== req.body.passwordExtraCheck) {
		return res.status(400).json({msg: "Invalid request body"});
	}
	const status = await dbClient.createNewUser(req.body);
	console.log(status);
	if (status === "success") {
		await loginHandler(req, res)
	}else return res.status(500).json({msg: "Internal Server Error"});
}

function headersAreValid(request: Request) {
	if (!request.headers["x-file-hash"] || !request.headers["x-local-name"]) {
		return false
	}
	return true;
}

// todo: implement regular clearing of uncompleted uploads after a long time 
export async function fileUploadHandler(req: Request, res: Response) {
	const uploadTracker = {fileId: "", sizeUploaded: 0};
	let metaData = null;
	let uploadedData: FileData|null = null;

	if (!headersAreValid(req)) {
		res.status(400).json({msg: "Invalid headers!"})
		return;
	}


	const user = await dbClient.getUserWithId(req.session.userId)
	if (req.headers["x-resume-upload"] === "true") {
		uploadedData = await dbClient.getFileByHash(req.session.userId, req.headers["x-file-hash"] as string, req.headers["x-local-name"] as string)
		if (!uploadedData) {
			res.status(400).json({msg: "File to be updated doesn't exist!"})
			req.destroy()
			return 
		}
	}else {
		const parentFolder = await dbClient.getFolderDetails(req.params.folderUri, req.session.userId)
		if (!parentFolder){
			res.status(400).json({msg: "Invalid request!"});
			return;
		}
		metaData = generateMetaData(req, parentFolder)
		uploadedData = await dbClient.storeFileDetails(metaData);
	}

	if (!uploadedData || !user) {
		res.status(400).json({msg: "Invalid request!"});
		return;
	}
	uploadTracker.fileId = uploadedData._id as string;

	const key = scryptSync(user.password, 'notRandomSalt', 24) 
	const aesCipher = createCipheriv("aes-192-cbc", key, Buffer.from([1, 5, 6, 2, 9, 11, 45, 3, 7, 89, 23, 30, 17, 49, 53, 10]))
	const aesDecipher = createDecipheriv("aes-192-cbc", key, Buffer.from([1, 5, 6, 2, 9, 11, 45, 3, 7, 89, 23, 30, 17, 49, 53, 10]))

	if (uploadedData.sizeUploaded !== 0) {
		if (!fs.existsSync("../uploads/"+uploadedData.pathName)) { // this should be impossible; log that the file for the record wasn't found? delete the record?
			res.status(400).json({msg: "Invalid request!"});
			return
		}
		const fileStream = fs.createReadStream("../uploads/"+uploadedData.pathName) // if not fileStream??
		pipeline(fileStream, aesDecipher, aesCipher, (err) => {
			if (!err) {
				writeToFile("../uploads/"+uploadedData!.pathName, "", 'w'); // clear the file
				req.on('data', (chunk)=>{
					writeToFile("../uploads/"+uploadedData!.pathName, aesCipher.update(chunk), 'a');
					uploadTracker.sizeUploaded += chunk.length;
				})
			}else {
				res.status(500).json({msg: "OMO"});
				return;
			}
		})

	}else {
		writeToFile("../uploads/"+uploadedData!.pathName, "", 'w'); // clear the file
		req.on('data', (chunk)=>{
			writeToFile("../uploads/"+uploadedData!.pathName, aesCipher.update(chunk), 'a');
			uploadTracker.sizeUploaded += chunk.length;
		})
	}

	req.on('close', async () => { // can 'close' be emitted before the 'data' event is attached due to decrypting data when resuming file upload
		const lengthOfRecvdData = uploadTracker.sizeUploaded;
		uploadTracker.sizeUploaded += uploadedData!.sizeUploaded // new uploaded length

		if (req.complete) {
			console.log("CLIENT DIDN'T ABORT")
			const result = await dbClient.addUploadedFileSize(uploadTracker.fileId, uploadTracker.sizeUploaded, req.session.userId, lengthOfRecvdData)
	
			if (result.acknowledged) {
				uploadedData!.sizeUploaded = uploadTracker.sizeUploaded;
				res.status(200).send(JSON.stringify(uploadedData))
			}else
				res.status(500).send("OMO")
		}else {
			console.log("CLIENT ABORTED")
			const result = await dbClient.addUploadedFileSize(uploadTracker.fileId, uploadTracker.sizeUploaded, req.session.userId, lengthOfRecvdData)
			if (!result.acknowledged) {
				// do something .... but what?
			}
		}
		writeToFile("../uploads/"+uploadedData!.pathName, aesCipher.final(), 'a');

		/*const filePathName = (uploadedData as FileData).pathName
		if (!fs.existsSync("../uploads/"+filePathName)) {
			writeToFile("../uploads/"+filePathName, aesCipher.final(), 'w');
		}else writeToFile("../uploads/"+filePathName, aesCipher.final(), 'a');*/
	})

	/*req.on('end', async ()=>{
		console.log("CLIENT DIDN'T ABORT")
		const lengthOfRecvdData = uploadTracker.sizeUploaded;
		uploadTracker.sizeUploaded += uploadedData!.sizeUploaded // new uploaded length
		const result = await dbClient.addUploadedFileSize(uploadTracker.fileId, uploadTracker.sizeUploaded, req.session.userId, lengthOfRecvdData)
		if (!result.acknowledged) {
			// do something .... but what?
		}
		if (req.complete) {
			uploadedData!.sizeUploaded = uploadTracker.sizeUploaded;
			res.status(200).send(JSON.stringify(uploadedData))
		}
	})*/
}

export async function uploadDelFromHistoryHandler(req: Request, res: Response) {
	const results = await dbClient.deleteFromHistory(req.params.fileUri, req.session.userId)
	if (results.acknowledged)
		res.status(200).json({msg: "File has been removed from upload history"})
	else
		res.status(400).json({msg: "Invalid request!"}) // todo: add proper status code instead of generalizing everything as a 400
}

export async function fileReqByHashHandler(req: Request, res: Response) {
	if (!req.headers["x-local-name"]) {
		res.status(400).json({msg: "BAD REQUEST!"})
		return;
	}
	const responseData = await dbClient.getFileByHash(
		req.session.userId, decodeURIComponent(req.params.fileHash), req.headers["x-local-name"] as string
		)
	if (!responseData){
		res.status(400).json({msg: "BAD REQUEST!"})
		return 
	}
	res.status(200).json(responseData)
}

export async function filesRequestHandler(req: Request, res: Response) {
	const responseData = await dbClient.getFilesData(req.session.userId, req.params.folderUri)
	res.status(200).json({data: responseData.data})
}

export async function authHandler(req: Request, res: Response) { // yep. turn it into a middleware
	const user = await dbClient.getUserWithId(req.session.userId)
	if (user) {
		const tokens = new Tokens()
		res.status(200).json({...user, csrfToken: tokens.create(req.session.csrfSecret)})
	}else {
		res.status(401).json("Invalid Request! Unauthenticated User!")
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
	if (!fs.existsSync(`C:\\Users\\HP\\Desktop\\stuff\\web dev\\fylo-backend\\src\\uploads\\${fileDetails.pathName}`)) {
		return {status: 404, msg: "File not found", fileStream: null, aesDecipher: null};
	}
	const user = await dbClient.getUserWithId(userId) as User;
	const key = scryptSync(user.password, 'notRandomSalt', 24) 
	const aesDecipher = createDecipheriv("aes-192-cbc", key, Buffer.from([1, 5, 6, 2, 9, 11, 45, 3, 7, 89, 23, 30, 17, 49, 53, 10]))
	// what if i doesn't return a file stream?
	const fileStream = fs.createReadStream(`C:\\Users\\HP\\Desktop\\stuff\\web dev\\fylo-backend\\src\\uploads\\${fileDetails.pathName}`)
	return {status: null, msg: null, fileStream, aesDecipher};
}

export async function singleFileReqHandler(req: Request, res: Response) {
	const {fileStream, status, msg, aesDecipher} = await getFileStream(req.params.fileUri, req.session.userId)
	if (!fileStream)
		res.status(status).send(msg);

	if (fileStream && aesDecipher)
		fileStream.pipe(aesDecipher).pipe(res)
	else 
		res.status(500).send("Something went wrong but it's not your fault")
	/*res.status(200).sendFile(fileDetails.pathName, {root: `C:\\Users\\HP\\Desktop\\stuff\\web dev\\fylo-backend\\src\\uploads`}, function(err) {
		if (err) {
			// console.log(err)
			console.log("\nAn Error occured while trying to send", fileDetails.pathName, '\n')
		}else {
			console.log("Sent:", fileDetails.pathName)
		}
	})*/
}

function getFolderMetaData(req: Request, parentFolder: Folder): Folder|null {
	if (!req.body.name || !req.body.parentFolderUri) {
		return null
	}
	return {
		name: req.body.name,
		parentFolderUri: req.body.parentFolderUri,
		userId: new ObjectId(req.session.userId),
		uri: nanoid(),
		type: "folder",
		timeCreated: (new Date()).toISOString(),
		lastModified: (new Date()).toISOString(),
		isRoot: false,
	}

}

export async function createFolderReqHandler(req: Request, res: Response) {
	const parentFolder = await dbClient.getFolderDetails(req.body.parentFolderUri, req.session.userId)
	if (!parentFolder){
		res.status(400).json({msg: "Invalid request!"});
		return;
	}
	const payLoad = getFolderMetaData(req, parentFolder);

	if (payLoad){
		const result = await dbClient.createNewFolderEntry(payLoad);
		if (!result.acknowledged) {
			res.status(500).json({errorMsg: "Internal Server Error"})
		}else {
			res.status(201).json({msg: "Folder Created successfully", uri: result.uri})
		}
	}else res.status(400).json({errorMsg: "Bad Request!"})
}


export async function userUploadHistoryReqHandler(req: Request, res: Response) {
	const userUploadHistory = await dbClient.getUserUploadHistory(req.session.userId)
	if (!userUploadHistory) {
		res.status(500).json({errorMsg: "Internal db error"})
	}else {
		res.status(200).json({data: userUploadHistory})
	}

}

export async function fileDelReqHandler(req: Request, res: Response) {
	const results = await dbClient.deleteFile(req.session.userId, req.params.fileUri)
	if (results.acknowledged) {
		res.status(200).json({msg: "File deleted successfully"})
	}else {
		res.status(404).json({msg: "Target resource was not found"}) // or should it be 403?
	}
}

export async function newFavFileReqHandler(req: Request, res: Response) {
	const result = await dbClient.addFileToFavourites(req.session.userId, req.params.ffileUri)
	if (result.acknowledged){
		res.status(200).json({msg: "File added to favourites"})
	}else {
		res.status(404).json({msg: "Target resource was not found"}) // or should it be 403?
	}
	
}

export async function fileRenameHandler(req: Request, res: Response) {
	if (!req.body.newName){
		res.status(400).json({msg: "Invalid request body"})
		return;
	}

	const results = await dbClient.renameFile(req.session.userId, req.params.fileUri, req.body.newName)
	if (results.acknowledged) {
		res.status(200).json({msg: "File Renamed successfully"})
	}else {
		res.status(404).json({msg: "Target resource was not found"}) // or should it be 403?
	}
}

export async function accessGrantReqHandler(req: Request, res: Response) {
	const { grantees, resourcesData } = req.body
	if (!grantees || !resourcesData) {
		res.status(400).json({errorMsg: "Invalid request body"})
	}else {
		const data = {grantees, resourcesData}
		const queryResult = await dbClient.grantResourcesPermission(data, req.session.userId)
		if (queryResult.status === 200)
			res.status(queryResult.status).json({errorMsg: queryResult.msg, msg: null, data: null})
		res.status(queryResult.status).json({msg: queryResult.msg})
	}	
}

export async function revokeSharedAccessReqHandler(req: Request, res: Response) {
	if (!req.body.revokedFilesUris || req.body.grantee) {
		res.status(400).json({msg: null, errorMsg: "Bad Request!", data: null})
	}else {
		const querySuccessful = await dbClient.deleteSharedFileEntry(req.body.revokedFilesUris, req.body.grantee, req.session.userId)
		if (querySuccessful){
			res.status(200).json({msg: "Files access revoked", data: null, errorMsg: null})
		}else {
			res.status(500).json({errrorMsg: "Something went wrong", data: null, errorMsg: null})
		}
	}
}

export async function sharedFileContentReqHandler(req: Request, res: Response) {
	if (!req.query.type) {
		res.status(400).json({errorMsg: "no 'type' parameter was specified!", data: null})
		return
	}

	const resource = await dbClient.getSharedResourceDetails(req.params.shareId, req.session.userId)
	if (!resource) {
		res.status(404).json({errorMsg: "File not found!", msg: null, data: null})
		return;
	}

	let targetContentUri;

	if (req.params.contentUri === resource.grantedResourceUri) {
		targetContentUri = resource.grantedResourceUri;
	}else {
		const contentIsFolderChild = await dbClient.checkIfFileIsNestedInFolder(resource.grantedResourceUri, req.params.contentUri, req.query.type)
		if (contentIsFolderChild) {
			targetContentUri = contentIsFolderChild
		}else {
			res.status(404).json({errorMsg: "File not found!", msg: null, data: null});
			return
		}
	}
	
	if (resource.excludedEntriesUris.includes(targetContentUri)) {
		res.status(403).json({msg: "You don't have access to this resource"})
		return;
	}else if (req.query.type === "file"){
		const {fileStream, status, msg, aesDecipher} = await getFileStream(targetContentUri, resource.grantorId as string)
		if (!fileStream)
			res.status(status).json({errorMsg: msg, msg: null, data:  null});

		if (fileStream && aesDecipher)
			fileStream.pipe(aesDecipher).pipe(res)
		else 
			res.status(500).json({errorMsg: "Something went wrong but it's not your fault", msg: null, data:  null})
	}else if (req.query.type === "folder") {
		const responseData = await dbClient.getSharedFolderData(targetContentUri, resource.excludedEntriesUris)
		res.status(200).json({data: responseData})
	}
}

export async function sharedFileMetaDataReqdHandler(req: Request, res: Response) {  // todo: readup on these express query parameters
	const resource = await dbClient.getSharedResourceDetails(req.params.shareId, req.session.userId)

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

export async function UserSharedFilesDetailsReqHandler(req: Request, res: Response) {
	const sharedFileLinks = await dbClient.getUserSharedFiles(req.session.userId)
	if (sharedFileLinks) {
		res.status(200).json({data: sharedFileLinks})
	}else {
		res.status(500).json({msg: "Internal Server Error"})
	}
}

export async function moveFilesReqHandler(req: Request, res: Response) {
	if (!req.body.movedFilesUris || req.body.movedFilesUris.length === 0) {
		res.status(400).json({errorMsg: "No files to copy", data: null, })
		return
	}
	const destinationFolder = await dbClient.getFolderDetails(req.body.targetFolderUri, req.session.userId)
	if (!destinationFolder) {
		res.status(400).json({errorMsg: "Bad Request! New Parent Folder doesn't exist", data: null, })
		return
	}
	const contentToMoveDetails = await dbClient.getContentDataToCopy(req.body.movedFilesUris, req.session.userId);

	let folders: Folder[], files: FileData[];
	if (contentToMoveDetails.msg === "valid uris"){
		folders = contentToMoveDetails.folders as Folder[]
		files = contentToMoveDetails.files as FileData[]
	}else if (contentToMoveDetails.msg === "invalid uris") {
		res.status(400).json({msg: null, errorMsg: "Some of the files to be copied do not exist", data: contentToMoveDetails.invalidUris})
		return
	}else {
		res.status(500).json({msg: null, errorMsg: "Internal Server Error", data: null})
		return
	}
	const querySuccessful = await dbClient.updateMovedFiles(folders.concat(files), destinationFolder)

	if (querySuccessful) {
		res.status(200).json({msg: "Files moved successfully!", data: null, errorMsg: null})
	}else {
		res.status(500).json({errorMsg: "Internal Server Error!", data: null, msg: null})
	}
}


function copyFilesOnDisk(files: FileData[], newlyCopiedFiles: FileData[]) {
	for (let i=0; i<files.length; i++) {
		fs.copyFileSync(
			`C:\\Users\\HP\\Desktop\\stuff\\web dev\\fylo-backend\\src\\uploads\\${files[i].pathName}`, 
			`C:\\Users\\HP\\Desktop\\stuff\\web dev\\fylo-backend\\src\\uploads\\${newlyCopiedFiles[i].pathName}`
		)
	}
}

export async function copySharedFilesReqHandler(req: Request, res: Response) {
	if (!req.body.copiedFilesUris || req.body.copiedFilesUris.length === 0) {
		res.status(400).json({errorMsg: "No files to copy", data: null, })
		return
	}
	const destinationFolder = await dbClient.getFolderDetails(req.body.targetFolderUri, req.session.userId)
	const queryResponse = await dbClient.getSharedFilesToCopyGrantorId(req.body.copiedFilesUris, req.session.userId)
	// const resource = await dbClient.getSharedResourceDetails(req.params.shareId, req.session.userId)

	if (queryResponse.status !== 200) {
		res.status(queryResponse.status).json(queryResponse.payload)
		return;
	}

	const grantorId = queryResponse.payload

	if (!destinationFolder) {
		res.status(400).json({errorMsg: "Bad Request! New Parent Folder doesn't exist", data: null, })
		return
	}
	const contentToCopyDetails = await dbClient.getContentDataToCopy(req.body.copiedFilesUris, grantorId);
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
		return {...file, _id: new ObjectId(), userId: new ObjectId(req.session.userId), 
		pathName: file.name + nanoid() + ".UFILE", uri: nanoid(), parentFolderUri: req.body.targetFolderUri}
	})
	let copiedFolders: Folder[] = folders.map((folder) => {
		return {...folder, _id: new ObjectId(), userId: new ObjectId(req.session.userId), 
		pathName: folder.name + nanoid() + ".UFILE", uri: nanoid(), parentFolderUri: req.body.targetFolderUri}
	})
	const user = await dbClient.getUserWithId(req.session.userId) as User
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

export async function copyFilesReqHandler(req: Request, res: Response) {
	if (!req.body.copiedFilesUris || req.body.copiedFilesUris.length === 0) {
		res.status(400).json({errorMsg: "No files to copy", data: null, })
		return
	}
	const destinationFolder = await dbClient.getFolderDetails(req.body.targetFolderUri, req.session.userId)
	if (!destinationFolder) {
		res.status(400).json({errorMsg: "Bad Request! New Parent Folder doesn't exist", data: null, })
		return
	}
	const contentToCopyDetails = await dbClient.getContentDataToCopy(req.body.copiedFilesUris, req.session.userId);

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
		return {...file, _id: new ObjectId(), pathName: file.name + nanoid() + ".UFILE", uri: nanoid(), parentFolderUri: req.body.targetFolderUri}
	})
	let copiedFolders: Folder[] = folders.map((folder) => {
		return {...folder, _id: new ObjectId(), pathName: folder.name + nanoid() + ".UFILE", uri: nanoid(), parentFolderUri: req.body.targetFolderUri}
	})
	const user = await dbClient.getUserWithId(req.session.userId) as User
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

export async function searchFilesReqHandler(req: Request, res: Response) {
	if (!req.query.search_query)
		res.status(400).json({data: null, errorMsg: "Bad request!", msg: null})
	const {msg, data, errorMsg, status} = await dbClient.searchForFile(req.query.search_query) // make it case insensitive
	// console.log(msg, data, errorMsg, status)
	res.status(status).json({msg, data, errorMsg})
}


export async function fileDownloadReqHandler(req: Request, res: Response) {
	const fileDetails = await dbClient.getFileDetails(req.params.fileUri, req.session.userId)
	if (fileDetails) {
		res.download(`C:\\Users\\HP\\Desktop\\stuff\\web dev\\fylo-backend\\src\\uploads\\${fileDetails.pathName}`, fileDetails.name, function(err) {
			if (err) { // note: file may have been partially sent
				console.log(err)
			}
		})
	}else {
		res.status(404).json({errorMsg: "File not found!", data: null, msg: null})
	}
}
