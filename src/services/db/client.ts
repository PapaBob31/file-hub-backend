import { MongoClient } from "mongodb";
import FilesDAO from "./files.js"
import FoldersDAO from "./folders.js"
import ContentDAO from "./content.js"
import UsersDAO from "./users.js"
import SharedContentDAO from "./sharedResources.js"


// todo: find a way to implement schema validation and a better way to manage the connections,
// and when exactly do I call the close method?
// implement constraints
// project all the fields that's actually needed on the frontend
// close all freaking cursors
// INDEXES
// Can we say the promise rejects with null

/** Class that contains methods for getting data from the db */

class DbClient {
	#client;
	#dataBase;
	users;
	folders;
	files;
	sharedContent;
	content

	constructor(connectionURI: string) {
		this.#client = new MongoClient(connectionURI);
		this.#dataBase = this.#client.db("fylo");
		this.users =  new UsersDAO(this.#dataBase);
		this.folders = new FoldersDAO(this.#dataBase);
		this.files = new FilesDAO(this.#dataBase);
		this.content = new ContentDAO(this.#dataBase, this.#client);
		this.sharedContent =  new SharedContentDAO(this.#dataBase);
	}

	getMongoClient() {
		return this.#client;
	}
	
}


const connectionStr = process.env.DB_CONNECTION_STRING as string;
const dbClient = new DbClient(connectionStr)
export const sessionStoreClient = dbClient.getMongoClient()
export default dbClient;
