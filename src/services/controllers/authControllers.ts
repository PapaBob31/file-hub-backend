import { type Request, type Response } from "express";
import dbClient from "../db/client.js"
// import escapeHtml from "escape-html"
import Tokens from "csrf"


/** Authenticates a user and sends back a csrf token in the response body if the user was authenticated successfully 
 @param {string} req.session.userId - userId of the user in the current session */
export async function authHandler(req: Request, res: Response) {
	const user = await dbClient.users.getUserWithId(req.session.userId as string)
	if (user) {
		const tokens = new Tokens()
		res.status(200).json({data: {...user, csrfToken: tokens.create(req.session.csrfSecret as string)}, errorMsg: null, msg: null})
	}else {
		res.status(401).json({errorMsg: "Invalid Request! Unauthenticated User!", data: {username: null}, msg: null})
	}
}


/** Handles a request to login a User 
 * @param {string} req.body.email - User's email
 * @param {string} req.body.password - User's password*/
export async function loginHandler(req: Request, res: Response) {
	if (!req.body || !req.body.password || !req.body.email) {
		res.status(401).json({errorMsg: "Invalid login details", data: {username: null}, msg: null} );
		return;
	}
	const user = await dbClient.users.loginUser(req.body);
	if (user) {
		// generate a new csrf token
		const tokens = new Tokens()
		req.session.userId = user._id as string
		req.session.csrfSecret = tokens.secretSync()
		res.status(200).json({data: {...user, csrfToken: tokens.create(req.session.csrfSecret as string)}, errorMsg: null, msg: "success"})
	}else res.status(401).json({errorMsg: "Invalid login details", data: {username: null}, msg: null});
}

/** Handles a request to register a new User
 * @param {Object} req.body - {username: string, email: string, password: string, passwordExtraCheck: string}*/
export async function signupHandler(req: Request, res: Response) {
	console.log(req.body)
	if (!req.body.username.trim() || !req.body.email.trim()) {
		res.status(400).json({errorMsg: {general: "Invalid request body"}, data: null, msg: null});
	}else if (req.body.username.length > 100 || req.body.email > 100) {
		res.status(400).json({errorMsg: {general: "Invalid Request body fields. Username or Email length is longer than 100 characters"}, data: null, msg: null});
	}else if ((/[?\[\]+.^<>\*&%@!~#|`'",=\-/\\{}();:]/).test(req.body.username)) {
		res.status(400).json({errorMsg: {username: "Invalid Username field. The only punctuation allowed in a username is the underscore"}, data: null, msg: null}); 
	}else if (!req.body.password || req.body.password !== req.body.passwordExtraCheck || req.body.password.length < 10) {
		res.status(400).json({errorMsg: {password: "Invalid password fields"}, data: null, msg: null});
	}else {
		const {status, msg, errorMsg} = await dbClient.users.createNewUser(req.body);
		res.status(status).json({msg, errorMsg, data: null})
	}
}

/** Handles a request to end the user's session i.e. log the user out*/
export async function sessionEndReqHandler(req: Request, res: Response) {
	req.session.destroy((err) => {
		if (err) {
			console.log(err)
			res.status(500).json({msg: null, errorMsg: "Something went wrong! Not your fault tho!", data: null})
		}else
			res.status(200).json({msg: "Logout successful!", errormsg: null, data: null})
	})
}

/** Handles a request to delete the currently logged in user's acocunt */
export async function deleteUserReqHandler(req: Request, res: Response) {
	let {status, errorMsg, msg, data} = await dbClient.users.deleteUserData(req.session.userId as string);
	if (status === 200) {
		req.session.destroy((err) => {
			if (err) {
				console.log(err) // todo: indicate that the error occured while trying to delete user session
				status = 500; 
				errorMsg = "Something went wrong! Not your fault tho!"; 
				msg = null
				data =  null
			}
		})
	}
	res.status(status).json({data, errorMsg, msg})
}