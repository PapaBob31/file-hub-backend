import { type Request, type Response } from "express";
import fs from "fs";
// import fsPromises from "fs/promises"
import dbClient from "../db/client.js"
import { type FileData, type CopiedNestedFileData, } from "../db/files.js"
import { type Folder } from "../db/folders.js"
import { type User } from "../db/users.js"
// import escapeHtml from "escape-html"
import { ObjectId } from "mongodb"
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "node:crypto"
import { nanoid } from "nanoid"
import { generateCopiedContentDict, getFileStream } from "./utilities.js"

/** The first parameter is a dictionary that maps folder uri strings to an Array of it's direct children files/folders.
 * This function changes the iv, id, name and parentFolderUri of all the objects in each array values of the dictionary recursively
 * @param {any} parentUriChildDict - dictionary mapping parent folder uris to an array of it's direct children
 * @param {string} parentFolderUri - uri of the folder whose children would be modified first
 * @param {string} newParentFolderUri - uri the parentFolderUri each child attribute will be changed to*/	
function modifyCopiedSharedContent(parentUriChildDict: {[key:string]: (CopiedNestedFileData|Folder)[]}, parentFolderUri: string, newParentFolderUri: string, newUserId: string) {
	if (!parentUriChildDict[parentFolderUri]) { // folder has no content
		return;
	}
	for (let content of parentUriChildDict[parentFolderUri]) {
		const oldContentUri = content.uri
		content.userId = new ObjectId(newUserId)
		content._id = new ObjectId()
		content.uri = nanoid()
		content.parentFolderUri = newParentFolderUri
		if (content.type === "folder") {
			modifyCopiedSharedContent(parentUriChildDict, oldContentUri, content.uri, newUserId)
		}else {
			content = content as CopiedNestedFileData
			content.newPathName = content.name + nanoid() + ".UFILE";
			/* The iv used to encrypt the data is also changed bcos we would later change the owner of the file and the keys for 
			encryption/decryption are derived from the file owner's password hash. It's secure to have iv uniqueness*/
			content.oldIv = content.iv
			content.iv = randomBytes(16).toString('hex')
		}
	}
}

/** this function can update a counter on how many files have been created
 * @callback fileStreamCallBack */

/** Decrypts one or more files with their respective decryption keys, 
 * encrypt each one with a new encryption key and save it to disk
 * @param {CopiedNestedFileData[]} filesData - array of file attributes to decrypt-encrypt-copy
 * @param {User} newOwner - new owner of the files
 * @param {User} OldOwner - previous owner of the files
 * @param {fileStreamCallBack} fileStreamEndCb - callback that ought to get called when the decrypt-encrypt-copy operation ends for each file */
function copySharedFilesOnDisk(filesData: CopiedNestedFileData[], newOwner: User, oldOwner: User, fileStreamEndCb: ()=>void) {
	for (let data of filesData) {
		try {
			const encryptKey = scryptSync(newOwner.password, 'notRandomSalt', 24)
			const decryptKey = scryptSync(oldOwner.password, 'notRandomSalt', 24) 
			const aesCipher = createCipheriv("aes-192-cbc", encryptKey, Buffer.from(data.iv, 'hex'))
			const aesDecipher = createDecipheriv("aes-192-cbc", decryptKey, Buffer.from(data.oldIv as string, 'hex'))
			const inputFileStream = fs.createReadStream("../uploads/"+data.pathName) // if not fileStream??
			const outputFileStream = fs.createWriteStream("../uploads/"+data.newPathName) // if not fileStream??
			inputFileStream.pipe(aesDecipher).pipe(aesCipher).pipe(outputFileStream)
			outputFileStream.on('finish', fileStreamEndCb)
		}catch(err) {
			console.log(err.message)
			fileStreamEndCb()
		}
	}
}

/** Handles a request to share files/folders with other users.
 * The users the files/folders are shared with are granted limited access to the files/folder 
 * @param {string[]} req.body.grantees - usernames of the users to share the file/folders with
 * @param {resourcesData[]} req.body.resourcesData {uri: string, type: string, excludedEntriesUris: string[]} - data of the files/folders to be shared */
export async function accessGrantReqHandler(req: Request, res: Response) {
	if (!req.body.grantees || !req.body.resourcesData) {
		res.status(400).json({errorMsg: "Invalid request body", msg: null, data: null})
	}else {
		const queryResult = await dbClient.sharedContent.grantResourcesPermission(req.body, req.session.userId as string)
		res.status(queryResult.status).json({msg: queryResult.msg, errorMsg: queryResult.errorMsg, data: null})
	}	
}

/** Handles the request to revoke a user's access to the file/folder shared with them
 * @param {Request} req - http Request object
 * @param {Response} res - http Response object
 * @param {string} req.session.userId - id of the currently logged in user
 * @param {string[]} req.body.shareIds -  ids of the file's to be revoked */
export async function revokeSharedAccessReqHandler(req: Request, res: Response) {
	if (!req.body.shareIds) {
		res.status(400).json({msg: null, errorMsg: "Bad Request!", data: null})
	}else {
		const querySuccessful = await dbClient.sharedContent.deleteSharedFileEntry(req.body.shareIds, req.session.userId as string)
		if (querySuccessful){
			res.status(200).json({msg: "Files access revoked", data: null, errorMsg: null})
		}else {
			res.status(500).json({errrorMsg: "Something went wrong", data: null, errorMsg: null})
		}
	}
}

/** Checks if uri is same the uri of a shared resource in the case of shared files and shared folder or it's
 * the uri of one of the descendants of a shared resource in the case of shared folders.
 * @param {string} shareId - _id of the shared resource in the shared resource collection
 * @param {string} userId - id of the currently logged in user
 * @param {string} contentUri - uri of the content we are checking for
 * @param {string} type - string indicating the content we are checking for is a file or folder
 * @returns {null|Object} - null if we can't match the uri or An object containing the details of the shared resource and the target content uri*/
async function getSharedResourceContentDetails(shareId: string, userId: string, contentUri: string, type: "folder"|"file") {
  const resource = await dbClient.sharedContent.getSharedResourceDetails(shareId, userId)
  if (!resource) {
    return null
  }

  let targetContentUri;
  if (contentUri === resource.grantedResourceUri) {
    targetContentUri = resource.grantedResourceUri;
  }else if (resource.resourceType !== "folder"){
  	return null
  }else {
    // gets a resource uri if it's a child of a shared folder cos sharing a folder is 
    // sharing all the folder's children by default, no matter how deeply nested.
    // Probably inefficient if there are a lot of files in a shared folder client side
    const contentIsFolderChild = await dbClient.folders.checkIfFileIsNestedInFolder(resource.grantedResourceUri, contentUri, type)
    if (contentIsFolderChild) {
      targetContentUri = contentIsFolderChild
    }else {
      return null
    }
  }

  return {details: resource, targetContentUri}

}

/** Handles a request from an authenticated user for a resource's (file|folder) content that was shared with him/her
 * @param {Request} req - http Request object
 * @param {Response} res - http Response object
 * @param {string} req.session.userId - id of the currently logged in user
 * @param {string} req.params.shareId - unique id associated with the shared resoource
 * @param {string} req.params.fileUri - uri of the shared resoource
 * @param {string} req.query.type - can either have values 'file' or 'folder' */
export async function sharedItemsContentReqHandler(req: Request, res: Response) {
	if (!req.query.type) {
		res.status(400).json({errorMsg: "no 'type' parameter was specified!", data: null})
		return
	}
	const sharedResource = await getSharedResourceContentDetails(req.params.shareId, req.session.userId as string, req.params.contentUri, req.query.type as "folder"|"file")
	if (!sharedResource) {
		return res.status(404).json({errorMsg: "Shared Resource was not found!", msg: null, data: null})
	}
	const {details: resource, targetContentUri} = sharedResource
	
	if (resource.excludedEntriesUris.includes(targetContentUri)) {
		res.status(403).json({errorMsg: "You don't have access to this resource", msg: null, data: null})
		return;
	}else if (req.query.type === "file"){
		const {fileStream, status, msg, aesDecipher} = await getFileStream(targetContentUri, resource.grantorId as string)
		if (!fileStream){
			res.status(status).json({errorMsg: msg, msg: null, data:  null});
		}else if (fileStream && aesDecipher)
			fileStream.pipe(aesDecipher).pipe(res) // stream the file to the http response as it is being decrypted 
		else 
			res.status(500).json({errorMsg: "Something went wrong but it's not your fault", msg: null, data:  null})
	}else if (req.query.type === "folder") {
		// get the metadata of all shared files or folder nested inside the shared folder
		const responseData = await dbClient.sharedContent.getSharedFolderData(targetContentUri, resource.excludedEntriesUris)
		res.status(200).json({data: responseData, msg: null, errorMsg: null})
	}
}

/** Gets the meta data of a shared file/folder using the shared resource shareId 
 * @param {Request} req - http Request object
 * @param {Response} res - http Response object
 * @param {string} req.session.userId - id of the currently logged in user
 * @param {string} req.params.shareId - _id of the shared resource in the shared resource collection */
export async function sharedFileMetaDataReqdHandler(req: Request, res: Response) {
	const resource = await dbClient.sharedContent.getSharedResourceDetails(req.params.shareId, req.session.userId as string)

	if (!resource) {
		res.status(404).json({errorMsg: "Shared Resource was not found!", msg: null, data: null})
		return;
	}

	if (resource.resourceType === "file") {
		const fileDetails = await dbClient.files.getFileDetails(resource.grantedResourceUri, resource.grantorId as string)
		if (fileDetails)
			res.status(200).json({data: [fileDetails],  msg: null, errorMsg: null})
		else
			res.status(500).json({errorMsg: "Something went wrong", data: null, msg: null})
	}else {
		const folderDetails = await dbClient.folders.getFolderDetails(resource.grantedResourceUri, resource.grantorId as string)
		if (folderDetails)
			res.status(200).json({data: [folderDetails],  msg: null, errorMsg: null})
		else
			res.status(500).json({errorMsg: "Something went wrong", data: null, msg: null})

	}
}

/** Handles the download request for a shared file
 * @param {Request} req - http Request object
 * @param {Response} res - http Response object
 * @param {string} req.session.userId - session id of the currently logged in user
 * @param {string} req.params.shareId - _id of the shared resource in the shared resource collection 
 * @param {string} req.params.fileUri - uri of the file to download */
export async function sharedFileDownloadReqHandler(req: Request, res: Response) {
	const sharedResource = await getSharedResourceContentDetails(req.params.shareId, req.session.userId as string, req.params.fileUri, "file")
	if (!sharedResource)
		return res.status(404).json({errorMsg: "Shared Resource was not found!", msg: null, data: null})

	if (sharedResource.details.excludedEntriesUris.includes(sharedResource.targetContentUri))
		return res.status(403).json({errorMsg: "You don't have access to this resource", msg: null, data: null});
		
	const fileDetails = await dbClient.files.getFileDetails(req.params.fileUri, sharedResource.details.grantorId as string);

	if (!fileDetails){
		// this should be impossible but never say never
		console.log("Shared file requested for download suddenly disappears")
		return res.status(500).json({errorMsg: "Something went wrong", msg: null, data: null});
	}

	const user = await dbClient.users.getUserWithId(sharedResource.details.grantorId as string) as User;
	const key = scryptSync(user.password, 'notRandomSalt', 24) 
	const aesDecipher = createDecipheriv("aes-192-cbc", key, Buffer.from(fileDetails.iv, 'hex'))
	const fileStream = fs.createReadStream(`../uploads/${fileDetails.pathName}`)

	if (fileStream && aesDecipher) {
		res.attachment(fileDetails.name)
		res.set("Content-Length", fileDetails.size.toString())
		res.type(fileDetails.type)
		fileStream.pipe(aesDecipher).pipe(res) // the content is streamed to work around the delays of encryption
	}else 
		res.status(500).json({errorMsg: "Something went wrong but it's not your fault", msg: null, data:  null})
}


/** Handles a request for all files/folders shared by a user 
 * @param {Request} req - http Request object
 * @param {Response} res - http Response object
 * @param {string} req.session.userId - session id of the currently logged in user */
export async function UserSharedFilesDetailsReqHandler(req: Request, res: Response) {
	const sharedFileLinks = await dbClient.sharedContent.getUserSharedFiles(req.session.userId as string)
	if (sharedFileLinks) {
		res.status(200).json({data: sharedFileLinks})
	}else {
		res.status(500).json({msg: "Internal Server Error"})
	}
}

/** Handles a request to copy files and folders shared with the user. The user becomes the owner of the copied items
 * @param {Request} req - http Request object
 * @param {Response} res - http Response object
 * @param {string} req.session.userId - session id of the currently logged in user 
 * @param {string[]} req.body.copiedContentsUris - array of strings containing uris of the shared content to copy*/
export async function copySharedContentReqHandler(req: Request, res: Response) {
	if (!req.body.copiedContentsUris || req.body.copiedContentsUris.length === 0) {
		res.status(400).json({errorMsg: "No files to copy", data: null, })
		return
	}
	const destinationFolder = await dbClient.folders.getFolderDetails(req.body.targetFolderUri, req.session.userId as string)
	if (!destinationFolder) {
		res.status(400).json({errorMsg: "Bad Request! New Parent Folder doesn't exist", data: null, msg: null})
		return
	}
	const queryResponse = await dbClient.sharedContent.getContentToCopyDetails(req.body.shareId, req.body.copiedContentsUris, req.session.userId as string)
	if (queryResponse.status !== 200) {
		res.status(queryResponse.status).json(queryResponse.payload)
		return;
	}

	const filesStillBeingProcessed = {current: 0}

	// Dictionary mapping a folder's uri to an array of it's direct children
	let copiedContentDict = generateCopiedContentDict(queryResponse.payload.data!.folders, queryResponse.payload.data!.files);

	// change the attributes of the data to copy as needed
	modifyCopiedSharedContent(copiedContentDict, queryResponse.payload.data!.srcFolderUri, req.body.targetFolderUri, req.session.userId as string)
	const allCopiedFilesData: FileData[] = [];
	const allCopiedFoldersData: Folder[] = [];
	const copiedFilesDiskData:CopiedNestedFileData[] = []

	for (let key in copiedContentDict) {
		copiedContentDict[key].forEach(content => {
			if (content.type === "folder") {
				allCopiedFoldersData.push(content as Folder)
			}else {
				const {newPathName, oldIv, ...fileDetails} = content as CopiedNestedFileData
				copiedFilesDiskData.push(content as CopiedNestedFileData)
				fileDetails.pathName = newPathName as string
				allCopiedFilesData.push(fileDetails)
			}
		})
	}
	filesStillBeingProcessed.current = copiedFilesDiskData.length;

	function sharedFileCopyComplete() {
		filesStillBeingProcessed.current--;
		if (filesStillBeingProcessed.current === 0) {
			res.status(200).json({msg: "successful!", errorMsg: null, data: null})
		}
	}

	const user = await dbClient.users.getUserWithId(req.session.userId as string) as User // what if the user logs in somewhere else and deletes her account b4 this hits the db
	const querySuccessful = await dbClient.content.insertCopiedResources(allCopiedFilesData, allCopiedFoldersData, user) // store the new copied files details in the db 

	if (querySuccessful) {
		if (copiedFilesDiskData.length > 0) {
			// todo: probably put this in a try-catch block and reverse changes incase something goes wrong
			copySharedFilesOnDisk(copiedFilesDiskData, user, queryResponse.payload.data!.originalOwner, sharedFileCopyComplete)
		}
	}else {
		res.status(500).json({msg: "", errorMsg: "Internal Server Error. Not your fault though", data: null})
	}

}

