import {Response, Request} from "express";
import dbClient, { sessionStoreClient } from "../db/client"
import session from "express-session"
import MongoStore from "connect-mongo"


const sessionSecretArray = JSON.parse(process.env.SESSION_SECRET as string) as string[]
let hasHttps = true
if (process.env.MODE === "development") {
	hasHttps = false
}

export const loginSession = session({
	name: process.env.name + 'Id',
	secret: sessionSecretArray,
	saveUninitialized: false,
	resave: false,
	rolling: false,
	store: MongoStore.create({client: sessionStoreClient, dbName: process.env.DBNAME}),
	cookie: {httpOnly: true, secure: hasHttps, sameSite: "strict", maxAge: 6.048e8} // check default values when you have time
})


export function setCorsHeaders(req: Request, res: Response, next: ()=>any):void {
	res.set("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN)
	res.set("Access-Control-Allow-Headers", "Content-Type, X-local-name, X-file-hash, X-resume-upload")
	res.set("Access-Control-Max-Age", "86400");	// 24 hours, should change later
	res.set("Access-Control-Allow-Credentials", "true");
	res.set("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
	if (req.method === "OPTIONS") {
		res.status(204).send()
	}else next()
}

export function logRequestDetails(req: Request, _res: Response, next: ()=>void) {
	console.log(`${req.method} ${req.originalUrl}`)
	next()
}

export async function authenticateUser(req: Request, res: Response, next: ()=>void) {
	const excludedEndpoints = ["/login", "/signup", "/auth-user-details"];
	if (excludedEndpoints.includes(req.originalUrl)) {
		next()
		return;
	}

	const user = await dbClient.getUserWithId(req.session.userId) // learn declarative merging later to fix this ts bug
	if (user){
		next()
	}else {
		res.status(401).json({errorMsg: "Unauthorised! Pls login"});
	}
}