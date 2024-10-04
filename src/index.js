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
const portNo = 7200;

const uri = "mongodb://127.0.0.1:27017/?directConnection=true&serverSelectionTimeoutMS=2000&appName=mongosh+2.3.1"; // search how to get connection string

const client = new MongoClient(uri);


async function storeFileName(data) {
	let newDbRecords;
	try {
		const database = client.db('uploaded_files')
		const fileDetails = database.collection("fileDetails")

		newDbRecords = data.map(fileData => {return {name: fileData.name, url: fileData.name, type: fileData.type}})

		await fileDetails.insertMany(newDbRecords)
	} catch(error) {
		console.log(error)
		return null;
	}finally {
		client.close();
	}
	return newDbRecords
}

async function getFilesData() {
	let data = null;
	try {
		const dataBase = client.db("uploaded_files")
		data = await dataBase.collection("fileDetails").find();
	}catch(err) {
		//
	}finally {
		client.release()
	}
	return data;
}

function setCorsHeader(req, res, next) {
	res.set("Access-Control-Allow-Origin", "http://localhost:5173")
	res.set("Access-Control-Allow-Headers", "Content-Type")
	res.set("Access-Control-Max-Age", "86400");	// 24 hours, should change later
	res.set("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
	if (req.method === "OPTIONS") {
		res.status(204).send()
	}else next()
}

app.use(setCorsHeader)

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
		const insertedData = await storeFileName(data)
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

app.get("/files/:fileName", (req, res)=>{
	// check if the value of image name exists in the db
	// get it from the file system if it does else return 404
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
