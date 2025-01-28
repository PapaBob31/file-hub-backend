import { MongoClient, ObjectId, type UpdateResult } from "mongodb";
import { scryptSync, randomBytes } from "node:crypto"
import { nanoid } from "nanoid"
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
	iv: string;
}

export interface Folder {
	_id?: string|ObjectId;
	uri: string;
	name: string;
	isRoot: boolean;
	type: "folder";
	parentFolderUri: string|ObjectId|null;
	userId: string|ObjectId;
	timeCreated: string;
	lastModified: string;
}

export interface User {
	_id?: string|ObjectId;
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

export interface SharedResource {
	_id?: string|ObjectId;
	grantorId: string|ObjectId;
	grantee: string;
	grantedResourceUri: string;
	resourceType: "file"|"folder";
	excludedEntriesUris: string[];
}

interface ResourcesDetails{
	grantees: string[];
	resourcesData: {uri: string, type: "file"|"folder", excludedEntriesUris: string[]}[];
}

interface UserCreationErrors {
	password: string,
	general: string,
	username: string,
	email: string
} 

function extractInvalidUris(targetUris: string[], validUriFiles: (FileData|Folder)[]) {
	const invalidUris: string[] = []

	for (let uri of targetUris) {
		for (let content of validUriFiles) {
			if (content.uri === uri) {
				break;
			}
		}
		invalidUris.push(uri)
	}

	return invalidUris
}


// todo: find a way to implement schema validation and a better way to manage the connections,
// Check if db.collection actually returns a promise or not
// and when exactly do I call the close method?
// implement constraints
// project all the fields that's actually needed on the frontend
// close all freaking cursors
// INDEXES
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

	async getFileDetails(uri: string, userId: string): Promise<FileData|null> {
		let data: null|FileData = null;
		try {
			const fileDetails = await this.#dataBase.collection<FileData>("uploaded_files");
			data = await fileDetails.findOne({userId: new ObjectId(userId), uri, $expr: {$eq: ["$size", "$sizeUploaded"]}});
		}catch(error) {
			data = null
			console.log(error);
		}
		return data;
	}

	async getFolderDetails(uri: string, userId: string) {
		let data: null|Folder = null;
		try {
			const folders = await this.#dataBase.collection<Folder>("folders");
			const folderDetails = await folders.findOne({userId: new ObjectId(userId), uri})
			data = folderDetails;
		}catch(error) {
			data = null;
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
	async addUploadedFileSize(fileId: string, newFileSize: number, userId: string, uploadedDataSize: number) : Promise<{acknowledged: boolean}> {
		let result = {acknowledged: false};
		try {
			const fileDetails = await this.#dataBase.collection<FileData>("uploaded_files")
			const updates = await fileDetails.updateOne({_id: new ObjectId(fileId)}, {$set: {sizeUploaded: newFileSize}}) as UpdateResult;
			const userStorageUpdated = await this.updateUsedUserStorage(userId, uploadedDataSize)
			if (updates.acknowledged && userStorageUpdated)
				result.acknowledged = true;
		} catch(error) {
			console.log(error)
		}
		return result;
	}

	async getFilesData(userId: string, folderUri: string) {
		let data:any = null;
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

			const folderMetaData = await folderDetails.aggregate([
					{$match: {uri: folderUri}},
					{$graphLookup: {
						from: "folders",
						startWith: "$parentFolderUri",
						connectToField: "uri",
						connectFromField: "parentFolderUri",
						depthField: "depth",
						as: "ancestors"
					}},
					{$sort: {"ancestors.depth": -1}},
					{$project: {"ancestors.name": 1, "ancestors.uri": 1}}
			]).toArray()

			data = {pathDetails: folderMetaData[0].ancestors, content: filesData.concat(foldersData)}

		}catch(err) {
			data = [];
			console.log(err);
		}
		return {data};
	}

	async getFileByHash(userId: string, hash: string, name: string) {
		const fileDetails = this.#dataBase.collection("uploaded_files")
		let fileData:FileData|null = null;
		try {
			fileData = await fileDetails.findOne<FileData>({userId: new ObjectId(userId), hash, name})
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

	async createNewUser(userData: User): Promise<{status: number, msg: string|null, errorMsg: UserCreationErrors|null}> {
		const users = await this.#dataBase.collection("users");

		try {
			let duplicateEmailError = ""
			let duplicateUsernameError = ""
			const existingEmail = await users.findOne({email: {$regex: userData.email, $options: "i"}})
			if (existingEmail)
				duplicateEmailError += "Email already in use. Emails are case-sensitive"

			const exisitingUsername = await users.findOne({username: {$regex: userData.username, $options: "i"}})
			if (exisitingUsername)
				duplicateUsernameError += "Username already in use. Usernames are case-sensitive"
			if (existingEmail || exisitingUsername)
				return {status: 400, errorMsg: {password: "", general:"", username: duplicateUsernameError, email: duplicateEmailError}, msg: null}

			const homeFolderUri = nanoid();
			const uniqueSalt = randomBytes(32).toString('hex');
			const passwordHash = scryptSync(userData.password, uniqueSalt, 64, {N: 8192, p: 10}).toString('hex')
			const queryResult = await users.insertOne({
				username: userData.username,
				email: userData.email,
				salt: uniqueSalt,
				password: passwordHash, 
				homeFolderUri,
				plan: "free",
				usedStorage: 0,
				storageCapacity: 16106127360
			});
			if (!queryResult.acknowledged) {
				return {status: 500, errorMsg: {password: "", general:"Something went wrong!", username: "", email: ""}, msg: null}
			}

			const queryResult2 = await this.createNewFolderEntry({
				name: "Home",
				parentFolderUri: null,
				userId: new ObjectId(queryResult.insertedId),
				type: "folder",
				uri: homeFolderUri,
				isRoot: true,
				timeCreated: 'not implemented yet',
				lastModified: 'not implemented yet',
			})

			if (!queryResult2.acknowledged) {
				await users.deleteOne({username: userData.username, email: userData.email}) // what if this fails too
			}

		}catch(err) {
			return {status: 500, errorMsg: {password: "", general:"Something went wrong!", username: "", email: ""}, msg: null}
		}
		return {status: 201, msg: "Account created successfully! Check your email for further instructions", errorMsg: null}
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

	async grantResourcesPermission(content: ResourcesDetails, userId: string) {
		const sharedFiles = await this.#dataBase.collection<SharedResource>("shared_files");
		const users = await this.#dataBase.collection<User>("users");
		const files = await this.#dataBase.collection<FileData>("uploaded_files")
		const folders = await this.#dataBase.collection<FileData>("folders")

		try {
			const targetResourceUris = content.resourcesData.map(data => data.uri)
			const targetFiles = await files.find({userId: new ObjectId(userId), uri: {$in: targetResourceUris}}).toArray()
			const targetFolders = await folders.find({userId: new ObjectId(userId), uri: {$in: targetResourceUris}}).toArray()
			if ((targetFiles.length + targetFolders.length) !== content.resourcesData.length)
				return {status: 404, msg: "Resource to share was not found or perhaps there are duplicate files"}

			const usersToGetAccess = await users.find({username: {$in: content.grantees}}).toArray()
			if (usersToGetAccess.length !== content.grantees.length) 
				return {status: 404, msg: "Some shared Users were not found or perhaps duplicate usernames were specified"}

			const contentToShare:SharedResource[] = []
			console.log(content.grantees)
			for (let grantee of content.grantees) {
				contentToShare.push(...content.resourcesData.map((data) => {
					if (!(["folder", "file"]).includes(data.type)) {
						throw new Error("invalid resource type")
					}
					return {grantorId: new ObjectId(userId), grantee, grantedResourceUri: data.uri, 
							resourceType: data.type, excludedEntriesUris: data.excludedEntriesUris}
				}))
			}
			const queryResult = await sharedFiles.insertMany(contentToShare);
			if (queryResult.acknowledged) {
				return {status: 200, msg: "File shared Successfully!"}
			}else {
				return {status: 500, msg: "Internal Db Server Error!"}
			}
		}catch(err) {
			console.log(err)
			if (err.message  === "invalid resource type")
				return {status: 400, msg: "At least one content has no valid resource type"}
			return {status: 500, msg: "Internal Db Server Error!"}
		}
	}

	async getSharedFolderData(folderUri: string, excludedContentUris: string[]) {
		const files = await this.#dataBase.collection<FileData>("uploaded_files")
		const folders = await this.#dataBase.collection<Folder>("folders")

		let data:(FileData|Folder)[]|null = null;
		try {

			// todo: Change this to Promise.all or something and filter out the files with complete uploads first
			const fileCursorObj = await files.find(
				{ parentFolderUri: folderUri, $expr: {$eq: ["$size", "$sizeUploaded"]}, deleted: false, uri: {$nin: excludedContentUris}});
			const folderCursorObj = await folders.find({ parentFolderUri: folderUri, isRoot: false, uri: {$nin: excludedContentUris}});
			// try and limit the result somehow to manage memory
			const filesData = await fileCursorObj.toArray(); // should I filter out the id and hash? since their usage client side can be made optional
			const foldersData = await folderCursorObj.toArray();

			data = filesData.concat(foldersData)

		}catch(err) {
			data = [];
			console.log(err);
		}
		return data;
	}

	async getSharedResourceDetails(shareId: string, accessingUserId: string) {
		const sharedFiles = await this.#dataBase.collection<SharedResource>("shared_files");
		const users = await this.#dataBase.collection<User>("users");

		try {
			const accessingUser = await users.findOne({_id: new ObjectId(accessingUserId)})
			const entry = await sharedFiles.findOne({_id: new ObjectId(shareId)})
			if (!entry)
				return null
			if (entry.grantee === null || entry.grantee === accessingUser!.username)
				return entry
		}catch(err) {
			return null
		}
	}

	async getSharedFilesToCopyGrantorId(copiedFilesUris: string[], accessingUserId: string) {
		const sharedFiles = await this.#dataBase.collection<SharedResource>("shared_files");
		const users = await this.#dataBase.collection<User>("users");

		try {
			const accessingUser = await users.findOne({_id: new ObjectId(accessingUserId)}) as User
			const entriesToCopy = await sharedFiles.find({grantee: accessingUser.username, grantedResourceUri: {$in: copiedFilesUris}}).toArray()
			if (entriesToCopy.length !== copiedFilesUris.length) {
				return {status: 404, payload: {errorMsg: "Some of the resources to be copied do not exist or It's duplicated", msg: null, data: null}}
			}else {
				return {status: 200, payload: entriesToCopy[0].grantorId}
			}
		}catch(err) {
			console.log(err)
			return {status: 500, payload: {errorMsg: "Something went wrong and we don't know why", msg: null, data: null}}
		}
	}

	async checkIfFileIsNestedInFolder(folderUri: string, fileUri: string, type: "file"|"folder") {
		const targetCollection = await this.#dataBase.collection(type === "file" ? "uploaded_files" : "folder")
		// console.log(targetCollection, fileUri, type)
		try {
			const content = await targetCollection.aggregate([
				{$match: {uri: fileUri}},
				{$graphLookup: {
					from: "folders",
					startWith: "$parentFolderUri",
					connectToField: "uri",
					connectFromField: "parentFolderUri",
					as: "ancestors"
				}}
			]).toArray()
			
			if (content.length > 0) {
				for (let doc of content[0].ancestors) {
					if (doc.uri === folderUri)
						return content[0].uri;
				}
			}else return null;
		}catch(err) {
			console.log(err)
			return null
		}
	}

	async getUserSharedFiles(userId: string) {
		const sharedFiles = await this.#dataBase.collection<SharedResource>("shared_files");
		try {
			const details = await sharedFiles.find({grantorId: new ObjectId(userId)}).toArray()
			return details
		}catch(err) {
			console.log(err);
			return null
		}
	}

	async deleteSharedFileEntry(deletedEntriesUris: string[], grantee: string, userId: string) {
		const sharedFiles = await this.#dataBase.collection<SharedResource>("shared_files");
		let querySuccessful = false
		try {
			const queryResult = await sharedFiles.deleteMany({grantorId: new ObjectId(userId), grantee, grantedResourceUri: {$in: deletedEntriesUris}})
			querySuccessful = queryResult.acknowledged
		}catch(err) {
			console.log(err);
		}finally {
			return querySuccessful
		}
	}

	async getContentDataToCopy(filesToCopyUris: string[], userId: string) {
		const folders = await this.#dataBase.collection<Folder>("folders");
		const files = await this.#dataBase.collection<FileData>("uploaded_files");

		try {
			const targetFolders = await folders.find({userId: new ObjectId(userId), uri: {$in: filesToCopyUris}}).toArray()
			const targetFiles = await files.find({userId: new ObjectId(userId), uri: {$in: filesToCopyUris}}).toArray()

			if (targetFolders.length + targetFiles.length !== filesToCopyUris.length) {
				const invalidUris = extractInvalidUris(filesToCopyUris, targetFolders.concat(targetFiles))
				if (invalidUris.length > 0) {
					return {msg: "invalid uris", files: null, folders: null, invalidUris}
				}
			}
			return {msg: "valid uris", folders: targetFolders, files: targetFiles}
		}catch (err) {
			return {msg: "server error", folders: null, files: null}
		}
	}

	async updateMovedFiles(movedContent: (FileData|Folder)[], destinationFolder: Folder) {
		const files = await this.#dataBase.collection<FileData>("uploaded_files");
		const folders = await this.#dataBase.collection<Folder>("folders")
		const session = this.#client.startSession();
		let querySuccessful = false
		let filesMoveQueryResult: any, foldersMoveQueryResult: any;

		const transactionOptions = {
		    readPreference: 'primary',
		    readConcern: { level: 'local' },
		    writeConcern: { w: 'majority' }
		};

		try {
			await session.withTransaction(async () => {
				const movedContentUris = movedContent.map(file => file.uri)
				filesMoveQueryResult = await files.updateMany({uri: {$in: movedContentUris}}, {$set: {parentFolderUri: destinationFolder.uri}}, {session})
				foldersMoveQueryResult = await folders.updateMany({uri: {$in: movedContentUris}}, {$set: {parentFolderUri: destinationFolder.uri}}, {session})
			}, transactionOptions)
			if ((filesMoveQueryResult!.acknowledged) && (foldersMoveQueryResult!.acknowledged)){
				querySuccessful = true;
			}
		}catch(Err) {
			console.log(Err)
			querySuccessful = false
		}finally {
			await session.endSession()
			return querySuccessful
		}
	}

	async insertCopiedResources(copiedFiles: FileData[], copiedFolders: Folder[], user: User) {
		const files = await this.#dataBase.collection<FileData>("uploaded_files");
		const folders = await this.#dataBase.collection<Folder>("folders");
		const users = await this.#dataBase.collection<User>("users");
		const session = this.#client.startSession();
		let querySuccessful = false
		let filesCopyQueryResult: any = {acknowledged: true}, foldersCopyQueryResult: any = {acknowledged: true}, storageQuery: any = {acknowledged: true};

		const transactionOptions = {
		    readPreference: 'primary',
		    readConcern: { level: 'local' },
		    writeConcern: { w: 'majority' }
		};

		try {
			await session.withTransaction(async () => {
				let totalFilesSize = 0
				for (let file of copiedFiles) {
					totalFilesSize += file.size
				}
				if (copiedFiles.length > 0)
					filesCopyQueryResult = await files.insertMany(copiedFiles, {session})

				if (copiedFolders.length > 0)
					foldersCopyQueryResult = await folders.insertMany(copiedFolders, {session})
				storageQuery = await users.updateOne({_id: new ObjectId(user._id)}, {$set: {usedStorage: user.usedStorage+totalFilesSize}}, {session})
			}, transactionOptions)

			if (filesCopyQueryResult!.acknowledged && foldersCopyQueryResult!.acknowledged && storageQuery!.acknowledged) {
				querySuccessful = true
			}
		}catch(Err) {
			console.log(Err)
			querySuccessful = false
		}finally {
			await session.endSession()
			return querySuccessful
		}
	}
	

	async searchForFile(searchString: string) {
		const files = this.#dataBase.collection<FileData>("uploaded_files");
		const folders = this.#dataBase.collection<Folder>("folders");

		try {
			const searchedFiles = await files.find({name: {$regex:  searchString}}).toArray();
			const searchedFolders = await folders.find({name: {$regex: searchString}}).toArray();
			const results = searchedFiles.concat(searchedFolders)
			if (results.length === 0)
				return {status: 404, msg: null, errorMsg: "File or folder not found!", data: null}
			return {status: 200, data: results, msg: "Successful!", errorMsg: null}
		}catch(err) {
			console.log(err)
			return {status: 500, errorMsg: "Internal Server Error", data: null, msg: null}
		}
	}

	async deleteUserData(userId: string) {
		const users = this.#dataBase.collection<User>("users")
		const files = this.#dataBase.collection<FileData>("uploaded_files");
		const folders = this.#dataBase.collection<Folder>("folders");

		try {
			const userFilesPaths = await files.aggregate([
										{$match: {userId: new ObjectId(userId)}},
										{$project: {pathName: 1}}
									]).toArray()
			await files.deleteMany({userId: new ObjectId(userId)})
			await folders.deleteMany({userId: new ObjectId(userId)})

			for (let fileData of userFilesPaths) {
				await fsPromises.unlink("../uploads/"+fileData.pathName)
			}

			const deleteUserQueryResult = await users.deleteOne({_id: new ObjectId(userId)})

			if (deleteUserQueryResult.acknowledged) {
				return {status: 200, errorMsg: "User deleted!", data: null, msg: null}
			}else {
				return {status: 500, errorMsg: "Internal Server Error", data: null, msg: null}
			}

		}catch(err) {
			console.log(err)
			return {status: 500, errorMsg: "Internal Server Error", data: null, msg: null}
		}
	}
}

const connectionStr = process.env.DB_CONNECTION_STRING as string; // search how to get connection string
const dbClient = new SyncedReqClient(connectionStr)
export const sessionStoreClient = dbClient.getMongoClient()
export default dbClient;
