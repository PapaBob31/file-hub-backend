
// TODO: uninstall all unused packages
import express from "express"
import cookieParser from "cookie-parser";
import {setCorsHeaders, logRequestDetails, authenticateUser, loginSession } from "./middlewares";
import router from "./routes"

const app = express()
const portNo = 7200;


app.use(loginSession)
app.use(cookieParser())
app.use(logRequestDetails, setCorsHeaders, authenticateUser)
app.use(express.json())
app.use('/', router);


console.log(`listening on port: ${portNo}`)
app.listen(portNo);
