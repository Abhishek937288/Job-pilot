import { profileDataSchema } from "@jobpilot/shared";
import { Router } from "express";
import { HttpError } from "../lib/http-error.js";
import { getActiveProfile, saveActiveProfile } from "../services/profile.service.js";

export const profileRouter = Router();

profileRouter.get("/", async (_req, res) => {
  const profile = await getActiveProfile();
  if (!profile) throw new HttpError(404, "NO_PROFILE", "No profile yet");
  res.json(profile);
});

profileRouter.put("/", async (req, res) => {
  const data = profileDataSchema.parse(req.body);
  res.json(await saveActiveProfile(data));
});
