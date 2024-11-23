import { MongoClient, ObjectId, type UpdateResult } from "mongodb";
import { generateUrlSlug } from "../controllers/utilities"


export interface FileData {
	_id?: string|ObjectId;
	name: string;
	pathName: string;
	type: string;
	size: number;
	hash: string;
	sizeUploaded: number;
	uri: string;
	timeUploaded: string;
	userId: string|ObjectId;
	parentFolderUri: string|ObjectId;
	inHistory: boolean;
	deleted: boolean;
}

export interface Folder {
	_id?: string|ObjectId;
	uri: string;
	name: string;
	isRoot: boolean;
	type: "folder";
	parentFolderUri: string|ObjectId;
	userId: string|ObjectId;
	timeCreated: string;
}

export interface User {
	_id?: string;
	email: string;
	username: string;
	password: string;
	homeFolderUri: string;
}


// todo: implement the decryption algorithm
function decrypt(cipherText: string) {
	let plainText = cipherText;
	return plainText;
}

// todo: find a way to implement schema validation and a better way to manage the connections
// and when exactlly do I call the close method?
export default class SyncedReqClient {
	#client;
	#dataBase;

	constructor(connectionURI: string) {
		this.#client = new MongoClient(connectionURI);
		this.#dataBase = this.#client.db("fylo");
	}

	async getFileDetails(uri: string): Promise<FileData|null> {
		let data: null|FileData = null;
		try {
			const fileDetails = await this.#dataBase.collection<FileData>("uploaded_files");
			data = await fileDetails.findOne({uri});
		}catch(error) {
			data = null
			console.log(error);
		}
		return data;
	}

	async storeFileDetails(newFileDoc: FileData) {
		let insertedDoc: FileData|null = newFileDoc;
		try {
			const fileDetails = await this.#dataBase.collection<FileData>("uploaded_files")
			const results = await fileDetails.insertOne(newFileDoc)
			console.log(results)
			insertedDoc._id = results.insertedId;
		} catch(error) {
			insertedDoc = null
			console.log(error)
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
		} catch(error) {
			console.log(error)
		}
		return result;
	}

	async getFilesData(userId: string, folderUri: string) {
		let data:(FileData|Folder)[]|null = null;
		try {
			const fileDetails = await this.#dataBase.collection<FileData>("uploaded_files")
			const folderDetails = await this.#dataBase.collection<Folder>("folders")

			// todo: Change this to Promise.all or something and filter out the files with complete uploads first
			const fileCursorObj = await fileDetails.find({userId: new ObjectId(userId), parentFolderUri: folderUri});
			const folderCursorObj = await folderDetails.find({userId: new ObjectId(userId), parentFolderUri: folderUri, isRoot: false});
			// try and limit the result somehow to manage memory
			const filesData = await fileCursorObj.toArray(); // should I filter out the id and hash? since their usage client side can be made optional
			const foldersData = await folderCursorObj.toArray();

			data = filesData.concat(foldersData)

		}catch(err) {
			data = [];
			console.log(err);
		}
		return {data};
	}

	async getFileByHash(userId: string, hash: string, name: string) {
		console.log(userId, hash, name)
		let fileData:FileData|null = null;
		try {
			const fileDetails = await this.#dataBase.collection("uploaded_files")
			fileData = await fileDetails.findOne<FileData>({userId: new ObjectId(userId), hash, name})
			console.log("DEBUG!", fileData);
		}catch(err) {
			console.log(err);
		}
		return fileData;
	}

	async createNewUser(userData: User) {
		let status = ""
		try {
			const users = await this.#dataBase.collection("users");

			const existingUser = await users.findOne({email: userData.email})
			if (existingUser)
				throw new Error("Email already in use")
			const homeFolderUri = generateUrlSlug();
			const queryResult = await users.insertOne(
				{username: userData.username, email: userData.email, password: userData.password, homeFolderUri}
			);
			const queryResult2 = await this.createNewFolderEntry({
				name: '',
				parentFolderUri: '', // or null??
				userId: new ObjectId(queryResult.insertedId),
				type: "folder",
				uri: homeFolderUri,
				isRoot: true,
				timeCreated: 'not implemented yet'
			})

			if (!queryResult.acknowledged || !queryResult2.acknowledged) {
				throw new Error("Something went wrong")
			}

			status = "success"
		}catch(err) {
			// rollback? since at least one db request may have been satisfied
			if (err.message === "Email already in use")
				status = err.message
			else status = "failure" // todo: change this generic failure message to something like 'Email already in use'
		}
		return status;
	}

	async loginUser(userData: User) {
		let user = null
		try {
			const users = await this.#dataBase.collection("users")
			user = await users.findOne<User>({email: userData.email, password: userData.password})
			if (!user)
				throw new Error("User doesn't esist!")
		}catch(err) {
			user = null
		}
		return user;
	}

	async getUserWithId(id: string) {
		if (!id) {
			return null
		}
		id = decrypt(id);
		let user = null
		try {
			this.#client.connect();
			const users = await this.#dataBase.collection("users")
			user = await users.findOne<User>({_id: new ObjectId(id)})
			if (!user)
				user = null;
		}catch(err) {
			user = null;
		}
		return user
	}

	async createNewFolderEntry(folderDoc: Folder) {
		const folders = await this.#dataBase.collection<Folder>("folders");
		let result = {acknowledged: false, insertedId: "", uri: ""};
		try {
			const queryResult = await folders.insertOne(folderDoc);
			if (queryResult) {
				result = {...queryResult, uri: folderDoc.uri};
			}
		}catch(err) {
			console.log(err);
			result.acknowledged = false;
		}
		return result;
	}

	async getUserUploadHistory(userId: string) {
		const uploadHistory = await this.#dataBase.collection<FileData>("uploaded_files");
		let results:FileData[]|null = [];

		try {
			const queryResult = await uploadHistory.find({userId: new ObjectId(userId), inHistory: true});
			results = await queryResult.toArray();

		}catch(err) {
			results = null;
			console.log(err);
		}

		return results;
	}
}