import { ObjectId, type Db } from "mongodb";
import SharedContentDAO from "./sharedResources.js"
import fsPromises from "fs/promises"
import {type FileData} from "./files.js"

export interface Folder {
	_id?: string|ObjectId;
	uri: string;
	name: string;
	isRoot: boolean;
	type: "folder";
	parentFolderUri: string|null;
	userId: string|ObjectId;
	timeCreated: Date;
	lastModified: Date;
}


/** Folders Collection Data Access object*/
export default class FoldersDAO {
	#db;
	constructor(db: Db) {
		this.#db = db;
	}

	/** Stores the metadata of a new folder in the db and returns a document that
	 * has the id of the newly inserted folder metadata as an attribute
	 * @param {Folder} folderDoc - document representing the folder's metadata that will be stored in the db */
	async createNewFolderEntry(folderDoc: Folder) {
		const folders = await this.#db.collection<Folder>("folders");
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

	/** Updates the name attribute of a folder in the db
	 * @param {string} userId - _id of the User who requested for the folder to be renamed
	 * @param {string} folderUri - uri of the folder to update
	 * @param {string} newName - target folder's new name*/
	async renameFolder(userId: string, folderUri: string, newName: string) {
		const folders = await this.#db.collection("folders");
		try {
			const queryResults = await folders.updateOne({userId: new ObjectId(userId), uri: folderUri}, {$set: {name: newName}})
			return queryResults;
		}catch(err) {
			console.log(err)
			return {acknowledged: false, modifiedCount: 0}
		}
	}


	/** Gets the metadata of a folder from the db and returns it
	 * @param {string} uri - uri of the folder's metadata in the db
	 * @param {string} userId - user Id of the folder's owner
	 * @return {Promise<FileData|null>} - */
	async getFolderDetails(uri: string, userId: string) {
		let data: null|Folder = null;
		const folders = this.#db.collection<Folder>("folders");
		try {
			const folderDetails = await folders.findOne({userId: new ObjectId(userId), uri})
			data = folderDetails;
		}catch(error) {
			data = null;
			console.log(error);
		}
		return data;
	}

	/** Deletes a folder's metadata as well as all nested folders and files from the db*/
	async deleteFolder(userId: string, folderUri: string) {
		const folders = await this.#db.collection<Folder>("folders")
		const files = await this.#db.collection<FileData>("uploaded_files")
		try {
			let foldersToBeDeleted = [];
			const targetFolder = await folders.findOne({userId: new ObjectId(userId), uri: folderUri})
			if (!targetFolder)
				return {statusCode: 404, errorMsg: "Folder to delete doesn't exist", data: null}
			else {
				foldersToBeDeleted = (await folders.aggregate([
					{$match: {uri: folderUri}},
					{$graphLookup: {
						from: "folders",
						startWith: "$uri",
						connectToField: "parentFolderUri",
						connectFromField: "uri",
						as: "descendants"
					}},
					{$project: {_id: 0, "descendants.uri": 1}}
				]).toArray())[0].descendants as {uri: string}[]
			}
			let queryResult;
			let foldersToDeleteUris = foldersToBeDeleted.map(folder => folder.uri)
			foldersToDeleteUris.push(folderUri);

			queryResult = await folders.deleteMany({userId: new ObjectId(userId), uri: {$in: foldersToDeleteUris}})
			if (!queryResult.acknowledged)
				return {statusCode: 500, errorMsg: "Something went wrong!", data: null}

			const filesToBeDeleted = await files.find({userId: new ObjectId(userId), parentFolderUri: {$in: foldersToDeleteUris}}).toArray()
			queryResult = await files.deleteMany({userId: new ObjectId(userId), parentFolderUri: {$in: foldersToDeleteUris}})
			if (!queryResult.acknowledged)
				return {statusCode: 500, errorMsg: "Something went wrong!", data: null}

			const filesToBeDeletedPaths = filesToBeDeleted.map(file => file.pathName)
			for (let i=0; i<filesToBeDeletedPaths.length; i++ ){
				await fsPromises.unlink(`../uploads/${filesToBeDeletedPaths[i]}`)
			}
			const sharedFiles = new SharedContentDAO(this.#db);
			const shared = await sharedFiles.getSharedResourceByUri(targetFolder.uri)
			if (shared) {
				await sharedFiles.deleteSharedFileEntry([shared._id as string], userId)
			}
			return {statusCode: 200, errorMsg: "Something went wrong!", data: null};
		}catch(err) {
			console.log(err)
			return {statusCode: 500, errorMsg: "Something went wrong!", data: null}
		}

	}


	/** Checks if a file or folder is a descendant of a folder and returns the uri if true 
	 * @param {string} folderUri - uri of the folder to check if the file|folder is a descendant of
	 * @param {string} resourceUri - uri of the file or folder */
	async checkIfFileIsNestedInFolder(folderUri: string, resourceUri: string, type: "file"|"folder") {
		const targetCollection = await this.#db.collection(type === "file" ? "uploaded_files" : "folders")

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
}