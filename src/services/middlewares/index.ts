import {Response, Request} from "express";
import dbClient, { sessionStoreClient } from "../db/client.js"
import session from "express-session"
import MongoStore from "connect-mongo"
import Tokens from "csrf"

const sessionSecretArray = JSON.parse(process.env.SESSION_SECRET as string) as string[]
let hasHttps = true
if (process.env.MODE === "development") {
	hasHttps = false
}

// session managing middleware
export const loginSession = session({
	name: 'sessionId',
	secret: sessionSecretArray,
	saveUninitialized: false,
	resave: false,
	rolling: true,
	store: MongoStore.create({client: sessionStoreClient, dbName: process.env.DBNAME}),
	cookie: {httpOnly: true, secure: hasHttps, sameSite: "strict", maxAge: 6.048e8} // check default values when you have time
})


export function setCorsHeaders(req: Request, res: Response, next: ()=>any):void {
	res.set("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN)
	res.set("Access-Control-Allow-Headers", "Content-Type, X-local-name, X-file-hash, X-resume-upload, X-file-vault-csrf-token")
	res.set("Access-Control-Max-Age", "86400");	// 24 hours, should change later
	res.set("Access-Control-Allow-Credentials", "true");
	res.set("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
	if (req.method === "OPTIONS") {
		res.status(204).send()
	}else next()
}

// user authentication middleware
export async function authenticateUser(req: Request, res: Response, next: ()=>void) {
	// these routes do not need authentication
	const excludedEndpoints = ["/services/login", "/services/signup", "/services/auth-user-details"];
	if (excludedEndpoints.includes(req.originalUrl)) {
		next()
		return;
	}
	if (!req.session.userId) { // there's no currently logged in user
		res.status(401).json({errorMsg: "Unauthenticated! Pls login", msg: null, data: null});
		return
	}
	const user = await dbClient.users.getUserWithId(req.session.userId)
	if (user){ // there's a logged in user but somehow we can't find their data
		next()
	}else {
		res.status(401).json({errorMsg: "Unauthorised! Pls login"});
	}
}

// This middleware ensures requests have the proper csrf headers
export async function checkForCSRF(req: Request, res: Response, next: ()=>void) {
	const excludedEndpoints = ["/services/login", "/services/signup", "/services/auth-user-details"];
	const tokens = new Tokens()

	if (excludedEndpoints.includes(req.originalUrl) || req.method === "GET") {
		next()
	}else if (!tokens.verify(req.session.csrfSecret as string, req.headers["x-file-vault-csrf-token"] as string)) {
		// request doesn't have the proper CSRF header
		res.status(400).json({msg: "Invalid request!"})
		req.destroy()
	}else {
		next()
	}
}