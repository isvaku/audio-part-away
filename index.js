"use strict";
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
var _a, _b, _c, _d;
Object.defineProperty(exports, "__esModule", { value: true });
var chokidar = require("chokidar");
// @ts-ignore
var ffmpeg = require("fluent-ffmpeg");
var fs_1 = require("fs");
require("dotenv/config");
var client_s3_1 = require("@aws-sdk/client-s3");
var client_transcribe_1 = require("@aws-sdk/client-transcribe");
var docx_1 = require("docx");
var validFormats = ["mp4", "mkv", "mov"];
var accessKeyId = (_a = process.env.AWS_ACCESS_KEY) !== null && _a !== void 0 ? _a : "";
var secretAccessKey = (_b = process.env.AWS_SECRET_KEY) !== null && _b !== void 0 ? _b : "";
var bucketName = (_c = process.env.AWS_BUCKET_NAME) !== null && _c !== void 0 ? _c : "";
var region = (_d = process.env.AWS_BUCKET_REGION) !== null && _d !== void 0 ? _d : "";
var transcribeClient = new client_transcribe_1.TranscribeClient({
    region: region,
    credentials: { accessKeyId: accessKeyId, secretAccessKey: secretAccessKey },
});
var watcher = chokidar.watch("./assets", {
    ignored: /(^|[\/\\])\../,
    persistent: true,
    alwaysStat: false,
    ignoreInitial: true,
});
var regex = /\n\s*\n/g;
var table = new docx_1.Table({
    rows: [
        new docx_1.TableRow({
            children: [
                new docx_1.TableCell({
                    children: [new docx_1.Paragraph("Hello")],
                }),
                new docx_1.TableCell({
                    children: [],
                }),
            ],
        }),
        new docx_1.TableRow({
            children: [
                new docx_1.TableCell({
                    children: [],
                }),
                new docx_1.TableCell({
                    children: [new docx_1.Paragraph("World")],
                }),
            ],
        }),
    ],
});
var doc = new docx_1.Document({
    sections: [
        {
            children: [table],
        },
    ],
});
docx_1.Packer.toBuffer(doc).then(function (buffer) {
    (0, fs_1.writeFileSync)("My Document.docx", buffer);
});
watcher
    .on("ready", function () { return console.log("Initial scan complete. Ready for changes"); })
    .on("add", function (path) { return __awaiter(void 0, void 0, void 0, function () {
    var baseFolder, filename, mp3Filename;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                console.log("File ".concat(path, " has been added"));
                if (!validFormats.some(function (format) { return path.includes(format); })) {
                    console.error("Not a valid video format");
                    return [2 /*return*/];
                }
                baseFolder = path.split("\\")[0];
                filename = path.split("\\")[1].split(".")[0];
                mp3Filename = "".concat(filename, ".mp3");
                return [4 /*yield*/, waitForFileAvailable(path)];
            case 1:
                _a.sent();
                ffmpeg(path)
                    .addOption("-q:a", "0")
                    .addOption("-map", "a")
                    .on("start", function (commandLine) {
                    console.log("FFmpeg Command:" + commandLine);
                })
                    .on("error", function (err, stdout, stderr) {
                    console.log("An error occurred: " + err.message);
                })
                    .on("end", function (stdout, stderr) {
                    return __awaiter(this, void 0, void 0, function () {
                        var transcriptionJob;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0: return [4 /*yield*/, uploadFileToS3("".concat(baseFolder, "/").concat(mp3Filename), mp3Filename)];
                                case 1:
                                    _a.sent();
                                    return [4 /*yield*/, createTranscriptionJob({
                                            TranscriptionJobName: "".concat(filename.replace(/\s+/g, "-"), "-transcription-job-").concat(Date.now().toString()),
                                            LanguageCode: "es-US",
                                            MediaFormat: "mp3",
                                            Media: {
                                                MediaFileUri: "s3://audio-transcription-bucket-j/".concat(mp3Filename),
                                            },
                                            OutputBucketName: bucketName,
                                            Subtitles: { Formats: ["srt"] },
                                        })];
                                case 2:
                                    transcriptionJob = _a.sent();
                                    return [2 /*return*/];
                            }
                        });
                    });
                })
                    .saveToFile("assets/".concat(mp3Filename));
                return [2 /*return*/];
        }
    });
}); });
function waitForFileAvailable(filePath) {
    return new Promise(function (resolve) {
        var checkInterval = setInterval(function () {
            try {
                // Try to open the file in write mode. If it succeeds, the file is no longer in use.
                (0, fs_1.open)(filePath, "r", function (err, fd) {
                    if (!err) {
                        clearInterval(checkInterval);
                        (0, fs_1.close)(fd, function (err) {
                            if (err)
                                throw err;
                        });
                        resolve();
                    }
                });
            }
            catch (error) {
                console.log("File ".concat(filePath, " is still in use"));
                // Handle error, e.g., file not found
            }
        }, 1000);
    });
}
function uploadFileToS3(path, filename) {
    return __awaiter(this, void 0, void 0, function () {
        var s3Client, fileContent, params, command, response, err_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    s3Client = new client_s3_1.S3Client({
                        region: region,
                        credentials: { accessKeyId: accessKeyId, secretAccessKey: secretAccessKey },
                    });
                    fileContent = (0, fs_1.readFileSync)(path);
                    params = {
                        Bucket: bucketName,
                        Key: filename,
                        Body: fileContent,
                    };
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    command = new client_s3_1.PutObjectCommand(params);
                    return [4 /*yield*/, s3Client.send(command)];
                case 2:
                    response = _a.sent();
                    console.log("File uploaded successfully:", response);
                    return [2 /*return*/, response];
                case 3:
                    err_1 = _a.sent();
                    console.error("Error uploading file:", err_1);
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/];
            }
        });
    });
}
function createTranscriptionJob(params) {
    return __awaiter(this, void 0, void 0, function () {
        var data, err_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, transcribeClient.send(new client_transcribe_1.StartTranscriptionJobCommand(params))];
                case 1:
                    data = _a.sent();
                    console.log("Success - put", data);
                    return [2 /*return*/, data]; // For unit tests.
                case 2:
                    err_2 = _a.sent();
                    console.log("Error", err_2);
                    return [3 /*break*/, 3];
                case 3: return [2 /*return*/];
            }
        });
    });
}
// TODO: Create XLSX from result
function createXLSX(data) {
    console.log(data);
}
function curate(data) {
    var rawData = data.split(regex);
    return rawData.map(function (item) {
        var _a = item.split("\n"), id = _a[0], time = _a[1], rest = _a.slice(2);
        return { id: id, time: time, text: rest.join("\n") };
    });
}
