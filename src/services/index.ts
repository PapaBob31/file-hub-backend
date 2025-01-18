
// TODO: uninstall all unused packages
import express from "express"
import cookieParser from "cookie-parser";
import {setCorsHeaders, logRequestDetails, authenticateUser, loginSession, checkForCSRF } from "./middlewares/index.js";
import router from "./routes/index.js"
import {htmlFileReqHandler} from "./controllers/index.js"

const app = express()
const portNo = 7200;


app.use(loginSession)
app.use(cookieParser())
app.use(logRequestDetails)
app.use(express.static("../static"))
app.use("/services", setCorsHeaders, authenticateUser, checkForCSRF)
app.use(express.json())
app.use('/services', router);
app.all("/*", htmlFileReqHandler)


console.log(`listening on port: ${portNo}`)
app.listen(portNo);
