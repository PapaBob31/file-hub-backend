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

async function getImageName(uri) {
	let name = "";
	const client = new MongoClient(dbUri);
	try {
		const dataBase = client.db("fylo");
		const fileDetails = await dataBase.collection("uploaded_files");

		const data = await fileDetails.findOne({uri});
		if (data && data.type.startsWith("image/"))
			name = data.name;
	}catch(error) {
		console.log(error);
	}finally {
		await client.close();
	}
	return name;
}

// Is it possible to create a partition to store possibly incomplete uploads for faster access in mongodb?
async function storeFileDetails(data, userId: string) {
	let newDbRecords;
	const client = new MongoClient(dbUri);
	try {
		const database = client.db('fylo')
		const fileDetails = await database.collection("uploaded_files")

		newDbRecords = data.map(fileData => {return {name: fileData.name, uri: generateUrlSlug(), type: fileData.type, userId: new ObjectId(userId)}})

		await fileDetails.insertMany(newDbRecords)
	} catch(error) {
		console.log(error)
	}finally {
		await client.close();
	}
	return newDbRecords
}

async function getFilesData(userId) {
	let data = null;
	const client = new MongoClient(dbUri);
	try {
		const dataBase = client.db("fylo")
		const fileDetails = await dataBase.collection("uploaded_files")
		data = await fileDetails.find({userId: new ObjectId(userId)})
		data = await data.toArray();
	}catch(err) {
		data = [];
		console.log(err);
	}finally {
		await client.close()
	}
	return {data};
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
	res.set("Access-Control-Allow-Headers", "Content-Type, X-local-name")
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

app.post("/upload-files",  async (req, res) => {
	if (!await userIdIsValid(req.cookies.userId)) {
		res.status(401).json({errorMsg: "Unauthorised! Pls login"})
	}else {
		const data = {name: req.headers["x-local-name"], type: req.headers["content-type"]} // todo: check if mime type is present and stop saving files as their local name
		const uploadedData = await storeFileDetails([data], req.cookies.userId)
		req.on('data', (chunk)=>{
			writeToFile("./uploads/"+req.headers["x-local-name"], chunk)
		})
		req.on('end', ()=>{
			if (!req.complete) {
				// mark as incomplete in db or something like that
			}else {
				console.log(uploadedData[0])
				res.status(200).send(JSON.stringify(uploadedData[0]))
			}
		})
	}
})

app.post("/upload-history", async (req, res) => {
	if (!await userIdIsValid(req.cookies.userId)) {
		res.status(401).json({errorMsg: "Unauthorised! Pls login"})
	}else  {
		const historyData = await getFilesData(req.cookies.userId);
	}
})

app.get("/files-data", async (req, res) => {
	if (!await userIdIsValid(req.cookies.userId)) { // perhaps this should even be a middleware
		res.status(401).json({errorMsg: "Unauthorised! Pls login"}) // unauthorised 401 or 403?
	}else{
		const responseData = await getFilesData(req.cookies.userId)
		res.status(200).json(responseData)
	}
})

app.get("/images/:fileUrl", async (req, res)=>{
	const imgName = await getImageName(req.params.fileUrl);
	if (!imgName){
		res.status(404).send("Image not found");
		return;
	}
	if (!fs.existsSync(path.join(__dirname, 'uploads', imgName))) { // look into making it static later
		res.status(404).send("Image not found")
	}
	res.status(200).sendFile(imgName, {root: path.join(__dirname, 'uploads')}, function(err) {
		if (err) {
			console.log(err)
		}else {
			console.log("Sent:", imgName)
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
		res.cookie('userId', user._id, {httpOnly: true, secure: true, sameSite: "Strict", maxAge: 6.04e8}) // 7 days
		return res.status(200).json({msg: "success", loggedInUserName: user.email})
	}else return res.status(404).json({msg: "User not found!"});
})

console.log(`listening on port: ${portNo}`)
app.listen(portNo);
