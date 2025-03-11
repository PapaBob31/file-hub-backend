
// TODO: uninstall all unused packages
import express, {Response, Request}  from "express"
import cookieParser from "cookie-parser";
import {setCorsHeaders, logRequestDetails, authenticateUser, loginSession, checkForCSRF } from "./middlewares/index.js";
import router from "./routes/index.js"
import {htmlFileReqHandler} from "./controllers/index.js"

const app = express()
const portNo = 7200;

// prevents the express.json middleware from parsing an uploaded json file with content-type of 'application/json'
function parseOnlyIfJsonRequest(req: Request, res: Response, next: ()=>void) {
	if (!req.headers['x-local-name']) { // request is a file upload
		express.json({limit: "1000kb"})(req, res, next);
	}else next()
}

app.use(loginSession)
app.use(cookieParser())
app.use(logRequestDetails)
app.use(express.static("../static"))
app.use("/services", setCorsHeaders, authenticateUser, checkForCSRF)
app.use("/services", parseOnlyIfJsonRequest, router)
app.all("/*", htmlFileReqHandler)


console.log(`listening on port: ${portNo}`)
app.listen(portNo);
