import dbClient from "../db/client.js"
import {type FileData} from "../db/files.js"
import {type Folder} from "../db/folders.js"
import {type User} from "../db/users.js"
import { createDecipheriv, scryptSync } from "node:crypto"
import fs from "fs";

/** Creates a dictionary that maps a folder's Uri to an array of files/folders that are it's immediate childrem 
 * @param {Folder[]} folders - An Array of folders
 * @param {FileData[]} files - An array of files
 * @return {Object} - key value pairs*/
export function generateCopiedContentDict(folders: Folder[], files: FileData[]) {
  const objDict:{[key:string]: (FileData|Folder)[]} = {}
  for (let folder of folders) {
    if (!objDict[folder.parentFolderUri as string]) {
      objDict[folder.parentFolderUri as string] = [folder];
    }else {
      objDict[folder.parentFolderUri as string].push(folder)
    }
  }

  for (let file of files) {
    if (!objDict[file.parentFolderUri as string]) {
      objDict[file.parentFolderUri as string] = [file];
    }else {
      objDict[file.parentFolderUri as string].push(file)
    }
  }
  return objDict;
}

/** Creates an object whose attributes are a [number|null] status, 
 * a [string|null] msg, a fileStream and a DecipherIv object. These
 * attributes are derived from a file 
 * @param {string} fileUri - uri of the target
 * @returns {Object} - Object created */
export async function getFileStream(fileUri: string, userId: string) {
  const fileDetails = await dbClient.files.getFileDetails(fileUri, userId);
  if (!fileDetails){
    return {status: 404, msg: "File not found", fileStream: null, aesDecipher: null};
  }
  if (!fileDetails.type.startsWith("image/") && !fileDetails.type.startsWith("video/") && !fileDetails.type.startsWith("audio/")) {
    return {status: 400, msg: "Bad Request", fileStream: null, aesDecipher: null};
  }
  // todo: try and make every type of video supported on most browsers [start from firefox not supporting mkv]
  if (!fs.existsSync(`../uploads/${fileDetails.pathName}`)) {
    return {status: 404, msg: "File not found", fileStream: null, aesDecipher: null};
  }
  const user = await dbClient.users.getUserWithId(userId) as User;
  const key = scryptSync(user.password, 'notRandomSalt', 24)
  const aesDecipher = createDecipheriv("aes-192-cbc", key, Buffer.from(fileDetails.iv, 'hex'))
  // what if it doesn't return a file stream?
  const fileStream = fs.createReadStream(`../uploads/${fileDetails.pathName}`)
  return {status: null, msg: null, fileStream, aesDecipher, fileDetails};
}