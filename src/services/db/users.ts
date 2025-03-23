import { ObjectId, type Db } from "mongodb";
import { scryptSync, randomBytes } from "node:crypto"
import { nanoid } from "nanoid"
import FoldersDAO from "./folders.js"
import fsPromises from "fs/promises"
import { type FileData } from "./files.js"
import { type Folder } from "./folders.js"
import escape from "escape-html"

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

interface UserCreationErrors {
	password: string,
	general: string,
	username: string,
	email: string
}


/** Users Collection Data Access object*/
export default class UsersDAO  {
	#db;
	constructor(db: Db) {
		this.#db = db;
	}

	/** Creates a new user data in the db
	 * @param {userData} User - data of the user to be created*/
	async createNewUser(userData: User): Promise<{status: number, msg: string|null, errorMsg: UserCreationErrors|null}> {
		const users = await this.#db.collection("users");

		try {
			let duplicateEmailError = ""
			let duplicateUsernameError = ""
			const existingEmail = await users.findOne({email: {$regex: userData.email, $options: "i"}})
			if (existingEmail)
				duplicateEmailError += "Email already in use. Emails are case-insensitive"

			const exisitingUsername = await users.findOne({username: {$regex: userData.username, $options: "i"}})
			if (exisitingUsername)
				duplicateUsernameError += "Username already in use. Usernames are case-insensitive"
			if (existingEmail || exisitingUsername)
				return {status: 400, errorMsg: {password: "", general:"", username: duplicateUsernameError, email: duplicateEmailError}, msg: null}

			const homeFolderUri = nanoid();
			const uniqueSalt = randomBytes(32).toString('hex');
			const passwordHash = scryptSync(userData.password, uniqueSalt, 64, {N: 8192, p: 10}).toString('hex')
			const queryResult = await users.insertOne({
				username: escape(userData.username),
				email: escape(userData.email),
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
			const folders = new FoldersDAO(this.#db)
			const queryResult2 = await folders.createNewFolderEntry({
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
		const users = this.#db.collection("users")
		let user = null
		try {
			user = await users.findOne<User>({email: escape(loginData.email)})
			if (!user)
				throw new Error("User doesn't esist!")
			if (user.password !== scryptSync(loginData.password, user.salt, 64, {N: 8192, p: 10}).toString('hex'))
				throw new Error("Invalid password")
		}catch(err) {
			user = null
		}
		return user;
	}

	/** Updates the total storage (in bytes) used by a user's uploaded files on the server
	 * @param {string} userId - id of the user whose used storage is to be update
	 * @param {number} storageModification - positive or negative integer. Number of bytes to be added to the user's storage*/
	async updateUsedUserStorage(userId: string, storageModification: number) {
		const users = this.#db.collection("users")
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

	// Gets a user's data from the db through an `id` and returns the data
	async getUserWithId(id: string) {
		const users = this.#db.collection("users")
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

	// deletes a user's data
	async deleteUserData(userId: string) {
		const users = this.#db.collection<User>("users")
		const files = this.#db.collection<FileData>("uploaded_files");
		const folders = this.#db.collection<Folder>("folders");
		const sharedFiles = await this.#db.collection<FileData>("shared_files")

		try {
			const userFilesPaths = await files.aggregate([
										{$match: {userId: new ObjectId(userId)}},
										{$project: {pathName: 1}}
									]).toArray()
			await files.deleteMany({userId: new ObjectId(userId)})
			await folders.deleteMany({userId: new ObjectId(userId)})
			await sharedFiles.deleteMany({grantorId: new ObjectId(userId)})
			// delete all it's uploaded files from disk
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


