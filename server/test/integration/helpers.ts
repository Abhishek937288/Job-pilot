import mongoose from "mongoose";
import request from "supertest";
import type { Express } from "express";
import { connectMongo } from "../../src/db/mongo.js";

export async function setupDb(): Promise<void> {
  const uri = process.env.MONGODB_URI!;
  if (!/test/.test(uri)) throw new Error(`Refusing to run integration tests against a non-test database: ${uri}`);
  await connectMongo(uri);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.createIndexes()));
}

/** A signed-in agent (cookie jar) for a fresh account. */
export async function signUp(app: Express, email: string) {
  const agent = request.agent(app);
  const res = await agent.post("/auth/register").send({ email, password: "password123" });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, id: res.body.id as string };
}

export const PARSED = {
  name: "Test Person",
  email: "test@example.com",
  location: "Pune",
  headline: "Backend Engineer",
  skills: ["Node.js", "PostgreSQL", "AWS"],
  experience: [{ company: "Acme", title: "Backend Engineer", start: "2021-01", end: "present", summary: null }],
  education: [],
};

export const PREFS = { desiredRole: "Backend Engineer", locations: ["Pune"], remote: "any", country: "in" };

export function uploadProfile(agent: ReturnType<typeof request.agent>) {
  return agent
    .post("/profiles")
    .field("preferences", JSON.stringify(PREFS))
    .field("consent", "true")
    .attach("file", Buffer.from("%PDF-1.4 fake"), { filename: "cv.pdf", contentType: "application/pdf" });
}
