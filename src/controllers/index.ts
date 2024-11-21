import { type Request, type Response } from "express";
import fs from "fs";
import path from "node:path";
import { generateUrlSlug } from "./utilities"
import SyncedReqClient, { type FileData } from "../db/client"
import { ObjectId } from "mongodb"


const connectionStr = "mongodb://127.0.0.1:27017/?directConnection=true&serverSelectionTimeoutMS=2000"; // search how to get connection string
const dbClient = new SyncedReqClient(connectionStr)


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

function getCurrTime() {
	return "Not implemented yet"
}

function generateMetaData(request: Request):FileData {
	return  {
		name: request.headers["x-local-name"] as string,
		pathName: generateUniqueFileName(request), // escape the names or something incase of path traversing file names if that's even a thing
		type: request.headers["content-type"] as string,
		size: parseInt(request.headers["content-length"] as string),
		hash: request.headers["x-file-hash"] as string,
		userId: new ObjectId(decrypt(request.cookies.userId)),
		sizeUploaded: 0,
		uri: generateUrlSlug(),
		timeUploaded: getCurrTime(),
		parentFolderUri: request.params.folderUri,
	}
}

/*function writeToDisk(data) {
	data.forEach(fileData => {
		const fd = fs.openSync(`./uploads/${fileData.name}`, 'w')
		fs.writeSync(fd, fileData.file)
		fs.closeSync(fd)
	})
}*/

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
		// TODO: change and encrypt credentials
		res.cookie('userId', encrypt(user._id as string), {httpOnly: true, secure: true, sameSite: "strict", maxAge: 6.04e8}) // 7 days
		return res.status(200).json({msg: "success", loggedInUserName: user.email})
	}else return res.status(401).json({error: "Invalid login details!"});
}

export async function signupHandler(req: Request, res: Response) {
	if (!req.body || !req.body.password || req.body.password !== req.body.passwordExtraCheck) {
		return res.status(400).json({msg: "Invalid request body"});
	}
	const status = await dbClient.createNewUser(req.body);
	if (status === "success") {
		return res.status(201).json({msg: "success"})
	}else return res.status(500).json({msg: "Internal Server Error"});
}

// to implement
function headersAreValid(request: Request) {
	return true;
}

// todo: implement regular clearing of uncompleted uploads after a long time 
export async function fileUploadHandler(req: Request, res: Response) {
	const uploadTracker = {fileId: "", sizeUploaded: 0};
	let metaData = null;
	let uploadedData: FileData|null = null;

	if (!await dbClient.getUserWithId(req.cookies.userId)) {
		res.status(401).json({errorMsg: "Unauthorised! Pls login"})
	}else {
		if (!headersAreValid(req)) {
			res.status(400).json({msg: "Invalid headers!"})
			return;
		}
		if (req.headers["x-resume-upload"] === "true") {
			uploadedData = await dbClient.getFileByHash(req.cookies.userId, req.headers["x-file-hash"] as string, req.headers["x-local-name"] as string,)
			if (!uploadedData) {
				res.status(400).json({msg: "File to be updated doesn't exist!"})
				return 
			}
			uploadTracker.sizeUploaded = uploadedData.sizeUploaded
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
			if (!req.complete) {
				console.log("CLIENT ABORTED")
				const result = await dbClient.addUploadedFileSize(uploadTracker.fileId, uploadTracker.sizeUploaded)
				if (!result.acknowledged) {
					// do something .... but what?
				}
			}
		})

		req.on('end', async ()=>{
			console.log("CLIENT DIDN'T ABORT")
			const result = await dbClient.addUploadedFileSize(uploadTracker.fileId, uploadTracker.sizeUploaded)
			if (!result.acknowledged) {
				// do something .... but what?
			}
			if (req.complete) {
				res.status(200).send(JSON.stringify(uploadedData))
			}
		})
	}
}

export async function fileReqByHashHandler(req: Request, res: Response) {
	if (!await dbClient.getUserWithId(req.cookies.userId)) { // perhaps this should even be a middleware
		res.status(401).json({errorMsg: "Unauthorised! Pls login"}) // unauthorised 401 or 403?
	}else {
		const responseData = await dbClient.getFileByHash(decrypt(req.cookies.userId), decodeURIComponent(req.params.fileHash), req.headers["x-local-name"] as string)
		if (!responseData){
			res.status(400).json({msg: "BAD REQUEST!"})
			return 
		}
		res.status(200).json(responseData)
	}
}

export async function filesRequestHandler(req: Request, res: Response) {
	const user = await dbClient.getUserWithId(req.cookies.userId)
	if (!user) { // perhaps this should even be a middleware
		res.status(401).json({errorMsg: "Unauthorised! Pls login"}) // unauthorised 401 or 403?
	}else{
		const responseData = await dbClient.getFilesData(decrypt(req.cookies.userId), req.params.folderId)
		res.status(200).json({username: user.username, data: responseData.data})
	}
}

export async function authHandler(req: Request, res: Response) { // yep. turn it into a middleware
	const user = await dbClient.getUserWithId(req.cookies.userId)
	if (user) {
		res.status(200).json({username: user.username, id: user._id, homeFolderUri: user.homeFolderUri})
	}else {
		res.status(401).json("Invalid Request! Unauthenticated User!")
	}
}

export async function fileReqHandler(req: Request, res: Response) {
	const fileDetails = await dbClient.getFileDetails(req.params.fileUri);
	if (!fileDetails){
		res.status(404).send("File not found");
		return;
	}
	if (!fileDetails.type.startsWith("image/") && !fileDetails.type.startsWith("video/")) {
		res.status(400).send("Bad Request") // serves requests for only files that can be displayed in the browse
		return;
	}
	if (!fs.existsSync(path.join(__dirname, 'uploads', fileDetails.pathName))) {
		res.status(404).send("Image not found")
	}
	res.status(200).sendFile(fileDetails.name, {root: path.join(__dirname, 'uploads')}, function(err) {
		if (err) {
			console.log(err)
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
		userId: new ObjectId(req.cookies.userId),
		uri: generateUrlSlug(),
		type: "folder",
		timeCreated: 'not implemented yet'
	}

}

// todo: Standardize the format of all your responses
// password encryption, better uri geneartions?, auth middelware?, read up on time in js and mongodb
// Query only the required fields. Stop querying all fields
export async function createFolderReqHandler(req: Request, res: Response) {
	const user = await dbClient.getUserWithId(req.cookies.userId)
	if (!user) {
		res.status(401).json({errorMsg: "Unauthorised! Pls login"});
		return;
	}

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
