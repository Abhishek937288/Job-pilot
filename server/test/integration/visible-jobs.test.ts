import { jobListQuerySchema, type JobListQuery } from "@jobpilot/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/db/prisma.js";
import { getVisibleJobs, setJobStatus } from "../../src/services/jobs.service.js";
import { resetSearchTables, seedJob } from "./helpers.js";

const q = (o: Record<string, string> = {}): JobListQuery => jobListQuerySchema.parse(o);
const urls = async (o?: Record<string, string>) => (await getVisibleJobs(q(o))).items.map((j) => j.canonicalUrl).sort();

beforeEach(resetSearchTables);
afterAll(() => prisma.$disconnect());

describe("getVisibleJobs: exclusion rule", () => {
  it("shows jobs with no status row, NEW and SAVED; hides DONE and IGNORED", async () => {
    await seedJob({ url: "https://a.com/1", title: "T1" });
    await seedJob({ url: "https://a.com/2", title: "T2", status: "NEW" });
    await seedJob({ url: "https://a.com/3", title: "T3", status: "SAVED" });
    await seedJob({ url: "https://a.com/4", title: "T4", status: "DONE" });
    await seedJob({ url: "https://a.com/5", title: "T5", status: "IGNORED" });
    expect(await urls()).toEqual(["https://a.com/1", "https://a.com/2", "https://a.com/3"]);
  });

  it("hides a job at a DIFFERENT URL whose fingerprint matches a DONE job", async () => {
    await seedJob({ url: "https://jobs.lever.co/acme/1", status: "DONE" });
    await seedJob({ url: "https://acme.com/careers/backend" }); // same company/title/location
    expect(await urls()).toEqual([]);
  });

  it("hides a fingerprint sibling of an IGNORED job too", async () => {
    await seedJob({ url: "https://x.com/1", status: "IGNORED" });
    await seedJob({ url: "https://y.com/1", status: "SAVED" });
    expect(await urls()).toEqual([]);
  });

  it("does NOT hide the same company + title in a different city", async () => {
    await seedJob({ url: "https://a.com/mumbai", location: "Mumbai", status: "DONE" });
    await seedJob({ url: "https://a.com/pune", location: "Pune" });
    expect(await urls()).toEqual(["https://a.com/pune"]);
  });

  it("does not merge location-unknown jobs on company + title alone", async () => {
    await seedJob({ url: "https://a.com/x", location: null, status: "DONE" });
    await seedJob({ url: "https://b.com/x", location: null });
    expect(await urls()).toEqual(["https://b.com/x"]);
  });

  it("shows one row per fingerprint, preferring the SAVED copy", async () => {
    await seedJob({ url: "https://a.com/1" });
    const saved = await seedJob({ url: "https://b.com/1", status: "SAVED" });
    const { items, total } = await getVisibleJobs(q());
    expect(total).toBe(1);
    expect(items[0]?.id).toBe(saved.id);
    expect(items[0]?.status).toBe("SAVED");
  });

  it("hides expired jobs", async () => {
    await seedJob({ url: "https://a.com/1", expired: true });
    expect(await urls()).toEqual([]);
  });

  it("marking Done via setJobStatus hides the job and its siblings immediately", async () => {
    const a = await seedJob({ url: "https://a.com/1" });
    await seedJob({ url: "https://b.com/1" });
    await seedJob({ url: "https://c.com/other", title: "Other Role" });
    await setJobStatus(a.id, "DONE");
    expect(await urls()).toEqual(["https://c.com/other"]);
  });

  it("un-doing (back to NEW) makes it visible again", async () => {
    const a = await seedJob({ url: "https://a.com/1", status: "DONE" });
    await setJobStatus(a.id, "NEW");
    expect(await urls()).toEqual(["https://a.com/1"]);
  });
});

describe("getVisibleJobs: filters", () => {
  beforeEach(async () => {
    await seedJob({ url: "https://a.com/m", title: "A", location: "Mumbai", applyMethod: "LEVER", fitScore: 80 });
    await seedJob({ url: "https://a.com/p", title: "B", location: "Pune", applyMethod: "GREENHOUSE", fitScore: 40, status: "SAVED" });
    await seedJob({ url: "https://a.com/r", title: "C", location: "Remote - India", fitScore: null });
    await seedJob({ url: "https://a.com/u", title: "D", location: null });
  });

  it("location match flag (mismatches are kept and filterable)", async () => {
    expect(await urls({ locationMatch: "MISMATCH" })).toEqual(["https://a.com/p"]);
    expect(await urls({ locationMatch: "MATCH,REMOTE" })).toEqual(["https://a.com/m", "https://a.com/r"]);
    expect(await urls({ locationMatch: "UNKNOWN" })).toEqual(["https://a.com/u"]);
  });

  it("location text, apply method, status, min fit", async () => {
    expect(await urls({ location: "mum" })).toEqual(["https://a.com/m"]);
    expect(await urls({ applyMethod: "GREENHOUSE" })).toEqual(["https://a.com/p"]);
    expect(await urls({ status: "SAVED" })).toEqual(["https://a.com/p"]);
    expect(await urls({ minFitScore: "50" })).toEqual(["https://a.com/m"]);
  });

  it("filter values are bound parameters (SQL/LIKE metacharacters match literally)", async () => {
    expect(await urls({ location: "%" })).toEqual([]);
    expect(await urls({ location: "' OR 1=1 --" })).toEqual([]);
    expect(await prisma.job.count()).toBe(4);
  });

  it("orders by fit score and paginates with a total", async () => {
    const page = await getVisibleJobs(q({ limit: "2", offset: "0" }));
    expect(page.total).toBe(4);
    expect(page.items.map((i) => i.fitScore)).toEqual([80, 40]);
    const next = await getVisibleJobs(q({ limit: "2", offset: "2" }));
    expect(next.items).toHaveLength(2);
  });
});
