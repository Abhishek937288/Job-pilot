import { Router } from "express";
import { isValidObjectId } from "mongoose";
import { createCompanySchema } from "@jobpilot/shared";
import { companyDto } from "../db/dto.js";
import { Company } from "../db/models/company.js";
import { HttpError, notFound } from "../lib/errors.js";
import { currentUser, requireAccount } from "../middleware/auth.js";
import { parseOr400 } from "../middleware/errors.js";
import { enqueueCompanyRefresh } from "../queue/queues.js";
import { createCompany, deleteCompany } from "../watchlist/companies.js";

/** The shared company watchlist. Anyone signed in can read it; only accounts can change it. */
export const companiesRouter = Router();

companiesRouter.get("/", async (req, res) => {
  const uid = String(currentUser(req)._id);
  const companies = await Company.find().sort({ name: 1 }).limit(1000);
  res.json(companies.map((c) => companyDto(c, uid)));
});

companiesRouter.post("/", requireAccount, async (req, res) => {
  const user = currentUser(req);
  const company = await createCompany(parseOr400(createCompanySchema, req.body), user._id);
  await enqueueCompanyRefresh(String(company._id));
  res.status(201).json(companyDto(company, String(user._id)));
});

companiesRouter.post("/:id/refresh", requireAccount, async (req, res) => {
  if (!isValidObjectId(req.params.id) || !(await Company.exists({ _id: req.params.id }))) throw notFound("Company not found");
  await enqueueCompanyRefresh(String(req.params.id));
  res.status(202).json({ queued: true });
});

companiesRouter.delete("/:id", requireAccount, async (req, res) => {
  const user = currentUser(req);
  const company = isValidObjectId(req.params.id) ? await Company.findById(req.params.id) : null;
  if (!company) throw notFound("Company not found");
  if (!company.addedBy || String(company.addedBy) !== String(user._id)) throw new HttpError(403, "Only the person who added this company can remove it");
  await deleteCompany(company);
  res.status(204).end();
});
