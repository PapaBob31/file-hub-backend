import {Response, Request} from "express";
import dbClient from "../db/client"

export function setCorsHeaders(req: Request, res: Response, next: ()=>any):void {
	res.set("Access-Control-Allow-Origin", "http://localhost:5178")
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

	const user = await dbClient.getUserWithId(req.cookies.userId)
	if (user){
		next()
	}else {
		res.status(401).json({errorMsg: "Unauthorised! Pls login"});
	}
}