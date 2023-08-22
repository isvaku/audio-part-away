import * as chokidar from "chokidar";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import { open, close } from "fs";

import "dotenv/config";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  StartTranscriptionJobCommand,
  TranscribeClient,
} from "@aws-sdk/client-transcribe";

const validFormats = ["mp4", "mkv", "mov"];

const accessKeyId = process.env.AWS_ACCESS_KEY ?? "";
const secretAccessKey = process.env.AWS_SECRET_KEY ?? "";
const bucketName = process.env.AWS_BUCKET_NAME ?? "";
const region = process.env.AWS_BUCKET_REGION ?? "";

const transcribeClient = new TranscribeClient({
  region,
  credentials: { accessKeyId, secretAccessKey },
});

const watcher = chokidar.watch("./assets", {
  ignored: /(^|[\/\\])\../, // ignore dotfiles
  persistent: true,
  alwaysStat: false,
  ignoreInitial: true,
});

watcher
  .on("ready", () => console.log("Initial scan complete. Ready for changes"))
  .on("add", async (path) => {
    console.log(`File ${path} has been added`);
    if (!validFormats.some((format) => path.includes(format))) {
      console.error("Not a valid video format");
      return;
    }
    const baseFolder = path.split("\\")[0];

    const filename = path.split("\\")[1].split(".")[0];
    const mp3Filename = `${filename}.mp3`;
    await waitForFileAvailable(path);

    ffmpeg(path)
      .addOption("-q:a", "0")
      .addOption("-map", "a")
      .on("start", function (commandLine: string) {
        console.log("FFmpeg Command:" + commandLine);
      })
      .on(
        "error",
        function (err: { message: string }, stdout: any, stderr: any) {
          console.log("An error occurred: " + err.message);
        }
      )
      .on("end", async function (stdout: any, stderr: any) {
        await uploadFileToS3(`${baseFolder}/${mp3Filename}`, mp3Filename);
        await createTranscriptionJob({
          TranscriptionJobName: `${filename.replace(
            /\s+/g,
            "-"
          )}-transcription-job`,
          LanguageCode: "es-US",
          MediaFormat: "mp3",
          Media: {
            MediaFileUri: `s3://audio-transcription-bucket-j/${mp3Filename}`,
          },
          OutputBucketName: bucketName,
          Subtitles: { Formats: ["srt"] },
        });
      })
      .saveToFile(`assets/${mp3Filename}`);
  });

function waitForFileAvailable(filePath: string) {
  return new Promise<void>((resolve) => {
    const checkInterval = setInterval(() => {
      try {
        // Try to open the file in write mode. If it succeeds, the file is no longer in use.
        open(filePath, "r", (err, fd) => {
          if (!err) {
            clearInterval(checkInterval);
            close(fd, (err) => {
              if (err) throw err;
            });
            resolve();
          }
        });
      } catch (error) {
        console.log(`File ${filePath} is still in use`);
        // Handle error, e.g., file not found
      }
    }, 1000);
  });
}

async function uploadFileToS3(path: string, filename: string) {
  const s3Client = new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });

  // Lee el contenido del archivo
  const fileContent = fs.readFileSync(path);

  // Configura el comando para subir el archivo
  const params = {
    Bucket: bucketName,
    Key: filename,
    Body: fileContent,
  };

  // Sube el archivo a S3
  try {
    const command = new PutObjectCommand(params);
    const response = await s3Client.send(command);
    console.log("File uploaded successfully:", response);
    return response;
  } catch (err) {
    console.error("Error uploading file:", err);
  }
}

type TranscriptionJob = {
  TranscriptionJobName: string;
  LanguageCode: string;
  MediaFormat: string;
  Media: {
    MediaFileUri: string;
  };
  OutputBucketName: string;
  Subtitles: {
    Formats: string[];
  };
};

async function createTranscriptionJob(params: TranscriptionJob) {
  try {
    const data = await transcribeClient.send(
      new StartTranscriptionJobCommand(params)
    );
    console.log("Success - put", data);
    return data; // For unit tests.
  } catch (err) {
    console.log("Error", err);
  }
}
