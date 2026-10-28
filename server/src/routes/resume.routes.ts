import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { env } from "../config/env.js";
import { HttpError } from "../lib/http-error.js";
import { getLatestResume, getResume, ingestResume, reextractResume } from "../services/resume.service.js";

export const MAX_UPLOAD_BYTES = Math.floor(env.MAX_UPLOAD_MB * 1024 * 1024);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 0 },
});

const idParams = z.object({ id: z.string().min(1).max(64) });

export const resumeRouter = Router();

resumeRouter.post("/", upload.single("file"), async (req, res) => {
  if (!req.file) throw new HttpError(400, "NO_FILE", 'Attach the resume as multipart field "file"');
  const result = await ingestResume(req.file);
  res.status(result.duplicate ? 200 : 201).json(result);
});

resumeRouter.get("/latest", async (_req, res) => {
  const resume = await getLatestResume();
  if (!resume) throw new HttpError(404, "NO_RESUME", "No resume uploaded yet");
  res.json(resume);
});

resumeRouter.get("/:id", async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.json(await getResume(id));
});

resumeRouter.post("/:id/reextract", async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.status(202).json(await reextractResume(id));
});
