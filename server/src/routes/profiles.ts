import { Router } from "express";
import multer from "multer";
import { createProfileFieldsSchema, exportQuerySchema, listJobsQuerySchema, updateProfileSchema, type CreateProfileResponse } from "@jobpilot/shared";
import { env } from "../config/env.js";
import { jobMatchDto, profileDto, searchRunDto } from "../db/dto.js";
import { JobMatch } from "../db/models/jobMatch.js";
import { scoped } from "../db/scoped.js";
import { HttpError, notFound } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { streamExport } from "../export/export.js";
import { currentUser } from "../middleware/auth.js";
import { parseOr400 } from "../middleware/errors.js";
import { expensiveLimiter } from "../middleware/security.js";
import { ALLOWED_MIME } from "../resume/extractText.js";
import { createProfile, startSearchRun, updateProfile } from "../services/profiles.js";

export const profilesRouter = Router();

/** In memory only: the file never touches disk and is dropped after text extraction. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Math.min(env.MAX_UPLOAD_MB, 10) * 1024 * 1024, files: 1, fields: 10, fieldSize: 20_000 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME[file.mimetype]) cb(null, true);
    else cb(new HttpError(415, "Only PDF and DOCX files are supported"));
  },
});

async function ownedProfile(userId: Parameters<typeof scoped>[0], id: string) {
  const profile = await scoped(userId).profile(id);
  if (!profile) throw notFound("Profile not found");
  return profile;
}

profilesRouter.get("/", async (req, res) => {
  const repo = scoped(currentUser(req)._id);
  const profiles = await repo.profiles();
  const counts = await repo.jobCounts(profiles.map((p) => p._id));
  res.json(profiles.map((p) => profileDto(p, counts.get(String(p._id)))));
});

profilesRouter.post("/", expensiveLimiter, upload.single("file"), async (req, res) => {
  const user = currentUser(req);
  if (!req.file) throw new HttpError(400, "Attach a resume file (PDF or DOCX) as `file`");
  const fields = parseOr400(createProfileFieldsSchema, req.body);
  const { profile, run } = await createProfile(user, req.file, { preferences: fields.preferences, label: fields.label });
  logger.info({ userId: String(user._id), profileId: String(profile._id), method: profile.extraction?.method }, "profile created");
  res.status(201).json({ profile: profileDto(profile), run: searchRunDto(run) } satisfies CreateProfileResponse);
});

profilesRouter.get("/:id", async (req, res) => {
  const user = currentUser(req);
  const profile = await ownedProfile(user._id, String(req.params.id));
  const counts = await scoped(user._id).jobCounts([profile._id]);
  res.json(profileDto(profile, counts.get(String(profile._id))));
});

profilesRouter.patch("/:id", async (req, res) => {
  const user = currentUser(req);
  const body = parseOr400(updateProfileSchema, req.body);
  const profile = await updateProfile(await ownedProfile(user._id, String(req.params.id)), body);
  const counts = await scoped(user._id).jobCounts([profile._id]);
  res.json(profileDto(profile, counts.get(String(profile._id))));
});

profilesRouter.delete("/:id", async (req, res) => {
  const user = currentUser(req);
  const profile = await ownedProfile(user._id, String(req.params.id));
  await scoped(user._id).deleteProfile(profile._id);
  logger.info({ userId: String(user._id), profileId: String(profile._id) }, "profile deleted");
  res.status(204).end();
});

profilesRouter.post("/:id/search", expensiveLimiter, async (req, res) => {
  const user = currentUser(req);
  const profile = await ownedProfile(user._id, String(req.params.id));
  const run = await startSearchRun(user, profile, "manual");
  res.status(202).json(searchRunDto(run));
});

profilesRouter.get("/:id/runs", async (req, res) => {
  const user = currentUser(req);
  const profile = await ownedProfile(user._id, String(req.params.id));
  res.json((await scoped(user._id).runs(profile._id)).map(searchRunDto));
});

profilesRouter.get("/:id/jobs", async (req, res) => {
  const user = currentUser(req);
  const q = parseOr400(listJobsQuerySchema, req.query);
  const profile = await ownedProfile(user._id, String(req.params.id));
  const jobs = await scoped(user._id).jobMatches(profile._id, { status: q.status, minScore: q.minScore }).limit(1000);
  res.json(jobs.map(jobMatchDto));
});

profilesRouter.get("/:id/export", async (req, res) => {
  const user = currentUser(req);
  const q = parseOr400(exportQuerySchema, req.query);
  const profile = await ownedProfile(user._id, String(req.params.id));
  const cursor = JobMatch.find({ userId: user._id, profileId: profile._id, status: q.status ?? { $ne: "deleted" } })
    .sort({ "match.score": -1, firstSeenAt: -1 })
    .cursor();
  const safeLabel = profile.label.replace(/[^\w.-]+/g, "_").slice(0, 60) || "jobs";
  await streamExport(res, q.format, `${safeLabel}-${q.status ?? "all"}`, cursor);
});
