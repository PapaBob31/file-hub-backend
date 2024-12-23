import { type Request, type Response } from "express";
import fs from "fs";
// import path from "node:path";
import { generateUrlSlug } from "./utilities"
import dbClient, { type FileData } from "../db/client"
import escapeHtml from "escape-html"
import { ObjectId } from "mongodb"
import Tokens from "csrf"

/*\
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
escape html from any form of user input that will be displayed later
handle bogus http requests, i.e 404 everyhing that ought to have a payload but doesn't ans much more
filepath issues such as file path max name length; max file size, path traversing exploits, e.t.c

LOGOUT

How does exppress work internally? Should I use threads?

send a file request and abort while the page reloads to see how express reacts

test endpoints that have parameters without the parameters preferrably using postman

check if it's safe to perform side effects with GET requests

BULL?
*/


// todo: implement the encryption algorithm
function encrypt(plainText: string) {
	let cipherText = plainText;
	return cipherText
}

// todo: implement the decryption algorithm
function decrypt(cipherText: string) {
	let plainText = cipherText;
	return plainText;
}

// todo: implement proper pathname
function generateUniqueFileName(request: Request) {
	return request.headers["x-local-name"] + ".UFILE";
}

function generateMetaData(request: Request):FileData {
	return  {
		name: request.headers["x-local-name"] as string,
		pathName: generateUniqueFileName(request), // escape the names or something incase of path traversing file names if that's even a thing
		type: request.headers["content-type"] as string,
		size: parseInt(request.headers["content-length"] as string),
		hash: request.headers["x-file-hash"] as string,
		userId: new ObjectId(request.session.userId),
		sizeUploaded: 0,
		uri: generateUrlSlug(),
		timeUploaded: (new Date()).toISOString(),
		lastModified: (new Date()).toISOString(),
		parentFolderUri: request.params.folderUri,
		inHistory: true,
		deleted: false,
		favourite: false,
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
	if (status === "success") {
		await loginHandler(req, res)
		return res.status(201).json({msg: "success"})
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
	if (req.headers["x-resume-upload"] === "true") {
		uploadedData = await dbClient.getFileByHash(req.session.userId, req.headers["x-file-hash"] as string, req.headers["x-local-name"] as string,)
		if (!uploadedData) {
			res.status(400).json({msg: "File to be updated doesn't exist!"})
			req.destroy()
			return 
		}
	}else {
		metaData = generateMetaData(req)
		uploadedData = await dbClient.storeFileDetails(metaData);
	}

	if (!uploadedData) {
		res.status(400).json({msg: "Invalid request!"});
		return;
	}
	uploadTracker.fileId = uploadedData._id as string;

	req.on('data', (chunk)=>{
		const filePathName = (uploadedData as FileData).pathName
		if (!fs.existsSync("../uploads/"+filePathName)) {
			writeToFile("../uploads/"+filePathName, chunk, 'w');
		}else writeToFile("../uploads/"+filePathName, chunk, 'a');
		uploadTracker.sizeUploaded += chunk.length;
	})

	req.on('close', async () => {
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

export async function singleFileReqHandler(req: Request, res: Response) {
	const fileDetails = await dbClient.getFileDetails(req.params.fileUri);
	if (!fileDetails){
		res.status(404).send("File not found");
		return;
	}
	if (!fileDetails.type.startsWith("image/") && !fileDetails.type.startsWith("video/")) {
		res.status(400).send("Bad Request") // serves requests for only files that can be displayed in the browse
		return;
	}
	// todo: add proper path name and try and make every type of video supported on most browsers [start from firefox not supporting mkv]
	if (!fs.existsSync(`C:\\Users\\HP\\Desktop\\stuff\\web dev\\fylo-backend\\src\\uploads\\${fileDetails.pathName}`)) {
		res.status(404).send("Image not found")
	}
	console.log(req.range(fileDetails.size))
	res.status(200).sendFile(fileDetails.pathName, {root: `C:\\Users\\HP\\Desktop\\stuff\\web dev\\fylo-backend\\src\\uploads`}, function(err) {
		if (err) {
			// console.log(err)
			console.log("\nAn Error occured while trying to send", fileDetails.pathName, '\n')
		}else {
			console.log("Sent:", fileDetails.pathName)
		}
	})
}

function getFolderMetaData(req: Request) {
	if (!req.body.name || !req.body.parentFolderUri) {
		return null
	}
	return {
		name: req.body.name,
		parentFolderUri: req.body.parentFolderUri,
		userId: new ObjectId(req.session.userId),
		uri: generateUrlSlug(),
		type: "folder",
		timeCreated: (new Date()).toISOString(),
		isRoot: false,
	}

}

export async function createFolderReqHandler(req: Request, res: Response) {
	const payLoad = getFolderMetaData(req);

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