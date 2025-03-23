import { ObjectId, type Db, type MongoClient } from "mongodb";
import FilesDAO, {type FileData} from "./files.js"
import {type Folder} from "./folders.js"
import {type User} from "./users.js"


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

/** uploaded_files collection and folders collection Data Access object*/
export default class ContentDAO {
	private db;
	private client;

	private formatMatchAndSortStages(pipelineMatchStage: any, pipelineSortStage: any, getParams: any, startFile: any) {
		const sortInt = getParams.order === "asc" ? 1 : -1
		const ascendingSort = getParams.order === "asc";
		if (startFile && getParams.start) {
			getParams.start = decodeURIComponent(getParams.start)
		}

		switch (getParams.sortKey) {
			case "timeUploaded": {
				if (getParams.start) {
					pipelineMatchStage.$match.timeUploaded = ascendingSort ? {$gte: new Date(getParams.start)} : {$lte: new Date(getParams.start)}
					pipelineMatchStage.$match._id = {$ne: new ObjectId(startFile!._id)}
				}
				pipelineSortStage.$sort = {timeUploaded: sortInt, _id: sortInt}
				break;
			}
			case "name": {
				if (getParams.start) {
					pipelineMatchStage.$match.name = ascendingSort ? {$gte: getParams.start} : {$lte: getParams.start}
					pipelineMatchStage.$match._id = {$ne: new ObjectId(startFile!._id)}
				}
				pipelineSortStage.$sort = {name: sortInt, _id: sortInt}
				break;
			}
			case "lastModified": {
				if (getParams.start) {
					pipelineMatchStage.$match.lastModified = ascendingSort ? {$gte: new Date(getParams.start)} : {$lte: new Date(getParams.start)}
					pipelineMatchStage.$match._id = {$ne: new ObjectId(startFile!._id)}
				}
				pipelineSortStage.$sort = {lastModified: sortInt, _id: sortInt}
				break;
			}
			case "size": {
				if (getParams.start) {
					pipelineMatchStage.$match.size = ascendingSort ? {$gte: parseInt(getParams.start)} : {$lte: parseInt(getParams.start)}
					pipelineMatchStage.$match._id = {$ne: new ObjectId(startFile!._id)}
				}
				pipelineSortStage.$sort = {size: sortInt, _id: sortInt}
				break;
			}
		}
	}

	constructor(db: Db, dataBaseClient: MongoClient) {
		this.db = db;
		this.client = dataBaseClient
	}

	async getUserContent(userId: string, folderUri: string, getParams: any) {
		const files =  new FilesDAO(this.db);
		const startFile = getParams.startFileUri ? await files.getFileDetails(decodeURIComponent(getParams.startFileUri), userId) : null

		function getFolderMatchAndSortStage() {
			const matchStage = {$match: {userId: new ObjectId(userId), parentFolderUri: folderUri, isRoot: false}}
			const orderInt = getParams.order === "asc" ? 1 : -1
			const sortStage = {$sort: {name: orderInt, _id: orderInt}}
			return [matchStage, sortStage]
		}

		function getMatchAndSortStage(thisInstance: ContentDAO) {
			const matchStage = {
				$match: {
					userId: new ObjectId(userId), parentFolderUri: folderUri, 
					$expr: {$eq: ["$size", "$sizeUploaded"]}, deleted: false
				} as any
			}
			const sortStage = {} as any
			thisInstance.formatMatchAndSortStages(matchStage, sortStage, getParams, startFile)
			return [matchStage, sortStage]
		}
	
		try {
			if (!getParams.sortKey || !getParams.order) {
				throw new Error("Invalid get parameters")
			}
			const fileDetails = await this.db.collection<FileData>("uploaded_files")
			const folderDetails = await this.db.collection<Folder>("folders")

			const parentFolder = await folderDetails.findOne({userId: new ObjectId(userId), uri: folderUri})
			if (!parentFolder) {
				return {statusCode: 404, data: null, msg: null, errorMsg: "Something went wrong"}
			}

			let fileCursorObj = await fileDetails.aggregate([...getMatchAndSortStage(this), {$limit: 20}])
			const filesData = await fileCursorObj.toArray() as FileData[]; // should I filter out the id and hash? since their usage client side can be made optional

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
				const folderCursorObj = await folderDetails.aggregate([...getFolderMatchAndSortStage(this)]);
				// All folders that are children of the folder with the specified uri.
				const foldersData = await folderCursorObj.toArray() as Folder[]; 
				return {
					statusCode: 200, 
					data: {
						pathDetails: folderMetaData.length > 0 ? [...folderMetaData[0].sortedPath, {name: parentFolder.name, uri: parentFolder.uri}] : [],
						content: ([] as (FileData|Folder)[]).concat(foldersData, filesData)
					},
					msg: null, errorMsg: null
				}
			} 
				
		}catch(err) {
			console.log(err);
			return {statusCode: 500, data: null, msg: null, errorMsg: "Something went wrong"}
		}
	}

	/** Validates the uris and returns the metadata of files and folders to be copied
	 * @param {string[]} filesToCopyUris - uris of files and folders to copy*/
	async getContentDataToCopy(filesToCopyUris: string[], userId: string) : 
	Promise<{msg: string, files: null|FileData[], folders: null|Folder[], invalidUris?: string[]}> {
		const folders = await this.db.collection<Folder>("folders");
		const files = await this.db.collection<FileData>("uploaded_files");
		console.log(userId);
		try {
			const targetFolders:any[] = await folders.aggregate([
				{$match: {uri: {$in: filesToCopyUris}, userId: new ObjectId(userId)}},
				{$graphLookup: {
					from: "folders",
					startWith: "$uri",
					connectToField: "parentFolderUri",
					connectFromField: "uri",
					as: "descendants"
				}},
			]).toArray()

			const foldersToCopyUris: string[] = [];
			const foldersToCopy:Folder[] = [];
			
			for (let folder of targetFolders) {
				foldersToCopyUris.push(folder.uri)
				if (folder.isRoot)
					return {msg: "Home folder can't be copied", files: null, folders: null}
				folder.descendants.forEach((descendant: Folder) => {
					foldersToCopyUris.push(descendant.uri)
					foldersToCopy.push(descendant)
				})
				delete folder.descendants;
			}

			const targetFiles = await files.find({userId: new ObjectId(userId), uri: {$in: filesToCopyUris}, deleted: false}).toArray()
			if (targetFolders.length + targetFiles.length !== filesToCopyUris.length) { // missing files or folders to be copied
				const invalidUris = extractInvalidUris(filesToCopyUris, ([] as (FileData|Folder)[]).concat(targetFolders, targetFiles))
				if (invalidUris.length > 0) {
					return {msg: "invalid uris", files: null, folders: null, invalidUris}
				}
			}
			
			const allNestedFiles = await files.find({userId: new ObjectId(userId), parentFolderUri: {$in: foldersToCopyUris}, deleted: false}).toArray()

			return {msg: "valid uris", folders: [...targetFolders as Folder[], ...foldersToCopy], files: [...targetFiles, ...allNestedFiles], }
		}catch (err) {
			return {msg: "server error", folders: null, files: null}
		}
	}

	/** Validates the uris and returns the metadata of files and folders to be moved/cut
	 * @param {string[]} filesToMoveUris - uris of files and folders to move/cut*/
	async getContentToMoveData(filesToMoveUris: string[], userId: string) : Promise<{msg: string, files: null|FileData[], folders: null|Folder[], invalidUris?: string[]}> {
		const folders = await this.db.collection<Folder>("folders");
		const files = await this.db.collection<FileData>("uploaded_files");
		try {
			const targetFolders = await folders.find({uri: {$in: filesToMoveUris}, userId: new ObjectId(userId)}).toArray()
			const targetFiles = await files.find({uri: {$in: filesToMoveUris}, userId: new ObjectId(userId)}).toArray();
			if (targetFolders.length + targetFiles.length !== filesToMoveUris.length) { // missing files or folders to be copied
				const invalidUris = extractInvalidUris(filesToMoveUris, ([] as (FileData|Folder)[]).concat(targetFolders, targetFiles))
				if (invalidUris.length > 0) {
					return {msg: "invalid uris", files: null, folders: null, invalidUris}
				}
			}
			for (let folder of targetFolders) {
				if (folder.isRoot)
					return {msg: "Home folder can't be copied", files: null, folders: null}
			}
			return {msg: "valid uris", folders: targetFolders as Folder[], files: targetFiles}
		}catch (err) {
			console.log(err.message)
			return {msg: "server error", folders: null, files: null}
		}
	}

	/** Update the parentFolderUri property of moved files or folders metadata in the db */
	async updateMovedContentParent(movedContent: (FileData|Folder)[], destinationFolder: Folder) {
		const files = await this.db.collection<FileData>("uploaded_files");
		const folders = await this.db.collection<Folder>("folders")
		const session = this.client.startSession();
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
			}, transactionOptions as any) // 'any' is blocking a type error that you should probably fix
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
		const files = await this.db.collection<FileData>("uploaded_files");
		const folders = await this.db.collection<Folder>("folders");
		const users = await this.db.collection<User>("users");
		const session = this.client.startSession();
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
	async searchContentByName(searchString: string) {
		const files = this.db.collection<FileData>("uploaded_files");
		const folders = this.db.collection<Folder>("folders");

		try {
			const searchedFiles = await files.find({name: {$regex: searchString, $options: 'i'}}).toArray();
			const searchedFolders = await folders.find({name: {$regex: searchString, $options: 'i'}}).toArray();
			const results = ([] as (FileData|Folder)[]).concat(searchedFiles,searchedFolders)
			if (results.length === 0)
				return {status: 404, msg: null, errorMsg: "File or folder not found!", data: []}
			return {status: 200, data: results, msg: "Successful!", errorMsg: null}
		}catch(err) {
			console.log(err)
			return {status: 500, errorMsg: "Internal Server Error", data: null, msg: null}
		}
	}
}