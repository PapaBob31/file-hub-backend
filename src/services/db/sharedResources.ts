import { ObjectId, type Db } from "mongodb";
import {type FileData} from "./files.js"
import {type Folder} from "./folders.js"
import {type User} from "./users.js"

interface FolderWithDescendants extends Folder {
	descendants: Folder[]
}

export interface SharedResource {
	_id?: string|ObjectId;
	name: string;
	grantorId: string|ObjectId;
	grantee: string;
	grantedResourceUri: string;
	resourceType: "file"|"folder";
	excludedEntriesUris: string[];
}

interface ResourcesDetails{
	grantees: string[];
	resourcesData: {name: string, uri: string, type: "file"|"folder", excludedEntriesUris: string[]}[];
}

export default class SharedContentDAO {
	#db;
	constructor(db: Db) {
		this.#db = db;
	}

	// Grants one or more users `read` and `copy` access to another user's files or folder
	async grantResourcesPermission(content: ResourcesDetails, userId: string) {
		const sharedFiles = await this.#db.collection<SharedResource>("shared_files");
		const users = await this.#db.collection<User>("users");
		const files = await this.#db.collection<FileData>("uploaded_files")
		const folders = await this.#db.collection<FileData>("folders")

		try {
			const targetResourceUris = content.resourcesData.map(data => data.uri) // uris of files and folders to be shared
			const targetFiles = await files.find({userId: new ObjectId(userId), uri: {$in: targetResourceUris}}).toArray() // metadata of files to share
			const targetFolders = await folders.find({userId: new ObjectId(userId), uri: {$in: targetResourceUris}}).toArray() // metadata of folders to share
			if ((targetFiles.length + targetFolders.length) !== content.resourcesData.length)
				return {status: 404, errorMsg: "Resource to share was not found or perhaps there are duplicate files", msg: null}

			const usersToGetAccess = await users.find({username: {$in: content.grantees}}).toArray()
			if (usersToGetAccess.length !== content.grantees.length) 
				return {status: 404, errorMsg: "Some shared Users were not found or perhaps duplicate usernames were specified", msg: null}

			const contentToShare:SharedResource[] = []
			for (let grantee of content.grantees) {
				contentToShare.push(...content.resourcesData.map((data) => { // maps the resourcesData attribute into one that can be stored in the `shared_files` collection
					if (!(["folder", "file"]).includes(data.type)) {
						throw new Error("invalid resource type")
					}
					// return valid document to be stored in the `shared_files` collection
					return {grantorId: new ObjectId(userId), grantee, grantedResourceUri: data.uri, name: data.name,
							resourceType: data.type, excludedEntriesUris: data.excludedEntriesUris}
				}))
			}
			const queryResult = await sharedFiles.insertMany(contentToShare);
			if (queryResult.acknowledged) {
				return {status: 200, msg: "File shared Successfully!", errorMsg: null}
			}else {
				return {status: 500, errorMsg: "Internal Db Server Error!"}
			}
		}catch(err) {
			console.log(err)
			if (err.message  === "invalid resource type")
				return {status: 400, errorMsg: "At least one content has no valid resource type", msg: null}
			return {status: 500, errorMsg: "Internal Db Server Error!", msg: null}
		}
	}

	async getSharedFolderData(folderUri: string, excludedContentUris: string[]) {
		const files = await this.#db.collection<FileData>("uploaded_files")
		const folders = await this.#db.collection<Folder>("folders")

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
		const sharedFiles = await this.#db.collection<SharedResource>("shared_files");
		const users = await this.#db.collection<User>("users");

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

	async getSharedResourceByUri(resourceUri: string) {
		const sharedFiles = await this.#db.collection<SharedResource>("shared_files");
		const sharedResource = await sharedFiles.findOne({grantedResourceUri: resourceUri})
		return sharedResource;
	}

	/**
	 * @typedef {Object} ContentToCopyDetails - type of the object containing files and folders to copy
	 * @property {Folder[]} folders - folders to copy
	 * @property {files} files - files to copy
	 * @property {srcFolderUri} srcFolderUri - uri of the files/folders original parentFolder
	 * @property {User} originalOwner - original owner of the shared content */

	/** Validates Shared content that's to be copied. Content to be copied can either be the shared
	 * resource itself or descendants of the shared resource incase of shared folders.
	 * @param {string} shareId - _id of the actual shared resource (i.e. not any of it's descendants) in the SharedResource collection
	 * @param {string[]} copiedContentsUris - uris of the shared files/folders to be copied
	 * @param {string} accessingUserId - id of the currently logged in user 
	 * @returns {{status: number, payload: {errorMsg: string|string, msg: null|string, data: ContentToCopyDetails|null}}}*/
	async getContentToCopyDetails(shareId: string, copiedContentsUris: string[], accessingUserId: string) {
		const sharedFiles = await this.#db.collection<SharedResource>("shared_files");
		const users = await this.#db.collection<User>("users");
		const files = await this.#db.collection<FileData>("uploaded_files");
		const folders = await this.#db.collection<FileData>("folders");

		try {
			const accessingUser = await users.findOne({_id: new ObjectId(accessingUserId)}) as User
			const mainSharedEntry = await sharedFiles.findOne({_id: new ObjectId(shareId), grantee: accessingUser.username})
			if (!mainSharedEntry) {
				return {status: 404, payload: {errorMsg: "Shared resource to be copied doesn't exist", msg: null, data: null}}
			}else if (copiedContentsUris.includes(mainSharedEntry.grantedResourceUri) && copiedContentsUris.length !== 1) {
				// copying an actual shared resource and any other resource together is disallowed because 
				// 1. I said so, and 2. The Client UI can't possibly allow it so how tf did it happen? you are a bot??
				return {status: 400, payload: {errorMsg: "Content to be copied must be at the same folder level", msg: null, data: null}}
			}
			const originalOwner = await users.findOne({_id: new ObjectId(mainSharedEntry.grantorId)})

			let srcFolderUri = ""
			let data:FolderWithDescendants[] = [];
			let foldersToCopy = [];
			let foldersToCopyUris = []
			let filesToCopy = [];
			if (mainSharedEntry.resourceType === "folder") {
				data = await folders.aggregate([
					{$match: {uri: mainSharedEntry.grantedResourceUri}},
					{$graphLookup: {
						from: "folders",
						startWith: "$uri",
						connectToField: "parentFolderUri",
						connectFromField: "uri",
						as: "descendants",
					}}
				]).toArray() as FolderWithDescendants[]
			}

			if (mainSharedEntry.resourceType === "file") {
				const sharedFile = await files.findOne({userId: new ObjectId(mainSharedEntry.grantorId), uri: mainSharedEntry.grantedResourceUri})
				if (sharedFile){
					srcFolderUri = sharedFile.parentFolderUri
					filesToCopy.push(sharedFile)
				}
			}

			if (mainSharedEntry.resourceType === "folder") {
				// `copiedContentUris` contains only `mainSharedEntry.grantedResourceUri`
				if (mainSharedEntry.grantedResourceUri === copiedContentsUris[0]){
					const {descendants, ...folderDetails} = data[0];
					foldersToCopy.push(folderDetails, ...descendants)
					foldersToCopyUris.push(folderDetails.uri, ...descendants.map(descendant => descendant.uri))
					srcFolderUri = folderDetails.parentFolderUri as string
				}else for (let descendant of data[0].descendants) {
					if (copiedContentsUris.includes(descendant.uri)) {
						foldersToCopy.push(descendant);
						foldersToCopyUris.push(descendant.uri)
					}
					if (!srcFolderUri)
						srcFolderUri = descendant.parentFolderUri as string
				}
			}
			const nestedFiles = await files.find({userId: new ObjectId(mainSharedEntry.grantorId), parentFolderUri: {$in: foldersToCopyUris}, deleted: false}).toArray()
			const directlyCopiedfiles = await files.find({userId: new ObjectId(mainSharedEntry.grantorId), uri: {$in: copiedContentsUris}, deleted: false}).toArray()
			filesToCopy = [...directlyCopiedfiles, ...nestedFiles]
			return {status: 200, payload: {errorMsg: null, msg: null, data: {folders: foldersToCopy, files: filesToCopy, srcFolderUri, originalOwner: originalOwner as User}}}
		}catch(err) {
			console.log(err.message)
			return {status: 500, payload: {errorMsg: "Server Error!", msg: null, data: null}}
		}
	}

	// get all the files a user has shared with other users
	async getUserSharedFiles(userId: string) {
		const sharedFiles = await this.#db.collection<SharedResource>("shared_files");
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
		const sharedFiles = await this.#db.collection<SharedResource>("shared_files");
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

}
