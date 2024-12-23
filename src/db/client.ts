import { MongoClient, ObjectId, type UpdateResult } from "mongodb";
import { generateUrlSlug } from "../controllers/utilities"
import { scryptSync, randomBytes } from "node:crypto"
import fsPromises from "fs/promises"


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
	lastModified: string;
	favourite: boolean;
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
	lastModified: string;
}

export interface User {
	_id?: string;
	email: string;
	username: string;
	password: string;
	salt: string;
	homeFolderUri: string;
	plan: string;
	storageCapacity: number;
	usedStorage: number;
	// date account was created?
}


// todo: find a way to implement schema validation and a better way to manage the connections,
// Check if db.collection actually returns a promise or not
// and when exactly do I call the close method?
// implement constraints
class SyncedReqClient {
	#client;
	#dataBase;

	constructor(connectionURI: string) {
		this.#client = new MongoClient(connectionURI);
		this.#dataBase = this.#client.db("fylo");
	}

	getMongoClient() {
		return this.#client;
	}

	async getFileDetails(uri: string): Promise<FileData|null> {
		let data: null|FileData = null;
		try {
			const fileDetails = await this.#dataBase.collection<FileData>("uploaded_files");
			data = await fileDetails.findOne({uri, $expr: {$eq: ["$size", "$sizeUploaded"]}});
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
			insertedDoc._id = results.insertedId;
		} catch(error) {
			insertedDoc = null
			console.log(error)
		}
		return insertedDoc
	}


	async updateUsedUserStorage(userId: string, storageModification: number) {
		const user = await this.getUserWithId(userId);
		if (!user)
			return false
		try {
			const users = await this.#dataBase.collection("users")
			const updates = await users.updateOne({_id: new ObjectId(user._id)}, {$set: {usedStorage: user.usedStorage+storageModification}})
			if (updates.acknowledged)
				return true
		}catch (err) {
			console.log(err)
			return false
		}
	}

	// read up on mongodb's concurrency control 
	async addUploadedFileSize(fileId: string, sizeUploaded: number, userId: string, uploadedDataLen: number) : Promise<{acknowledged: boolean}> {
		let result = {acknowledged: false};
		try {
			const fileDetails = await this.#dataBase.collection<FileData>("uploaded_files")
			const updates = await fileDetails.updateOne({_id: new ObjectId(fileId)}, {$set: {sizeUploaded}}) as UpdateResult;
			const userStorageUpdated = await this.updateUsedUserStorage(userId, uploadedDataLen)
			if (updates.acknowledged && userStorageUpdated)
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
			const fileCursorObj = await fileDetails.find(
				{userId: new ObjectId(userId), parentFolderUri: folderUri, $expr: {$eq: ["$size", "$sizeUploaded"]}, deleted: false});
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
		let fileData:FileData|null = null;
		try {
			const fileDetails = await this.#dataBase.collection("uploaded_files")
			fileData = await fileDetails.findOne<FileData>({userId: new ObjectId(userId), hash, name})
			// console.log("DEBUG!", fileData);
		}catch(err) {
			console.log(err);
		}
		return fileData;
	}

	async deleteFromHistory(fileUri: string, userId: string) {
		const uploadedFiles = await this.#dataBase.collection<FileData>("uploaded_files")
		let queryResults;
		try {
			const fileDetails = await uploadedFiles.findOne({userId: new ObjectId(userId), uri: fileUri})
			if (fileDetails && (fileDetails.deleted || fileDetails.size !== fileDetails.sizeUploaded))
				queryResults = await uploadedFiles.deleteOne({userId: new ObjectId(userId), uri: fileUri})
			else
				queryResults = await uploadedFiles.updateOne({userId: new ObjectId(userId), uri: fileUri}, {$set: {inHistory: false}})
			if (!queryResults) //  or updatedCount === 0?
				throw new Error("File doesn't exist")
			return queryResults;
		}catch(err) {
			console.log(err)
			return {acknowledged: false, modifiedCount: 0};
		}
	}

	async deleteFile(userId: string, fileUri: string)  {
		const uploadedFiles = await this.#dataBase.collection<FileData>("uploaded_files")
		let queryResults;
		try {
			const fileDetails = await uploadedFiles.findOne({userId: new ObjectId(userId), uri: fileUri})
			if (fileDetails && !fileDetails.inHistory)
				queryResults = await uploadedFiles.deleteOne({userId: new ObjectId(userId), uri: fileUri})
			else
				queryResults = await uploadedFiles.updateOne({userId: new ObjectId(userId), uri: fileUri}, {$set: {deleted: true}})
			if (!fileDetails || !queryResults)
				throw new Error("File doesn't exist")
			const userStorageUpdated = await this.updateUsedUserStorage(userId, -fileDetails.size)
			if (!userStorageUpdated)
				throw new Error("File doesn't exist")
			await fsPromises.unlink(`C:\\Users\\HP\\Desktop\\stuff\\web dev\\fylo-backend\\src\\uploads\\${fileDetails.pathName}`)
			return queryResults;
		}catch(err) {
			console.log(err)
			return {acknowledged: false, modifiedCount: 0};
		}
	}

	async renameFile(userId: string, fileUri: string, newName: string) {
		const uploadedFiles = await this.#dataBase.collection("uploaded_files");
		try {
			const queryResults = uploadedFiles.updateOne({userId: new ObjectId(userId), uri: fileUri}, {$set: {name: newName}})
			return queryResults;
		}catch(err) {
			console.log(err)
			return {acknowledged: false, modifiedCount: 0}
		}
	}

	async addFileToFavourites(userId: string, fileUri: string) {
		const uploadedFiles = await this.#dataBase.collection<File>("uploaded_files");
		try {
			const queryResults = await uploadedFiles.updateOne({userId: new ObjectId(userId), uri: fileUri}, {$set: {favourite: true}})
			return queryResults;
		}catch(err) {
			console.log(err);
			return {acknowledged: false, modifiedCount: 0}
		}
	}

	async createNewUser(userData: User) {
		let status = ""
		try {
			const users = await this.#dataBase.collection("users");

			const existingUser = await users.findOne({email: userData.email})
			if (existingUser)
				throw new Error("Email already in use")
			const homeFolderUri = generateUrlSlug();
			const uniqueSalt = randomBytes(32).toString('hex');
			const passwordHash = scryptSync(userData.password, uniqueSalt, 64, {N: 8192, p: 10}).toString('hex')
			const queryResult = await users.insertOne(
				{username: userData.username, email: userData.email, salt: uniqueSalt, password: passwordHash, homeFolderUri}
			);
			if (!queryResult.acknowledged) {
				throw new Error("Something went wrong")
			}

			const queryResult2 = await this.createNewFolderEntry({
				name: '',
				parentFolderUri: '', // or null??
				userId: new ObjectId(queryResult.insertedId),
				type: "folder",
				uri: homeFolderUri,
				isRoot: true,
				timeCreated: 'not implemented yet',
				lastModified: 'not implemented yet'
			})

			if (!queryResult2.acknowledged) {
				await users.deleteOne({username: userData.username, email: userData.email}) // what if this fails too
				throw new Error("Something went wrong")
			}

			status = "success"
		}catch(err) {
			if (err.message === "Email already in use")
				status = err.message
			else status = "failure" // todo: change this generic failure message to something like 'Email already in use'
		}
		return status;
	}

	async loginUser(loginData: User) {
		let user = null
		try {
			const users = await this.#dataBase.collection("users")
			user = await users.findOne<User>({email: loginData.email})
			if (!user)
				throw new Error("User doesn't esist!")
			if (user.password !== scryptSync(loginData.password, user.salt, 64, {N: 8192, p: 10}).toString('hex'))
				throw new Error("Invalid password")
		}catch(err) {
			user = null
		}
		return user;
	}

	async getUserWithId(id: string) {
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

const connectionStr = process.env.DB_CONNECTION_STRING as string; // search how to get connection string
const dbClient = new SyncedReqClient(connectionStr)
export const sessionStoreClient = dbClient.getMongoClient()
export default dbClient;
