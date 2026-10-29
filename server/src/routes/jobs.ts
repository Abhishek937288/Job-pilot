import { Router } from "express";
import { updateJobSchema } from "@jobpilot/shared";
import { jobMatchDto, searchRunDto } from "../db/dto.js";
import { scoped } from "../db/scoped.js";
import { notFound } from "../lib/errors.js";
import { currentUser } from "../middleware/auth.js";
import { parseOr400 } from "../middleware/errors.js";

export const jobsRouter = Router();

/** Done and delete are status changes, never row deletion, so the job never comes back on a re-run. */
jobsRouter.patch("/jobs/:id", async (req, res) => {
  const user = currentUser(req);
  const { status } = parseOr400(updateJobSchema, req.body);
  const job = await scoped(user._id).jobMatch(req.params.id);
  if (!job) throw notFound("Job not found");
  const now = new Date();
  job.status = status;
  job.doneAt = status === "done" ? now : null;
  job.deletedAt = status === "deleted" ? now : null;
  await job.save();
  res.json(jobMatchDto(job));
});

jobsRouter.get("/runs/:id", async (req, res) => {
  const run = await scoped(currentUser(req)._id).run(req.params.id);
  if (!run) throw notFound("Run not found");
  res.json(searchRunDto(run));
});
