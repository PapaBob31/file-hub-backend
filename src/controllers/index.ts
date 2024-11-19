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
		uploadedName: request.headers["x-local-name"] as string,
		pathName: generateUniqueFileName(request),
		type: request.headers["content-type"] as string,
		size: parseInt(request.headers["content-length"] as string),
		hash: request.headers["x-file-hash"] as string,
		userId: new ObjectId(decrypt(request.cookies.userId)),
		sizeUploaded: 0,
		uri: generateUrlSlug(),
		timeUploaded: getCurrTime()
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
		const responseData = await dbClient.getFilesData(decrypt(req.cookies.userId))
		res.status(200).json({username: user.username, data: responseData.data})
	}
}

export async function imgReqHandler(req: Request, res: Response) {
	const imgNames = await dbClient.getImageNames(req.params.fileUrl);
	if (!imgNames){
		res.status(404).send("Image not found");
		return;
	}
	if (!fs.existsSync(path.join(__dirname, 'uploads', imgNames.pathName))) { // look into making it static later
		res.status(404).send("Image not found")
	}
	res.status(200).sendFile(imgNames.uploadedName, {root: path.join(__dirname, 'uploads')}, function(err) {
		if (err) {
			console.log(err)
		}else {
			console.log("Sent:", imgNames.pathName)
		}
	})
}
