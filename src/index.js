var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var _this = this;
var express = require("express");
var app = express();
// TODO: uninstall all unused packages
var _a = require("mongodb"), MongoClient = _a.MongoClient, ObjectId = _a.ObjectId;
var fs = require("fs");
var path = require("node:path");
var cookieParser = require("cookie-parser");
var portNo = 7200;
var dbUri = "mongodb://127.0.0.1:27017/?directConnection=true&serverSelectionTimeoutMS=2000"; // search how to get connection string
function generateUrlSlug() {
    var alphanumeric = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ123456789';
    var urlSlug = '';
    for (var i = 0; i < 10; i++) {
        var randomIndex = Math.floor(Math.random() * alphanumeric.length);
        urlSlug += alphanumeric[randomIndex];
    }
    return urlSlug;
}
function getImageName(uri) {
    return __awaiter(this, void 0, void 0, function () {
        var name, client, dataBase, fileDetails, data, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    name = "";
                    client = new MongoClient(dbUri);
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 4, 5, 7]);
                    dataBase = client.db("fylo");
                    return [4 /*yield*/, dataBase.collection("uploaded_files")];
                case 2:
                    fileDetails = _a.sent();
                    return [4 /*yield*/, fileDetails.findOne({ uri: uri })];
                case 3:
                    data = _a.sent();
                    if (data && data.type.startsWith("image/"))
                        name = data.name;
                    return [3 /*break*/, 7];
                case 4:
                    error_1 = _a.sent();
                    console.log(error_1);
                    return [3 /*break*/, 7];
                case 5: return [4 /*yield*/, client.close()];
                case 6:
                    _a.sent();
                    return [7 /*endfinally*/];
                case 7: return [2 /*return*/, name];
            }
        });
    });
}
// Is it possible to create a partition to store possibly incomplete uploads for faster access in mongodb?
function storeFileDetails(data, userId) {
    return __awaiter(this, void 0, void 0, function () {
        var newDbRecords, client, database, fileDetails, error_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    client = new MongoClient(dbUri);
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 4, 5, 7]);
                    database = client.db('fylo');
                    return [4 /*yield*/, database.collection("uploaded_files")];
                case 2:
                    fileDetails = _a.sent();
                    newDbRecords = data.map(function (fileData) { return { name: fileData.name, uri: generateUrlSlug(), type: fileData.type, userId: new ObjectId(userId) }; });
                    return [4 /*yield*/, fileDetails.insertMany(newDbRecords)];
                case 3:
                    _a.sent();
                    return [3 /*break*/, 7];
                case 4:
                    error_2 = _a.sent();
                    console.log(error_2);
                    return [3 /*break*/, 7];
                case 5: return [4 /*yield*/, client.close()];
                case 6:
                    _a.sent();
                    return [7 /*endfinally*/];
                case 7: return [2 /*return*/, newDbRecords];
            }
        });
    });
}
function getFilesData(userId) {
    return __awaiter(this, void 0, void 0, function () {
        var data, client, dataBase, fileDetails, err_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    data = null;
                    client = new MongoClient(dbUri);
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 5, 6, 8]);
                    dataBase = client.db("fylo");
                    return [4 /*yield*/, dataBase.collection("uploaded_files")];
                case 2:
                    fileDetails = _a.sent();
                    return [4 /*yield*/, fileDetails.find({ userId: new ObjectId(userId) })];
                case 3:
                    data = _a.sent();
                    return [4 /*yield*/, data.toArray()];
                case 4:
                    data = _a.sent();
                    return [3 /*break*/, 8];
                case 5:
                    err_1 = _a.sent();
                    data = [];
                    console.log(err_1);
                    return [3 /*break*/, 8];
                case 6: return [4 /*yield*/, client.close()];
                case 7:
                    _a.sent();
                    return [7 /*endfinally*/];
                case 8: return [2 /*return*/, { data: data }];
            }
        });
    });
}
function createNewUser(userData) {
    return __awaiter(this, void 0, void 0, function () {
        var client, status, dataBase, users, existingUser, err_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    client = new MongoClient(dbUri);
                    status = "";
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 5, 6, 8]);
                    dataBase = client.db("fylo");
                    return [4 /*yield*/, dataBase.collection("users")];
                case 2:
                    users = _a.sent();
                    return [4 /*yield*/, users.findOne({ email: userData.email })];
                case 3:
                    existingUser = _a.sent();
                    if (existingUser)
                        throw new Error("Email already in use");
                    return [4 /*yield*/, users.insertOne({ email: userData.email, password: userData.password })];
                case 4:
                    _a.sent();
                    status = "success";
                    return [3 /*break*/, 8];
                case 5:
                    err_2 = _a.sent();
                    if (err_2.message === "Email already in use")
                        status = err_2.message;
                    else
                        status = "failure"; // todo: change this generic failure message to something like 'Email already in use'
                    return [3 /*break*/, 8];
                case 6: return [4 /*yield*/, client.close()];
                case 7:
                    _a.sent();
                    return [7 /*endfinally*/];
                case 8: return [2 /*return*/, status];
            }
        });
    });
}
function loginUser(userData) {
    return __awaiter(this, void 0, void 0, function () {
        var client, user, dataBase, users, err_3;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    client = new MongoClient(dbUri);
                    user = null;
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 4, 5, 7]);
                    dataBase = client.db("fylo");
                    return [4 /*yield*/, dataBase.collection("users")];
                case 2:
                    users = _a.sent();
                    return [4 /*yield*/, users.findOne({ email: userData.email, password: userData.password })];
                case 3:
                    user = _a.sent();
                    if (!user)
                        throw new Error("User doesn't esist!");
                    return [3 /*break*/, 7];
                case 4:
                    err_3 = _a.sent();
                    user = null;
                    return [3 /*break*/, 7];
                case 5: return [4 /*yield*/, client.close()];
                case 6:
                    _a.sent();
                    return [7 /*endfinally*/];
                case 7: return [2 /*return*/, user];
            }
        });
    });
}
function setCorsHeader(req, res, next) {
    res.set("Access-Control-Allow-Origin", "http://localhost:5178");
    res.set("Access-Control-Allow-Headers", "Content-Type, X-local-name");
    res.set("Access-Control-Max-Age", "86400"); // 24 hours, should change later
    res.set("Access-Control-Allow-Credentials", "true");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
    if (req.method === "OPTIONS") {
        res.status(204).send();
    }
    else
        next();
}
function logRequestDetails(req, res, next) {
    console.log("".concat(req.method, " ").concat(req.originalUrl));
    next();
}
app.use(cookieParser());
app.use(logRequestDetails, setCorsHeader);
app.use(express.json());
function writeToDisk(data) {
    data.forEach(function (fileData) {
        var fd = fs.openSync("./uploads/".concat(fileData.name), 'w');
        fs.writeSync(fd, fileData.file);
        fs.closeSync(fd);
    });
}
function userIdIsValid(id) {
    return __awaiter(this, void 0, void 0, function () {
        var client, user, dataBase, users, err_4;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!id) {
                        return [2 /*return*/, false];
                    }
                    client = new MongoClient(dbUri);
                    user = null;
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 5, , 7]);
                    dataBase = client.db("fylo");
                    return [4 /*yield*/, dataBase.collection("users")];
                case 2:
                    users = _a.sent();
                    return [4 /*yield*/, users.findOne({ _id: new ObjectId(id) })];
                case 3:
                    user = _a.sent();
                    return [4 /*yield*/, client.close()];
                case 4:
                    _a.sent();
                    if (!user)
                        return [2 /*return*/, false];
                    return [3 /*break*/, 7];
                case 5:
                    err_4 = _a.sent();
                    return [2 /*return*/, false];
                case 6:
                    _a.sent();
                    return [3 /*break*/, 7];
                case 7: return [2 /*return*/, true];
            }
        });
    });
}
function writeToFile(filename, data) {
    var fd = fs.openSync(filename, 'a');
    fs.writeSync(fd, data);
    fs.closeSync(fd);
}
app.post("/upload-files", function (req, res) { return __awaiter(_this, void 0, void 0, function () {
    var data, uploadedData_1;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, userIdIsValid(req.cookies.userId)];
            case 1:
                if (!!(_a.sent())) return [3 /*break*/, 2];
                res.status(401).json({ errorMsg: "Unauthorised! Pls login" });
                return [3 /*break*/, 4];
            case 2:
                data = { name: req.headers["x-local-name"], type: req.headers["content-type"] } // todo: check if mime type is present and stop saving files as their local name
                ;
                return [4 /*yield*/, storeFileDetails([data], req.cookies.userId)];
            case 3:
                uploadedData_1 = _a.sent();
                req.on('data', function (chunk) {
                    writeToFile("./uploads/" + req.headers["x-local-name"], chunk);
                });
                req.on('end', function () {
                    if (!req.complete) {
                        // mark as incomplete in db or something like that
                    }
                    else {
                        console.log(uploadedData_1[0]);
                        res.status(200).send(JSON.stringify(uploadedData_1[0]));
                    }
                });
                _a.label = 4;
            case 4: return [2 /*return*/];
        }
    });
}); });
app.get("/files-data", function (req, res) { return __awaiter(_this, void 0, void 0, function () {
    var responseData;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, userIdIsValid(req.cookies.userId)];
            case 1:
                if (!!(_a.sent())) return [3 /*break*/, 2];
                res.status(401).json({ errorMsg: "Unauthorised! Pls login" }); // unauthorised 401 or 403?
                return [3 /*break*/, 4];
            case 2: return [4 /*yield*/, getFilesData(req.cookies.userId)];
            case 3:
                responseData = _a.sent();
                res.status(200).json(responseData);
                _a.label = 4;
            case 4: return [2 /*return*/];
        }
    });
}); });
app.get("/images/:fileUrl", function (req, res) { return __awaiter(_this, void 0, void 0, function () {
    var imgName;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, getImageName(req.params.fileUrl)];
            case 1:
                imgName = _a.sent();
                if (!imgName) {
                    res.status(404).send("Image not found");
                    return [2 /*return*/];
                }
                if (!fs.existsSync(path.join(__dirname, 'uploads', imgName))) { // look into making it static later
                    res.status(404).send("Image not found");
                }
                res.status(200).sendFile(imgName, { root: path.join(__dirname, 'uploads') }, function (err) {
                    if (err) {
                        console.log(err);
                    }
                    else {
                        console.log("Sent:", imgName);
                    }
                });
                return [2 /*return*/];
        }
    });
}); });
app.post("/signup", function (req, res) { return __awaiter(_this, void 0, void 0, function () {
    var status;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                if (!req.body || !req.body.password || req.body.password !== req.body.passwordExtraCheck) {
                    return [2 /*return*/, res.status(400).json({ msg: "Invalid request body" })];
                }
                return [4 /*yield*/, createNewUser(req.body)];
            case 1:
                status = _a.sent();
                if (status === "success") {
                    return [2 /*return*/, res.status(201).json({ msg: "success" })];
                }
                else
                    return [2 /*return*/, res.status(500).json({ msg: "Internal Server Error" })];
                return [2 /*return*/];
        }
    });
}); });
app.post("/login", function (req, res) { return __awaiter(_this, void 0, void 0, function () {
    var user;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                if (!req.body || !req.body.password || !req.body.email) {
                    return [2 /*return*/, res.status(400).json({ error: "Invalid request body" })];
                }
                return [4 /*yield*/, loginUser(req.body)];
            case 1:
                user = _a.sent();
                if (user) {
                    // TODO: change and encrypt credentials
                    res.cookie('userId', user._id, { httpOnly: true, secure: true, sameSite: "Strict", maxAge: 6.04e8 }); // 7 days
                    return [2 /*return*/, res.status(200).json({ msg: "success", loggedInUserName: user.email })];
                }
                else
                    return [2 /*return*/, res.status(404).json({ msg: "User not found!" })];
                return [2 /*return*/];
        }
    });
}); });
console.log("listening on port: ".concat(portNo));
app.listen(portNo);
