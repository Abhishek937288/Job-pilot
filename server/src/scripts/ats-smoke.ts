/**
 * Live check of one ATS adapter against its public API (free, no credits).
 * Usage: npm run ats:smoke --workspace server -- <greenhouse|lever|ashby> <slug> [jobId]
 */
import type { AtsProvider } from "@jobpilot/shared";
import { atsAdapters } from "../search/ats/index.js";

const [providerArg, slug, jobId] = process.argv.slice(2);
const provider = providerArg?.toUpperCase() as AtsProvider | undefined;
if (!provider || !(provider in atsAdapters) || !slug) {
  console.error("Usage: ats-smoke <greenhouse|lever|ashby> <slug> [jobId]");
  process.exit(1);
}
const adapter = atsAdapters[provider];

const started = Date.now();
const board = await adapter.fetchBoard(slug);
console.log(`${provider} ${slug}: ${board.jobs.length} jobs, company=${board.companyName ?? "(not provided)"} in ${Date.now() - started}ms`);
for (const j of board.jobs.slice(0, 3)) {
  console.log(`  - ${j.title} | ${j.location ?? "?"} | ${j.remoteType} | ${j.canonicalUrl} | desc ${j.descriptionText?.length ?? 0} chars`);
}

const target = jobId ?? board.jobs[0]?.jobId;
if (target) {
  const one = await adapter.fetchJob({ provider, slug: board.jobs[0]?.slug ?? slug, jobId: target });
  console.log(`fetchJob(${target}): ${one ? `${one.title} @ ${one.location}` : "null (not found)"}`);
}
