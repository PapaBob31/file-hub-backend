const express = require("express")
const app = express()
const { createServer } = require("node:http");
const { join } = require("node:path"); //?
const { Server } = require("socket.io");
const server = createServer(app);
const io = new Server(server, {
	maxHttpBufferSize: 1e10,
	cors: {
		origin: "http://localhost:5173",
		credentials: true,
	}
})
const { MongoClient } = require("mongodb");
const fs = require("fs");
const path = require("node:path")
const portNo = 7200;

const dbUri = "mongodb://127.0.0.1:27017/?directConnection=true&serverSelectionTimeoutMS=2000"; // search how to get connection string


function generateUrlSlug() { // Generates random string that will be used as the created quiz's url
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
		const dataBase = client.db("uploaded_files");
		const fileDetails = await dataBase.collection("fileDetails");

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

async function storeFileDetails(data) {
	let newDbRecords;
	const client = new MongoClient(dbUri);
	try {
		client.connect() // incase it was already closed by another async operation
		const database = client.db('uploaded_files')
		const fileDetails = await database.collection("fileDetails")

		newDbRecords = data.map(fileData => {return {name: fileData.name, uri: generateUrlSlug(), type: fileData.type}})

		await fileDetails.insertMany(newDbRecords)
	} catch(error) {
		console.log(error)
	}finally {
		await client.close();
	}
	return newDbRecords
}

async function getFilesData() {
	let data = null;
	const client = new MongoClient(dbUri);
	try {
		client.connect() // incase it was already closed by another async operation
		const dataBase = client.db("uploaded_files")
		const fileDetails = await dataBase.collection("fileDetails")
		data = await fileDetails.find()
		data = await data.toArray();
	}catch(err) {
		data = [];
		console.log(err);
	}finally {
		await client.close()
	}
	return {data};
}

function setCorsHeader(req, res, next) {
	res.set("Access-Control-Allow-Origin", "http://localhost:5173")
	res.set("Access-Control-Allow-Headers", "Content-Type")
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

app.use(logRequestDetails, setCorsHeader)

function writeToDisk(data) {
	data.forEach(fileData => {
		const fd = fs.openSync(`./uploads/${fileData.name}`, 'w')
		fs.writeSync(fd, fileData.file)
		fs.closeSync(fd)
	})
}

io.on("connection", (socket) => {
	console.log("A user connected")
	socket.on("file-upload", async (data) => {
		writeToDisk(data);
		const insertedData = await storeFileDetails(data)
		io.emit("upload-success", insertedData)
	})
	socket.on("disconnect", ()=>{
		console.log("A user disconnected");
	})
})

app.get("/files-data", async (req, res) => {
	const responseData = await getFilesData()
	res.status(200).json(responseData)
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
	console.log(imgName);
	res.status(200).sendFile(imgName, {root: path.join(__dirname, 'uploads')}, function(err) {
		if (err) {
			console.log(err)
		}else {
			console.log("Sent:", imgName)
		}
	})
})
console.log(`listening on port: ${portNo}`)
server.listen(portNo);



/*const multer = require("multer");

const storage =  multer.diskStorage({
	destination: function (req, file, cb) {
		cb(null, "./uploads")
	},
	filename: (req, file, cb) => cb(null, file.originalname)
})
const uploads = multer({storage: storage});*/
