
// TODO: uninstall all unused packages
import express, {Response, Request}  from "express"
import cookieParser from "cookie-parser";
import {setCorsHeaders, authenticateUser, loginSession, checkForCSRF } from "./middlewares/index.js";
import router from "./routes/index.js"
import {htmlFileReqHandler} from "./controllers/dataControllers.js"
import loggerFunc from "pino-http";
import compression from "compression"

const app = express()
const portNo = 7200;

// prevents the express.json middleware from parsing an uploaded json file with content-type of 'application/json'
function parseOnlyIfJsonRequest(req: Request, res: Response, next: ()=>void) {
	if (!req.headers['x-local-name']) { // request is a file upload
		express.json({limit: "1000kb"})(req, res, next);
	}else next()
}


app.use(loggerFunc.default({
	quietResLogger: true,
	customSuccessMessage: function(_req, res) {
		return `${res.statusCode}`
	},
	customReceivedMessage: function (req, _res) {
		return `${req.method} ${req.originalUrl}`
	},
	redact: {paths: ["req", "res"], remove: true}
}))
app.use(compression())
app.use(loginSession)
app.use(cookieParser())
app.use(express.static("../static"))
app.use("/services", setCorsHeaders, authenticateUser, checkForCSRF) // is this cors middleware proper?
app.use("/services", parseOnlyIfJsonRequest, router)
app.all("/*", htmlFileReqHandler)


console.log(`listening on port: ${portNo}`)
app.listen(portNo);
