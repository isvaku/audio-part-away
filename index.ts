import * as chokidar from "chokidar";
// @ts-ignore
import ffmpeg = require("fluent-ffmpeg");
import {
  open,
  close,
  readFileSync,
  writeFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
} from "fs";

import "dotenv/config";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import {
  GetTranscriptionJobCommand,
  StartTranscriptionJobCommand,
  StartTranscriptionJobCommandInput,
  TranscribeClient,
} from "@aws-sdk/client-transcribe";

import { Document, Packer, Paragraph, Table, TableCell, TableRow } from "docx";
import { Readable } from "stream";

const validFormats = ["mp4", "mkv", "mov"];

const AWSCredentials = {
  region: process.env.AWS_BUCKET_REGION ?? "",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY ?? "",
    secretAccessKey: process.env.AWS_SECRET_KEY ?? "",
  },
};
const bucketName = process.env.AWS_BUCKET_NAME ?? "";

const s3Client = new S3Client(AWSCredentials);
const transcribeClient = new TranscribeClient(AWSCredentials);

const watcher = chokidar.watch("./assets", {
  ignored: /(^|[\/\\])\../, // ignore dotfiles
  persistent: true,
  alwaysStat: false,
  ignoreInitial: true,
});

const regex = /\n\s*\n/g;

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
        const parsedFilename = filename.replace(/\s+/g, "-");
        const currentDate = Date.now().toString();
        const transcriptionKey = `transcripts/${parsedFilename}-transcription-${currentDate}/`;
        const transcriptionJob = await createTranscriptionJob({
          TranscriptionJobName: `${parsedFilename}-transcription-job-${currentDate}`,
          LanguageCode: "es-US",
          MediaFormat: "mp3",
          Media: {
            MediaFileUri: `s3://${bucketName}/audiofiles/${mp3Filename}`,
          },
          OutputBucketName: bucketName,
          OutputKey: transcriptionKey,
          Subtitles: { Formats: ["srt"] },
        });

        const transcriptionFilename = await getTranscriptionJobFilename(
          transcriptionJob?.TranscriptionJob?.TranscriptionJobName as string
        );

        const localTranscriptionPath = (await getS3Object(
          transcriptionFilename,
          transcriptionKey
        )) as string;
        await waitForFileAvailable(localTranscriptionPath);
        const transcription = readFileSync(localTranscriptionPath).toString();

        const doc = createDOCX(transcription);

        Packer.toBuffer(doc).then((buffer: string | NodeJS.ArrayBufferView) => {
          const docPath = "./assets/docs";
          const docFilePath = `${docPath}/transcript-${filename}-${currentDate}.docx`;
          if (!existsSync(docPath)) {
            mkdirSync(docPath, { recursive: true });
          }
          writeFileSync(docFilePath, buffer);
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
  const fileContent = readFileSync(path);
  const params = {
    Bucket: bucketName,
    Key: `audiofiles/${filename}`,
    Body: fileContent,
  };

  try {
    const command = new PutObjectCommand(params);
    const response = await s3Client.send(command);
    if (response.$metadata.httpStatusCode === 200) {
      console.log(`File ${filename} uploaded successfully:`);
    } else {
      console.error("Error uploading file:", response);
    }
    return response;
  } catch (err) {
    console.error("Error uploading file:", err);
  }
}

async function createTranscriptionJob(
  params: StartTranscriptionJobCommandInput
) {
  try {
    const transcriptionJobCommand = await transcribeClient.send(
      new StartTranscriptionJobCommand(params)
    );
    if (transcriptionJobCommand.$metadata.httpStatusCode === 200) {
      console.log(
        `Transcription job created: ${transcriptionJobCommand.TranscriptionJob?.TranscriptionJobName}`
      );
    } else {
      console.error("Error on transcription job: ", transcriptionJobCommand);
    }
    return transcriptionJobCommand;
  } catch (err) {
    console.log("Error creating transcription job: ", err);
  }
}

// TODO: Create XLSX from result
function createDOCX(data: string) {
  const curatedData = curateData(data);
  const rows = curatedData.map(({ time, text }) => {
    return new TableRow({
      children: [
        new TableCell({
          children: [new Paragraph(time)],
        }),
        new TableCell({
          children: [new Paragraph("")],
        }),
        new TableCell({
          children: [new Paragraph(text)],
        }),
        new TableCell({
          children: [new Paragraph("")],
        }),
        new TableCell({
          children: [new Paragraph("")],
        }),
      ],
    });
  });
  rows.unshift(
    new TableRow({
      children: [
        new TableCell({
          children: [new Paragraph("Minuto")],
        }),
        new TableCell({
          children: [new Paragraph("Terapeuta / Paciente")],
        }),
        new TableCell({
          children: [new Paragraph("Diálogo")],
        }),
        new TableCell({
          children: [new Paragraph("Auto observación")],
        }),
        new TableCell({
          children: [new Paragraph("Retroalimentación")],
        }),
      ],
      tableHeader: true,
    })
  );

  const table = new Table({
    rows,
  });

  const doc = new Document({
    sections: [
      {
        children: [table],
      },
    ],
  });

  return doc;
}

function curateData(data: string) {
  const rawData = data.split(regex);
  return rawData.map((item) => {
    const [, time, ...rest] = item.split("\n");
    return { time, text: rest.join("\n") };
  });
}

function getTranscriptionJobFilename(transcriptionJobName: string) {
  return new Promise<string>(function (resolve, reject) {
    const interval = setInterval(async () => {
      try {
        const transcriptionJobCommand = await transcribeClient.send(
          new GetTranscriptionJobCommand({
            TranscriptionJobName: transcriptionJobName,
          })
        );
        if (
          transcriptionJobCommand.TranscriptionJob?.TranscriptionJobStatus ===
          "COMPLETED"
        ) {
          const transcriptFileUri =
            transcriptionJobCommand.TranscriptionJob?.Subtitles?.SubtitleFileUris?.[0]
              ?.split("/")
              .pop() as string;
          console.log(
            `Transcription job: ${transcriptionJobName} finished successfully, transcript Key: ${transcriptFileUri}`
          );
          resolve(transcriptFileUri);
          clearInterval(interval);
        }

        if (
          transcriptionJobCommand.TranscriptionJob?.TranscriptionJobStatus ===
          "FAILED"
        ) {
          console.error(
            `Transcription job: ${transcriptionJobName} failed with reason: ${transcriptionJobCommand.TranscriptionJob?.FailureReason}`
          );
          reject(null);
          clearInterval(interval);
        }
      } catch (err) {
        console.log("Error consulting transcription job status: ", err);
      }
    }, 5000);
  });
}

async function getS3Object(filename: string, objectKey: string) {
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: `${objectKey}${filename}`,
  });

  const path = "./assets/transcripts";
  const filePath = `${path}/${filename}`;

  try {
    if (!existsSync(path)) {
      mkdirSync(path, { recursive: true });
    }
    const response = await s3Client.send(command);
    if (response.Body instanceof Readable) {
      let readableStream: Readable = response.Body as Readable;
      readableStream.pipe(createWriteStream(filePath));
    } else {
      console.error(`GetObjectCommand should return an
        internal.Readable object. Maybe the code is
        running in the Browser?`);
    }
    return filePath;
  } catch (err) {
    console.error(err);
  }
}
