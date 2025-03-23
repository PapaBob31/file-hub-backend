import { ObjectId, type UpdateResult, type Db } from "mongodb";
import fsPromises from "fs/promises"
import UsersDAO from "./users.js"
import SharedContentDAO from "./sharedResources.js"

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
	parentFolderUri: string;
	inHistory: boolean;
	deleted: boolean;
	iv: string;
}

export interface CopiedNestedFileData extends FileData {
	newPathName?: string;
	oldIv?: string
}

/** uploaded_files Collection Data Access object*/
export default class FilesDAO {
	#db;
	constructor(db: Db) {
		this.#db = db;
	}

	/** Gets the metadata of a file from the db and returns it
	 * @param {string} uri - uri of the file's metadata in the db
	 * @param {string} userId - user Id of the file's owner
	 * @return {Promise<FileData|null>}*/
	async getFileDetails(uri: string, userId: string): Promise<FileData|null> {
		let data: null|FileData = null;
		const fileDetails = this.#db.collection<FileData>("uploaded_files");
		try {
			// The file must be owned by the user and it must have been uploaded completely
			data = await fileDetails.findOne({userId: new ObjectId(userId), uri, $expr: {$eq: ["$size", "$sizeUploaded"]}});
		}catch(error) {
			data = null
			console.log(error);
		}
		return data;
	}

	/** Stores the metadata of a new file in the db and returns a document that
	 * has the id of the newly inserted file metadata as an attribute
	 * @param {FileData} newFileDoc - document representing the file's metadata that will be stored in the db */
	async storeFileDetails(newFileDoc: FileData) {
		let insertedDoc: FileData|null = newFileDoc;
		const fileDetails = this.#db.collection<FileData>("uploaded_files")
		try {
			const results = await fileDetails.insertOne(newFileDoc)
			insertedDoc._id = results.insertedId;
		} catch(error) {
			insertedDoc = null
			console.log(error)
		}
		return insertedDoc
	}

	/** Modifies a file's metadata to indicate that its no longer part of the user's upload history
	 * @param {string} fileUri - uri of the file's metadata in the db
	 * @param {string} userId - user Id of the file's owner*/
	async deleteFromHistory(fileUri: string, userId: string) {
		const uploadedFiles = await this.#db.collection<FileData>("uploaded_files")
		let queryResults;
		try {
			const fileDetails = await uploadedFiles.findOne({userId: new ObjectId(userId), uri: fileUri})
			if (fileDetails && (fileDetails.deleted || fileDetails.size !== fileDetails.sizeUploaded)){ // file has been deleted from disk or it's an incomplete upload
				queryResults = await uploadedFiles.deleteOne({userId: new ObjectId(userId), uri: fileUri})
				// await fsPromises.unlink(`../uploads/${fileDetails.pathName}`)
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
		const uploadedFiles = await this.#db.collection<FileData>("uploaded_files")
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

			const users = new UsersDAO(this.#db)
			const userStorageUpdated = await users.updateUsedUserStorage(userId, -fileDetails.size)
			if (!userStorageUpdated)
				throw new Error("File doesn't exist")

			await fsPromises.unlink(`../uploads/${fileDetails.pathName}`)

			const sharedFiles = new SharedContentDAO(this.#db);
			const shared = await sharedFiles.getSharedResourceByUri(fileDetails.uri)
			if (shared) {
				await sharedFiles.deleteSharedFileEntry([shared._id as string], userId)
			}
			return queryResults;
		}catch(err) {
			console.log(err)
			return {acknowledged: false, modifiedCount: 0};
		}
	}


	// Updates the size attribute of a file's metadata in the db
	async addUploadedFileSize(fileId: string, newFileSize: number, userId: string, uploadedDataSize: number) : Promise<{acknowledged: boolean}> {
		// read up on mongodb's concurrency control 
		let result = {acknowledged: false};
		try {
			const fileDetails = await this.#db.collection<FileData>("uploaded_files")
			const updates = await fileDetails.updateOne({_id: new ObjectId(fileId)}, {$set: {sizeUploaded: newFileSize}}) as UpdateResult;
			const users = new UsersDAO(this.#db)
			const userStorageUpdated = await users.updateUsedUserStorage(userId, uploadedDataSize)
			if (updates.acknowledged && userStorageUpdated)
				result.acknowledged = true;
		} catch(error) {
			console.log(error)
		}
		return result;
	}

	
	/** Gets the metadata of all files whose `inHistory` attribute is `true`
	 * @param {string} userId - id of the owner of the files*/
	async getUserUploadHistory(userId: string) {
		const uploadHistory = await this.#db.collection<FileData>("uploaded_files");
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

	// gets a file metadata using the file hash and file name and returns the metadata
	async getFileByHash(userId: string, hash: string, name: string) {
		const fileDetails = this.#db.collection("uploaded_files")
		let fileData:FileData|null = null;
		try {
			fileData = await fileDetails.findOne<FileData>({userId: new ObjectId(userId), hash, name})
		}catch(err) {
			console.log(err);
		}
		return fileData;
	}

	// updates the `name` attribute of a file's metadata in the db
	async renameFile(userId: string, fileUri: string, newName: string) {
		const uploadedFiles = await this.#db.collection("uploaded_files");
		try {
			const queryResults = await uploadedFiles.updateOne({userId: new ObjectId(userId), uri: fileUri}, {$set: {name: newName}})
			return queryResults;
		}catch(err) {
			console.log(err)
			return {acknowledged: false, modifiedCount: 0}
		}
	}

	// sets the `favourite` attribute of a file's metadata to true
	async addFileToFavourites(userId: string, fileUri: string) {
		const uploadedFiles = await this.#db.collection<FileData>("uploaded_files");
		try {
			const queryResults = await uploadedFiles.updateOne({userId: new ObjectId(userId), uri: fileUri}, {$set: {favourite: true}})
			return queryResults;
		}catch(err) {
			console.log(err);
			return {acknowledged: false, modifiedCount: 0}
		}
	}
}