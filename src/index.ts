const express = require("express")
const app = express()

// TODO: uninstall all unused packages
const { MongoClient, ObjectId } = require("mongodb");
const fs = require("fs");
const path = require("node:path")
const cookieParser = require("cookie-parser")
const portNo = 7200;

const dbUri = "mongodb://127.0.0.1:27017/?directConnection=true&serverSelectionTimeoutMS=2000"; // search how to get connection string

function generateUrlSlug() {
  const alphanumeric = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ123456789'
  let urlSlug = ''
  for (let i=0; i<10; i++) {
    let randomIndex = Math.floor(Math.random() * alphanumeric.length)
    urlSlug += alphanumeric[randomIndex]  
  }
  return urlSlug
}

async function getImageNames(uri) {
	let names = {pathName: "", uploadedName: ""};
	const client = new MongoClient(dbUri);
	try {
		const dataBase = client.db("fylo");
		const fileDetails = await dataBase.collection("uploaded_files");

		const data = await fileDetails.findOne({uri});
		if (data && data.type.startsWith("image/")){
			names.uploadedName = data.uploadedName;
			names.pathName = data.pathName;
		}else names = null;
	}catch(error) {
		names = null
		console.log(error);
	}finally {
		await client.close();
	}
	return names;
}

function getCurrTime() {
	return "Not implemented yet"
}


async function storeFileDetails(newFileDoc) {
	const client = new MongoClient(dbUri);
	try {
		const database = client.db('fylo')
		const fileDetails = await database.collection("uploaded_files")
		const results = await fileDetails.insertOne(newFileDoc)
		newFileDoc._id = results.insertedId;
	} catch(error) {
		console.log(error)
	}finally {
		await client.close();
	}
	return newFileDoc
}

async function addUploadedFileSize(fileId, sizeUploaded: number) {
	const client = new MongoClient(dbUri);
	let result;
	try {
		const database = client.db('fylo')
		const fileDetails = await database.collection("uploaded_files")

		result = await fileDetails.updateOne({_id: fileId}, {$set: {sizeUploaded}})
	} catch(error) {
		console.log(error)
	}finally {
		await client.close();
	}
	return result;
}

async function getFilesData(userId) {
	let data = null;
	const client = new MongoClient(dbUri);
	try {
		const dataBase = client.db("fylo")
		const fileDetails = await dataBase.collection("uploaded_files")
		data = await fileDetails.find({userId: new ObjectId(userId)})
		data = await data.toArray(); // should I filter out the id and hash? since their usage client side can be made optional
	}catch(err) {
		data = [];
		console.log(err);
	}finally {
		await client.close()
	}
	return {data};
}


async function getFileByHash(userId: string, hash: string, uploadedName: string) {
	let fileData = null;
	const client = new MongoClient(dbUri);
	try {
		const dataBase = client.db("fylo")
		const fileDetails = await dataBase.collection("uploaded_files")
		fileData = await fileDetails.findOne({userId: new ObjectId(userId), hash, uploadedName})
	}catch(err) {
		console.log(err);
	}finally {
		await client.close();
	}
	return fileData;
}

async function createNewUser(userData) {
	const client = new MongoClient(dbUri);
	let status = ""
	try {
		const dataBase = client.db("fylo");
		const users = await dataBase.collection("users")
		const existingUser = await users.findOne({email: userData.email})
		if (existingUser)
			throw new Error("Email already in use")
		await users.insertOne({email: userData.email, password: userData.password})
		status = "success"
	}catch(err) {
		if (err.message === "Email already in use")
			status = err.message
		else status = "failure" // todo: change this generic failure message to something like 'Email already in use'
	}finally {
		await client.close()
	}
	return status;
}

async function loginUser(userData) {
	const client = new MongoClient(dbUri);
	let user = null
	try {
		const dataBase = client.db("fylo");
		const users = await dataBase.collection("users")
		user = await users.findOne({email: userData.email, password: userData.password})
		if (!user)
			throw new Error("User doesn't esist!")
	}catch(err) {
		user = null
	}finally {
		await client.close()
	}
	return user;
}


function setCorsHeader(req, res, next) {
	res.set("Access-Control-Allow-Origin", "http://localhost:5178")
	res.set("Access-Control-Allow-Headers", "Content-Type, X-local-name, X-file-hash, X-resume-upload")
	res.set("Access-Control-Max-Age", "86400");	// 24 hours, should change later
	res.set("Access-Control-Allow-Credentials", "true");
	res.set("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
	if (req.method === "OPTIONS") {
		res.status(204).send()
	}else next()
}

function logRequestDetails(req, res, next) {
	console.log(`${req.method} ${req.originalUrl}`)
	next()
}
app.use(cookieParser())
app.use(logRequestDetails, setCorsHeader)
app.use(express.json())


function writeToDisk(data) {
	data.forEach(fileData => {
		const fd = fs.openSync(`./uploads/${fileData.name}`, 'w')
		fs.writeSync(fd, fileData.file)
		fs.closeSync(fd)
	})
}

async function userIdIsValid(id: string|undefined) {
	id =  decrypt(id);
	if (!id) {
		return false
	}
	const client = new MongoClient(dbUri);
	let user = null
	try {
		const dataBase = client.db("fylo");
		const users = await dataBase.collection("users")
		user = await users.findOne({_id: new ObjectId(id)})
		await client.close()
		if (!user)
			return false
	}catch(err) {
		return false
		await client.close()
	}
	return true
}

function writeToFile(filename: string, data) {
	const fd = fs.openSync(filename, 'a')
	fs.writeSync(fd, data)
	fs.closeSync(fd)
}

// start from here
interface FileData {
  uploadedName: string;
  pathName: string;
  size: number;
  type: string;
  sizeUploaded: number;
  uri: string;
  hash: string;
  userId: string;
  timeUploaded: string;
}


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
function generateUniqueFileName(request) {
	return request.headers["x-local-name"] + ".UFILE";
}

function generateMetaData(request):FileData {
	return  {
		uploadedName: request.headers["x-local-name"],
		pathName: generateUniqueFileName(request),
		type: request.headers["content-type"],
		size: parseInt(request.headers["content-length"]),
		hash: request.headers["x-file-hash"],
		userId: new ObjectId(decrypt(request.cookies.userId)),
		sizeUploaded: 0,
		uri: generateUrlSlug(),
		timeUploaded: getCurrTime()
	}
}

// to implement
function headersAreValid(request) {
	return true;
}

// todo: implement regular clearing of uncompleted uploads after a long time
app.post("/upload-files",  async (req, res) => {
	const uploadTracker = {fileId: "", sizeUploaded: 0};
	let metaData = null;
	let uploadedData = null;

	if (!await userIdIsValid(req.cookies.userId)) {
		res.status(401).json({errorMsg: "Unauthorised! Pls login"})
	}else {
		if (!headersAreValid(req)) {
			res.status(400).json({msg: "Invalid headers!"})
			return;
		}
		if (req.headers["x-resume-upload"] === "true") {
			uploadedData = await getFileByHash(req.cookies.userId, req.headers["x-file-hash"], req.headers["x-local-name"])
			if (!uploadedData) {
				res.status(400).json({msg: "File to be updated doesn't exist!"})
				return 
			}
			uploadTracker.sizeUploaded = uploadedData.sizeUploaded
		}else {
			metaData = generateMetaData(req)
			uploadedData = await storeFileDetails(metaData);
		}

		uploadTracker.fileId = uploadedData._id;

		req.on('data', (chunk)=>{
			writeToFile("./uploads/"+uploadedData.pathName, chunk)
			uploadTracker.sizeUploaded += chunk.length;
		})

		req.on('close', async () => {
			if (!req.complete) {
				console.log("CLIENT ABORTED")
				const result = await addUploadedFileSize(uploadTracker.fileId, uploadTracker.sizeUploaded)
				if (!result.acknowledged) {
					// do something .... but what?
				}
			}
		})

		req.on('end', async ()=>{
			console.log("CLIENT DIDN'T ABORT")
			const result = await addUploadedFileSize(uploadTracker.fileId, uploadTracker.sizeUploaded)
			if (!result.acknowledged) {
				// do something .... but what?
			}
			if (req.complete) {
				res.status(200).send(JSON.stringify(uploadedData))
			}
		})
	}
})


app.get("/fileDetail/:fileHash", async (req, res) => {
	if (!await userIdIsValid(req.cookies.userId)) { // perhaps this should even be a middleware
		res.status(401).json({errorMsg: "Unauthorised! Pls login"}) // unauthorised 401 or 403?
	}else {
		const responseData = await getFileByHash(decrypt(req.cookies.userId), decodeURIComponent(req.params.fileHash), req.headers["x-local-name"])
		if (!responseData){
			res.status(400).json({msg: "BAD REQUEST!"})
			return 
		}
		res.status(200).json(responseData)
	}
})

app.get("/files-data", async (req, res) => {
	if (!await userIdIsValid(req.cookies.userId)) { // perhaps this should even be a middleware
		res.status(401).json({errorMsg: "Unauthorised! Pls login"}) // unauthorised 401 or 403?
	}else{
		const responseData = await getFilesData(decrypt(req.cookies.userId))
		res.status(200).json(responseData)
	}
})

app.get("/images/:fileUrl", async (req, res)=>{
	const imgNames = await getImageNames(req.params.fileUrl);
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
})


app.post("/signup", async (req, res) => {
	if (!req.body || !req.body.password || req.body.password !== req.body.passwordExtraCheck) {
		return res.status(400).json({msg: "Invalid request body"});
	}
	const status = await createNewUser(req.body);
	if (status === "success") {
		return res.status(201).json({msg: "success"})
	}else return res.status(500).json({msg: "Internal Server Error"});
})

app.post("/login", async (req, res) => {
	if (!req.body || !req.body.password || !req.body.email) {
		return res.status(400).json({error: "Invalid request body"});
	}
	const user = await loginUser(req.body);
	if (user) {
		// TODO: change and encrypt credentials
		res.cookie('userId', encrypt(user._id), {httpOnly: true, secure: true, sameSite: "Strict", maxAge: 6.04e8}) // 7 days
		return res.status(200).json({msg: "success", loggedInUserName: user.email})
	}else return res.status(404).json({msg: "User not found!"});
})

console.log(`listening on port: ${portNo}`)
app.listen(portNo);
