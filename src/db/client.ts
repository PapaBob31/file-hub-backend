import { MongoClient, ObjectId, type UpdateResult } from "mongodb";

interface ImgData {
	pathName: string, 
	uploadedName: string
};

export interface FileData {
	_id?: string|ObjectId;
	uploadedName: string;
	pathName: string;
	type: string;
	size: number;
	hash: string;
	sizeUploaded: number;
	uri: string;
	timeUploaded: string;
	userId: string|ObjectId;
}

export interface User {
	_id?: string;
	email: string;
	username: string;
	password: string;
}


// todo: implement the decryption algorithm
function decrypt(cipherText: string) {
	let plainText = cipherText;
	return plainText;
}

// todo: find a way to implement schema validation and a better way to manage the connections
export default class SyncedReqClient {
	#connections = 0;
	#client;
	#dataBase;

	constructor(connectionURI: string) {
		this.#client = new MongoClient(connectionURI);
		this.#dataBase = this.#client.db("fylo");
	}

	async #closeConnection() {
		this.#connections--;
		if (this.#connections === 0) {
			await this.#client.close();
			console.log("Yay!")
		}
	}

	async getImageNames(uri: string): Promise<ImgData|null> {
		let names: null|{pathName: string, uploadedName: string} = {pathName: "", uploadedName: ""};
		try {
			const fileDetails = await this.#dataBase.collection("uploaded_files");
			const data = await fileDetails.findOne({uri});
			this.#connections++;

			if (data && data.type.startsWith("image/")) {
				names.uploadedName = data.uploadedName;
				names.pathName = data.pathName;
			}else names = null;
		}catch(error) {
			names = null
			console.log(error);
		}finally {
			this.#connections--;
			await this.#closeConnection();
		}
		return names;
	}

	async storeFileDetails(newFileDoc: FileData) {
		let insertedDoc: FileData|null = newFileDoc;
		try {
			const fileDetails = await this.#dataBase.collection<FileData>("uploaded_files")
			const results = await fileDetails.insertOne(newFileDoc)
			console.log(results)
			this.#connections++;
			insertedDoc._id = results.insertedId;
		} catch(error) {
			insertedDoc = null
			console.log(error)
		}finally {
			await this.#closeConnection();
		}
		return insertedDoc
	}

	async addUploadedFileSize(fileId: string, sizeUploaded: number) : Promise<{acknowledged: boolean}> {
		let result = {acknowledged: false};
		try {
			const fileDetails = await this.#dataBase.collection<FileData>("uploaded_files")
			const updates = await fileDetails.updateOne({_id: new ObjectId(fileId)}, {$set: {sizeUploaded}}) as UpdateResult;
			if (updates.acknowledged)
				result.acknowledged = true;
			this.#connections++;
		} catch(error) {
			console.log(error)
		}finally {
			await this.#closeConnection();
		}
		return result;
	}

	async getFilesData(userId: string) {
		let data:FileData[]|null = null;
		try {
			const fileDetails = await this.#dataBase.collection<FileData>("uploaded_files")
			const findCursorObj = await fileDetails.find({userId: new ObjectId(userId)});
			this.#connections++;
			data = await findCursorObj.toArray(); // should I filter out the id and hash? since their usage client side can be made optional
		}catch(err) {
			data = [];
			console.log(err);
		}finally {
			await this.#closeConnection();
		}
		return {data};
	}

	async getFileByHash(userId: string, hash: string, uploadedName: string) {
		let fileData:FileData|null = null;
		try {
			const fileDetails = await this.#dataBase.collection("uploaded_files")
			fileData = await fileDetails.findOne<FileData>({userId: new ObjectId(userId), hash, uploadedName})
			this.#connections++;
		}catch(err) {
			console.log(err);
		}finally {
			await this.#closeConnection();
		}
		return fileData;
	}

	async createNewUser(userData: User) {
		let status = ""
		try {
			const users = await this.#dataBase.collection("users")
			const existingUser = await users.findOne({email: userData.email})
			this.#connections++;
			if (existingUser)
				throw new Error("Email already in use")
			await users.insertOne({email: userData.email, password: userData.password})
			status = "success"
		}catch(err) {
			if (err.message === "Email already in use")
				status = err.message
			else status = "failure" // todo: change this generic failure message to something like 'Email already in use'
		}finally {
			await this.#closeConnection();
		}
		return status;
	}

	async loginUser(userData: User) {
		let user = null
		try {
			const users = await this.#dataBase.collection("users")
			user = await users.findOne<User>({email: userData.email, password: userData.password})
			this.#connections++;
			if (!user)
				throw new Error("User doesn't esist!")
		}catch(err) {
			user = null
		}finally {
			await this.#closeConnection();
		}
		return user;
	}

	async getUserWithId(id: string) {
		id = decrypt(id);
		if (!id) {
			return null
		}
		let user = null
		try {
			const users = await this.#dataBase.collection("users")
			user = await users.findOne<User>({_id: new ObjectId(id)})
			this.#connections++;
			if (!user)
				user = null;
		}catch(err) {
			user = null;
		}finally {
			await this.#closeConnection();
		}
		return user
	}	
}