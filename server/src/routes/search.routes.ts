import { addAtsCompanySchema, jobListQuerySchema, setJobStatusSchema, startSearchRunSchema } from "@jobpilot/shared";
import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../lib/http-error.js";
import { addAtsCompany, deleteAtsCompany, listAtsCompanies, updateAtsCompany } from "../services/ats-company.service.js";
import { getVisibleJobs, setJobStatus } from "../services/jobs.service.js";
import { createDraftRun, getCreditInfo, getLatestSearchRun, getSearchRun, startRun } from "../services/search-run.service.js";

const idParams = z.object({ id: z.string().min(1).max(64) });

export const searchRunRouter = Router();

searchRunRouter.get("/credits", async (_req, res) => {
  res.json(await getCreditInfo());
});

searchRunRouter.get("/latest", async (_req, res) => {
  const run = await getLatestSearchRun();
  if (!run) throw new HttpError(404, "NO_RUNS", "No searches yet");
  res.json(run);
});

/** Generates editable queries. Does not call Serper. */
searchRunRouter.post("/", async (_req, res) => {
  res.status(201).json(await createDraftRun());
});

searchRunRouter.get("/:id", async (req, res) => {
  res.json(await getSearchRun(idParams.parse(req.params).id));
});

/** Confirms the (edited) queries and starts spending credits. */
searchRunRouter.post("/:id/start", async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.status(202).json(await startRun(id, startSearchRunSchema.parse(req.body)));
});

export const jobsRouter = Router();

jobsRouter.get("/", async (req, res) => {
  res.json(await getVisibleJobs(jobListQuerySchema.parse(req.query)));
});

jobsRouter.patch("/:id/status", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const { status, notes } = setJobStatusSchema.parse(req.body);
  res.json(await setJobStatus(id, status, notes));
});

export const atsCompanyRouter = Router();

atsCompanyRouter.get("/", async (_req, res) => {
  res.json(await listAtsCompanies());
});

atsCompanyRouter.post("/", async (req, res) => {
  const { input, provider } = addAtsCompanySchema.parse(req.body);
  res.status(201).json(await addAtsCompany(input, provider));
});

atsCompanyRouter.patch("/:id", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const body = z.object({ enabled: z.boolean().optional(), displayName: z.string().trim().max(120).nullable().optional() }).parse(req.body);
  res.json(await updateAtsCompany(id, body));
});

atsCompanyRouter.delete("/:id", async (req, res) => {
  await deleteAtsCompany(idParams.parse(req.params).id);
  res.status(204).end();
});
