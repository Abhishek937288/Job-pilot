/**
 * One real OpenAI call proving the zod 4 -> strict JSON schema conversion is accepted
 * by the API and the response validates. Usage: npm run llm:smoke [-- path/to/resume.(pdf|docx)]
 */
import { readFile } from "node:fs/promises";
import { profileExtractionSchema } from "@jobpilot/shared";
import { structuredCall } from "../llm/client.js";
import { EXTRACT_PROFILE_SYSTEM, extractProfileUserPrompt } from "../llm/prompts/extractProfile.prompt.js";
import { normalizeExtraction } from "../services/profile-normalize.js";
import { detectResumeKind, extractResumeText } from "../services/resume-file.js";

const SAMPLE = `Priya Sharma
Senior Backend Engineer | priya@example.com | Pune, India
Looking for Staff or Senior Backend Engineer roles, remote or in Bangalore. Notice period: 60 days.

EXPERIENCE
Acme Payments, Senior Software Engineer, Jan 2021 - Present
- Built event-driven settlement services in TypeScript and Node.js on PostgreSQL and Kafka.
- Led migration of 40 services to Kubernetes on AWS.
Globex, Software Engineer, Jul 2017 - Dec 2020
- Developed REST APIs in Java/Spring Boot; introduced Redis caching.

EDUCATION
B.Tech Computer Science, College of Engineering Pune, 2013 - 2017

PROJECTS
ledger-lite: open-source double-entry ledger library (TypeScript, PostgreSQL)`;

async function loadText(): Promise<string> {
  const file = process.argv[2];
  if (!file) return SAMPLE;
  const buf = await readFile(file);
  const kind = detectResumeKind(buf);
  if (!kind) throw new Error(`${file} is not a PDF or DOCX`);
  return extractResumeText(buf, kind);
}

const text = await loadText();
const result = await structuredCall({
  name: "resume_profile",
  schema: profileExtractionSchema,
  system: EXTRACT_PROFILE_SYSTEM,
  user: extractProfileUserPrompt(text),
  tier: "cheap",
});

if (!result.ok) {
  console.error("FAILED", result.reason, result.message);
  process.exit(1);
}
console.log(JSON.stringify(normalizeExtraction(result.data), null, 2));
console.log("usage:", result.usage, "attempts:", result.attempts);
