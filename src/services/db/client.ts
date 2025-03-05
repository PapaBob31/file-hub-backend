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
	timeUploaded: Date;
	lastModified: Date;
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
	timeCreated: Date;
	lastModified: Date;
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
// and when exactly do I call the close method?
// implement constraints
// project all the fields that's actually needed on the frontend
// close all freaking cursors
// INDEXES

/** Class that contains methods for getting data from the db*/
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

	/** Gets the metadata of a file from the db and returns it
	 * @param {string} uri - uri of the file's metadata in the db
	 * @param {string} userId - user Id of the file's owner*/
	async getFileDetails(uri: string, userId: string): Promise<FileData|null> {
		let data: null|FileData = null;
		const fileDetails = this.#dataBase.collection<FileData>("uploaded_files");
		try {
			data = await fileDetails.findOne({userId: new ObjectId(userId), uri, $expr: {$eq: ["$size", "$sizeUploaded"]}});
		}catch(error) {
			data = null
			console.log(error);
		}
		return data;
	}

	/** Gets the metadata of a folder from the db and returns it
	 * @param {string} uri - uri of the folder's metadata in the db
	 * @param {string} userId - user Id of the folder's owner*/
	async getFolderDetails(uri: string, userId: string) {
		let data: null|Folder = null;
		const folders = this.#dataBase.collection<Folder>("folders");
		try {
			const folderDetails = await folders.findOne({userId: new ObjectId(userId), uri})
			data = folderDetails;
		}catch(error) {
			data = null;
			console.log(error);
		}
		return data;
	}

	/** Stores the metadata of a new file in the db and returns a document that
	 * has the id of the newly inserted file metadata as an attribute
	 * @param {FileData} newFileDoc - document representing the file's metadata that will be stored in the db */
	async storeFileDetails(newFileDoc: FileData) {
		let insertedDoc: FileData|null = newFileDoc;
		const fileDetails = this.#dataBase.collection<FileData>("uploaded_files")
		try {
			const results = await fileDetails.insertOne(newFileDoc)
			insertedDoc._id = results.insertedId;
		} catch(error) {
			insertedDoc = null
			console.log(error)
		}
		return insertedDoc
	}

	/** Updates the total storage (in bytes) used by a user's uploaded files on the server
	 * @param {string} userId - id of the user whose used storage is to be update
	 * @param {number} storageModification - positive or negative integer. Number of bytes to be added to the user's storage*/
	async updateUsedUserStorage(userId: string, storageModification: number) {
		const users = this.#dataBase.collection("users")
		const user = await this.getUserWithId(userId);
		if (!user)
			return false
		try {
			const updates = await users.updateOne({_id: new ObjectId(user._id)}, {$set: {usedStorage: user.usedStorage+storageModification}})
			if (updates.acknowledged)
				return true
		}catch (err) {
			console.log(err)
			return false
		}
	}

	// Updates the size attribute of a file's metadata in the db
	async addUploadedFileSize(fileId: string, newFileSize: number, userId: string, uploadedDataSize: number) : Promise<{acknowledged: boolean}> {
		// read up on mongodb's concurrency control 
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

	async getFilesData(userId: string, folderUri: string, getParams: any) {
		const startFile = getParams.startFileUri ? await this.getFileDetails(decodeURIComponent(getParams.startFileUri), userId) : null

		function getFolderMatchAndSortStage() {
			const matchStage = {$match: {userId: new ObjectId(userId), parentFolderUri: folderUri, isRoot: false}}
			const orderInt = getParams.order === "asc" ? 1 : -1
			const sortStage = {$sort: {name: orderInt, _id: orderInt}}
			return [matchStage, sortStage]
		}

		function getMatchAndSortStage() {
			const matchStage = {
				$match: {
					userId: new ObjectId(userId), parentFolderUri: folderUri, 
					$expr: {$eq: ["$size", "$sizeUploaded"]}, deleted: false
				} as any
			}
			const sortStage = {} as any
			const sortInt = getParams.order === "asc" ? 1 : -1
			const ascendingSort = getParams.order === "asc";
			if (startFile && getParams.start) {
				getParams.start = decodeURIComponent(getParams.start)
			}
				
			// return {statusCode: 400, data: null, msg: null, errorMsg: "Pagination Start File doesn't exist!"}
			
			switch (getParams.sortKey) {
				case "timeUploaded": {
					if (getParams.start) {
						matchStage.$match.timeUploaded = ascendingSort ? {$gte: new Date(getParams.start)} : {$lte: new Date(getParams.start)}
						matchStage.$match._id = {$ne: new ObjectId(startFile!._id)}
					}
					sortStage.$sort = {timeUploaded: sortInt, _id: sortInt}
					break;
				}
				case "name": {
					if (getParams.start) {
						matchStage.$match.name = ascendingSort ? {$gte: getParams.start} : {$lte: getParams.start}
						matchStage.$match._id = {$ne: new ObjectId(startFile!._id)}
					}
					sortStage.$sort = {name: sortInt, _id: sortInt}
					break;
				}
				case "lastModified": {
					if (getParams.start) {
						matchStage.$match.lastModified = ascendingSort ? {$gte: new Date(getParams.start)} : {$lte: new Date(getParams.start)}
						matchStage.$match._id = {$ne: new ObjectId(startFile!._id)}
					}
					sortStage.$sort = {lastModified: sortInt, _id: sortInt}
					break;
				}
				case "size": {
					if (getParams.start) {
						matchStage.$match.size = ascendingSort ? {$gte: parseInt(getParams.start)} : {$lte: parseInt(getParams.start)}
						matchStage.$match._id = {$ne: new ObjectId(startFile!._id)}
					}
					sortStage.$sort = {size: sortInt, _id: sortInt}
					break;
				}
			}
			console.log(matchStage);
			return [matchStage, sortStage]
		}
	
		try {
			if (!getParams.sortKey || !getParams.order) {
				throw new Error("Invalid get parameters")
			}
			const fileDetails = await this.#dataBase.collection<FileData>("uploaded_files")
			const folderDetails = await this.#dataBase.collection<Folder>("folders")

			const parentFolder = await folderDetails.findOne({userId: new ObjectId(userId), uri: folderUri})
			if (!parentFolder) {
				return {statusCode: 404, data: null, msg: null, errorMsg: "Something went wrong"}
			}

			let fileCursorObj = await fileDetails.aggregate([...getMatchAndSortStage(), {$limit: 20}])
			// All files that are children of the folder with the specified uri. try and limit the result somehow to manage memory
			const filesData = await fileCursorObj.toArray(); // should I filter out the id and hash? since their usage client side can be made optional

			const folderMetaData = await folderDetails.aggregate([
					{$match: {uri: folderUri}},
					{$graphLookup: {
						from: "folders",
						startWith: "$parentFolderUri",
						connectToField: "uri",
						connectFromField: "parentFolderUri",
						as: "ancestors"
					}},
					{$project: {_id: 0, sortedPath: {$sortArray: {input: "$ancestors", sortBy: {_id: 1}}}}},
					{$project: {"sortedPath.name": 1, "sortedPath.uri": 1, "sortedPath.isRoot": 1}}
			]).toArray()
			
			if (getParams.start) { 
				// This is a request for more files data and all folders have been sent on initial request
				// and so we don't add folders details to the response
				return {statusCode: 200, data: {pathDetails: [...folderMetaData[0].sortedPath, {name: parentFolder.name, uri: parentFolder.uri}], content: filesData}}
			}else {
				const folderCursorObj = await folderDetails.aggregate([...getFolderMatchAndSortStage()]);
				// All folders that are children of the folder with the specified uri.
				const foldersData = await folderCursorObj.toArray(); 
				return {
					statusCode: 200, 
					data: {
						pathDetails: folderMetaData.length > 0 ? [...folderMetaData[0].sortedPath, {name: parentFolder.name, uri: parentFolder.uri}] : [],
						content: ([] as (FileData|Folder)[]).concat(foldersData, filesData)
					},
					msg: null, errorMsg: null
				}
			} 
				
		}/*catch(err) {
			return {statusCode: 500, data: null, msg: null, errorMsg: "Something went wrong"}
			console.log(err);
		}*/
		finally {
			console.log(99)
		}
	}

	// gets a file metadata using the file hash and file name and returns the metadata
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

	/** Modifies a file's metadata to indicate that its no longer part of the user's upload history
	 * @param {string} fileUri - uri of the file's metadata in the db
	 * @param {string} userId - user Id of the file's owner*/
	async deleteFromHistory(fileUri: string, userId: string) {
		const uploadedFiles = await this.#dataBase.collection<FileData>("uploaded_files")
		let queryResults;
		try {
			const fileDetails = await uploadedFiles.findOne({userId: new ObjectId(userId), uri: fileUri})
			if (fileDetails && (fileDetails.deleted || fileDetails.size !== fileDetails.sizeUploaded)){ // file has been deleted from disk or it's an incomplete upload
				queryResults = await uploadedFiles.deleteOne({userId: new ObjectId(userId), uri: fileUri})
				await fsPromises.unlink(`../uploads/${fileDetails.pathName}`)
			}else
				queryResults = await uploadedFiles.updateOne({userId: new ObjectId(userId), uri: fileUri}, {$set: {inHistory: false}})
			if (!queryResults) //  or updatedCount === 0?
				throw new Error("File doesn't exist")
			return queryResults;
		}catch(err) {
			console.log(err)
			return {acknowledged: false, modifiedCount: 0};
		}
	}

	/** Deletes a file metadata from the db and also deletes the actual file from disk*/
	async deleteFile(userId: string, fileUri: string)  {
		const uploadedFiles = await this.#dataBase.collection<FileData>("uploaded_files")
		let queryResults;
		try {
			const fileDetails = await uploadedFiles.findOne({userId: new ObjectId(userId), uri: fileUri})
			if (fileDetails && !fileDetails.inHistory){
				// metadata of file that's been set to not be in history shouldn't be kept if deleted
				queryResults = await uploadedFiles.deleteOne({userId: new ObjectId(userId), uri: fileUri})
			}else if (fileDetails && fileDetails.inHistory){
				// metadata of file that's set to be in history from history should be kept if deleted
				queryResults = await uploadedFiles.updateOne({userId: new ObjectId(userId), uri: fileUri}, {$set: {deleted: true}})
			}
			if (!fileDetails || !queryResults)
				throw new Error("File doesn't exist")
			const userStorageUpdated = await this.updateUsedUserStorage(userId, -fileDetails.size)
			if (!userStorageUpdated)
				throw new Error("File doesn't exist")
			if (!fileDetails.inHistory)
				await fsPromises.unlink(`../uploads/${fileDetails.pathName}`)
			return queryResults;
		}catch(err) {
			console.log(err)
			return {acknowledged: false, modifiedCount: 0};
		}
	}

	// updates the `name` attribute of a file's metadata in the db
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

	// sets the `favourite` attribute of a file's metadata to true
	async addFileToFavourites(userId: string, fileUri: string) {
		const uploadedFiles = await this.#dataBase.collection<FileData>("uploaded_files");
		try {
			const queryResults = await uploadedFiles.updateOne({userId: new ObjectId(userId), uri: fileUri}, {$set: {favourite: true}})
			return queryResults;
		}catch(err) {
			console.log(err);
			return {acknowledged: false, modifiedCount: 0}
		}
	}

	/** Creates a new user data in the db
	 * @param {userData} User - data of the user to be created*/
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
				storageCapacity: 16106127360 // 15 Gibibytes (1024 bytes = 1 kibibytes)
			});
			if (!queryResult.acknowledged) {
				return {status: 500, errorMsg: {password: "", general:"Something went wrong!", username: "", email: ""}, msg: null}
			}

			// new user should always have a folder created for him/her on signup. the folder would be used similar to an `home folder`
			const queryResult2 = await this.createNewFolderEntry({
				name: "Home",
				parentFolderUri: null,
				userId: new ObjectId(queryResult.insertedId),
				type: "folder",
				uri: homeFolderUri,
				isRoot: true,
				timeCreated: new Date(),
				lastModified: new Date(),
			})

			if (!queryResult2.acknowledged) {
				await users.deleteOne({username: userData.username, email: userData.email}) // what if this fails too
			}

		}catch(err) {
			return {status: 500, errorMsg: {password: "", general:"Something went wrong!", username: "", email: ""}, msg: null}
		}
		return {status: 201, msg: "Account created successfully! Check your email for further instructions", errorMsg: null}
	}

	// Validates a user's login data against the one in the db
	async loginUser(loginData: User) {
		const users = this.#dataBase.collection("users")
		let user = null
		try {
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

	// Gets a user's data from the db through an `id` and returns the data
	async getUserWithId(id: string) {
		const users = this.#dataBase.collection("users")
		let user = null
		try {
			user = await users.findOne<User>({_id: new ObjectId(id)})
			if (!user)
				user = null;
		}catch(err) {
			user = null;
		}
		return user
	}

	/** Stores the metadata of a new folder in the db and returns a document that
	 * has the id of the newly inserted folder metadata as an attribute
	 * @param {Folder} folderDoc - document representing the folder's metadata that will be stored in the db */
	async createNewFolderEntry(folderDoc: Folder) {
		const folders = await this.#dataBase.collection<Folder>("folders");
		let result = {acknowledged: false, insertedId: "" as string|ObjectId, uri: ""};
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

	/** Gets the metadata of all files whose `inHistory` attribute is `true`
	 * @param {string} userId - id of the owner of the files*/
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

	// Grants one or more users `read` and `copy`` access to another user's files or folder
	async grantResourcesPermission(content: ResourcesDetails, userId: string) {
		const sharedFiles = await this.#dataBase.collection<SharedResource>("shared_files");
		const users = await this.#dataBase.collection<User>("users");
		const files = await this.#dataBase.collection<FileData>("uploaded_files")
		const folders = await this.#dataBase.collection<FileData>("folders")

		try {
			const targetResourceUris = content.resourcesData.map(data => data.uri) // uris of files and folders to be shared
			const targetFiles = await files.find({userId: new ObjectId(userId), uri: {$in: targetResourceUris}}).toArray() // metadata of files to share
			const targetFolders = await folders.find({userId: new ObjectId(userId), uri: {$in: targetResourceUris}}).toArray() // metadata of folders to share
			if ((targetFiles.length + targetFolders.length) !== content.resourcesData.length)
				return {status: 404, msg: "Resource to share was not found or perhaps there are duplicate files"}

			const usersToGetAccess = await users.find({username: {$in: content.grantees}}).toArray()
			if (usersToGetAccess.length !== content.grantees.length) 
				return {status: 404, msg: "Some shared Users were not found or perhaps duplicate usernames were specified"}

			const contentToShare:SharedResource[] = []
			for (let grantee of content.grantees) {
				contentToShare.push(...content.resourcesData.map((data) => { // maps the resourcesData attribute into one that can be stored in the `shared_files` collection
					if (!(["folder", "file"]).includes(data.type)) {
						throw new Error("invalid resource type")
					}
					// return valid document to be stored in the `shared_files` collection
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

			data =  ([] as (FileData|Folder)[]).concat(filesData,foldersData)

		}catch(err) {
			data = [];
			console.log(err);
		}
		return data;
	}

	/** Gets the metadata of a shared resource from the db and returns it
	 * @param {string} shareId - _id of shared resource inside the `shared_files` collection
	 * @param {string} accessingUserId - _id of user trying to access the shared file*/
	async getSharedResourceDetails(shareId: string, accessingUserId: string) {
		const sharedFiles = await this.#dataBase.collection<SharedResource>("shared_files");
		const users = await this.#dataBase.collection<User>("users");

		try {
			const accessingUser = await users.findOne({_id: new ObjectId(accessingUserId)})
			const entry = await sharedFiles.findOne({_id: new ObjectId(shareId)})
			if (!entry)
				return null
			if (entry.grantee === null || entry.grantee === accessingUser!.username) // file is shared with everybody when entry.grantee is `null`
				return entry
		}catch(err) {
			return null
		}
	}

	/** Gets the id of the owner of one or more shared resources from the db and returns it
	 * The function assumes that every file whose uri is part of `filesUris` parameter was shared by the same user
	 * @param {string[]} filesUris - uris of the shared resources inside the `shared_files` collection
	 * @param {string} accessingUserId - _id of user the resource was shared with */
	async getSharedFilesGrantorId(filesUris: string[], accessingUserId: string) {
		const sharedFiles = await this.#dataBase.collection<SharedResource>("shared_files");
		const users = await this.#dataBase.collection<User>("users");

		try {
			const accessingUser = await users.findOne({_id: new ObjectId(accessingUserId)}) as User
			const entriesToCopy = await sharedFiles.find({grantee: accessingUser.username, grantedResourceUri: {$in: filesUris}}).toArray()
			if (entriesToCopy.length !== filesUris.length) {
				return {status: 404, payload: {errorMsg: "Some of the resources to be copied do not exist or It's duplicated", msg: null, data: null}}
			}else {
				// use the grantorId of the first item in the array since they should all be the same
				return {status: 200, payload: entriesToCopy[0].grantorId}
			}
		}catch(err) {
			console.log(err)
			return {status: 500, payload: {errorMsg: "Something went wrong and we don't know why", msg: null, data: null}}
		}
	}

	/** Checks if a file or folder is a descendant of a folder and returns the uri if true 
	 * @param {string} folderUri - uri of the folder to check if the file|folder is a descendant of
	 * @param {string} resourceUri - uri of the file or folder */
	async checkIfFileIsNestedInFolder(folderUri: string, resourceUri: string, type: "file"|"folder") {
		const targetCollection = await this.#dataBase.collection(type === "file" ? "uploaded_files" : "folder")

		try {
			const content = await targetCollection.aggregate([
				{$match: {uri: resourceUri}},
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

	// get all the files a user has shared with other users
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

	// delete a document representing a shared file entry
	async deleteSharedFileEntry(deletedEntriesIds: string[], userId: string) {
		const sharedFiles = await this.#dataBase.collection<SharedResource>("shared_files");
		let querySuccessful = false
		try {
			const deletedEntriesObjIds = deletedEntriesIds.map(entryId => new ObjectId(entryId))
			const queryResult = await sharedFiles.deleteMany({_id: {$in: deletedEntriesObjIds}, grantorId: new ObjectId(userId)})
			querySuccessful = queryResult.acknowledged
		}catch(err) {
			console.log(err);
		}finally {
			return querySuccessful
		}
	}

	/** Validates the uris and returns the metadata of files and folders to be copied
	 * @param {string[]} filesToCopyUris - uris of files and folders to copy*/
	async getContentDataToCopy(filesToCopyUris: string[], userId: string) {
		const folders = await this.#dataBase.collection<Folder>("folders");
		const files = await this.#dataBase.collection<FileData>("uploaded_files");

		try {
			const targetFolders = await folders.find({userId: new ObjectId(userId), uri: {$in: filesToCopyUris}}).toArray()
			const targetFiles = await files.find({userId: new ObjectId(userId), uri: {$in: filesToCopyUris}}).toArray()

			if (targetFolders.length + targetFiles.length !== filesToCopyUris.length) { // missing files or folders to be copied
				const invalidUris = extractInvalidUris(filesToCopyUris, ([] as (FileData|Folder)[]).concat(targetFolders,targetFiles))
				if (invalidUris.length > 0) {
					return {msg: "invalid uris", files: null, folders: null, invalidUris}
				}
			}
			return {msg: "valid uris", folders: targetFolders, files: targetFiles}
		}catch (err) {
			return {msg: "server error", folders: null, files: null}
		}
	}

	/** Update the parentFolderUri property of moved files or folders metadata in the db */
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
			}, transactionOptions as any) // 'any' is blocking a type error that s=you should probably fix
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

	/** Creates new documents for the copied files and folders metadata in the db
	 * @param {FileData} copiedFiles - data for the copied files
	 * @param {Folder} copiedFolders - data for the copied folders*/
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
			}, transactionOptions as any) // 'any' is blocking a type error that s=you should probably fix

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
	
	// Searches for files and folders whose name is similar to the `searchString` parameter in the db
	async searchForFile(searchString: string) {
		const files = this.#dataBase.collection<FileData>("uploaded_files");
		const folders = this.#dataBase.collection<Folder>("folders");

		try {
			const searchedFiles = await files.find({name: {$regex:  searchString}}).toArray();
			const searchedFolders = await folders.find({name: {$regex: searchString}}).toArray();
			const results = ([] as (FileData|Folder)[]).concat(searchedFiles,searchedFolders)
			if (results.length === 0)
				return {status: 404, msg: null, errorMsg: "File or folder not found!", data: null}
			return {status: 200, data: results, msg: "Successful!", errorMsg: null}
		}catch(err) {
			console.log(err)
			return {status: 500, errorMsg: "Internal Server Error", data: null, msg: null}
		}
	}

	// deletes a user's data
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

			// delete all it's uploaded fies from disk
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
