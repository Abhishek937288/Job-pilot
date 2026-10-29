# Resume Job Matcher: Final Design

Oct 29, 2026 · @shubham

Upload a resume, extract it with the OpenAI API, add preferences, and get ranked jobs from Google for Jobs, company ATS boards and web search, with dedupe, done/delete and download.

## Tech stack

Node.js and TypeScript end to end. The OpenAI SDK and Structured Outputs work the same as in Python, and `pdf-parse` and `mammoth` cover text extraction, so Python is not needed. Add a small separate Python OCR service only if scanned resumes become a real need.

| Layer | Technology | Used for |
| --- | --- | --- |
| Runtime and language | Node.js, TypeScript | The whole backend |
| Web framework | Express | REST API, plus SSE for streaming results |
| Validation | Zod | Request bodies, environment config, and the schemas for every LLM output |
| File upload | Multer with `memoryStorage` | In-memory upload with size and type limits, nothing written to disk |
| Resume text extraction | `pdf-parse` (PDF), `mammoth` (DOCX) | Getting plain text out of the upload |
| OCR fallback (later) | Tesseract or a vision model | Scanned PDFs with no text layer |
| LLM | OpenAI API, official `openai` SDK, Structured Outputs | Resume extraction, query generation, ranking. `gpt-4o-mini` by default, a stronger model only for top-10 explanations |
| Web search | OpenAI Responses API `web_search` with domain filters | Discovering career pages and ATS tokens, and as a fallback source |
| Job sources | JSearch (Google for Jobs data), ATS public board APIs, `cheerio` for JSON-LD | Fetching and parsing jobs, behind one `JobSource` interface |
| Database | MongoDB with Mongoose | Profiles, jobs, companies, and the unique `(profileId, jobKey)` index |
| Queue and cache | BullMQ, Redis | Watchlist refresh, result caching, retries |
| Realtime | SSE or Socket.IO | Streaming results and progress to the browser |
| Export | `json2csv`, `exceljs` | CSV, XLSX and JSON downloads, generated on request |
| Security and ops | `helmet`, `express-rate-limit`, `pino` | Headers, per-IP rate limits, logs that never contain resume text |
| Frontend | Next.js | Upload and preferences forms, results list with Done and Delete, download button |
| Deployment | Docker, PM2, AWS (EC2, ECR) | Running the API and background workers |
| Testing | Vitest or Jest, plus an evaluation script | Unit tests, and the 15 to 20 resume test set that measures precision@10, latency and cost |

## Pipeline

The resume file is never stored; only the extracted data is saved in MongoDB.

1. **Upload:** PDF or DOCX goes to `POST /profiles` and is held in memory only (Multer `memoryStorage`). Limit file size and type.
2. **Extract text:** `pdf-parse` for PDF, `mammoth` for DOCX. If a PDF has almost no text, treat it as scanned and fall back to OCR or a vision model.
3. **Parse:** `gpt-4o-mini` with Structured Outputs returns the profile as JSON (skills, titles, experience, education). Years of experience are computed in code from the dates.
4. **Preferences:** the user submits desired role, location, remote or onsite, salary and notice period.
5. **Query generation:** the LLM turns profile and preferences into 3 to 5 varied search queries.
6. **Fetch jobs:** run all sources in parallel (see Job sources), then normalize and dedupe by `jobKey`.
7. **Pre-filter in code:** drop jobs that fail hard rules (location, remote, salary floor, seniority, zero skill overlap) and jobs already marked done or deleted.
8. **Rank:** the LLM scores the remaining jobs; code computes the final score and sorts.
9. **Save and stream:** upsert into MongoDB and stream results to the user as they are ready.
10. **Discard:** the file buffer is dropped; only the parsed profile and jobs remain.

## Job sources

Google has no self-serve search API for new projects: the Custom Search JSON API is closed to new customers and ends on January 1, 2027, and the Web Search Service API is partner-only. So jobs come from several sources behind one `JobSource` interface, each returning jobs in the same normalized shape.

| Order | Source | What it gives | Notes |
| --- | --- | --- | --- |
| 1 | JSearch (Google for Jobs data) | Broad coverage: LinkedIn, Indeed, Glassdoor, ZipRecruiter, some career pages | $25 per 10,000 requests, 200 free per month. Third-party scraping of Google, so keep it swappable (SerpApi is the alternative) |
| 2 | ATS public boards (Greenhouse, Lever, Ashby, Workable, SmartRecruiters) | Structured jobs straight from company career pages | Free and reliable; needs the company on a watchlist |
| 3 | Career page JSON-LD | `JobPosting` markup read with cheerio | Cheap when the page has it |
| 4 | OpenAI `web_search` (Responses API) | Discovery of career pages and ATS tokens; fallback when sources 1 to 3 return too few jobs | Costs per search action and is not deterministic, so every job is verified before use |

**Verification for `web_search` results:** keep a job only if its URL appears in the response citations, the URL returns 200, and the fetched page contains the job title. Closed or invented jobs are dropped.

**Company watchlist:** a `Company` collection with `name`, `careerUrl`, `atsType`, `atsToken` and `lastCheckedAt`. A BullMQ repeatable job refreshes it every few hours into a local jobs collection, so searches for those companies read from your own database.

**Freshness:** store `postedAt`, hide jobs older than about 30 days, and mark a job closed when it disappears from the company board on the next refresh. Show the company's own apply link first when the same job comes from several sources. Respect `robots.txt` and rate-limit direct fetches.

## Data model

Three MongoDB collections. A unique index on `(profileId, jobKey)` makes it impossible to store the same job twice.

| Collection | Key fields | Purpose |
| --- | --- | --- |
| `Profile` | `userId` or session token, parsed resume JSON, preferences, `consentAt`, optional TTL | The extracted resume data. No file and no raw text |
| `JobMatch` | `profileId`, `jobKey`, `job` (title, company, location, remote, salary, `applyLinks[]`, `postedAt`, `source`), `match` (score, per-dimension scores, matched and missing skills, reason, verdict, red flags), `status`, `doneAt`, `deletedAt`, `firstSeenAt`, `lastSeenAt`, `timesSeen` | One row per job per profile, with its score and state |
| `Company` | `name`, `careerUrl`, `atsType`, `atsToken`, `lastCheckedAt` | The watchlist refreshed in the background |

**`jobKey`:** the source job ID when there is one, otherwise a SHA-1 of the normalized `title|company|city`.

**`status`:** `new` (shown in the main list), `done` (shown in a Done tab) or `deleted` (hidden). Delete is soft, so the job never comes back on the next search.

**Upsert rule:** on every search use `$setOnInsert` for job data and status, and `$set: { lastSeenAt }` with `$inc: { timesSeen: 1 }` for the rest. An existing `done` or `deleted` job is never reset.

## User separation

Every user's profiles, jobs, statuses and exports are private to that user. The rule: every row carries `userId`, and every query is scoped by the `userId` taken from the verified token on the server, never from the request body or URL.

**Identity.** Login with Google OAuth or email, issuing a session (JWT in an httpOnly cookie). The auth middleware sets `req.user.id` on every route. An optional guest mode gives a random `guestId` cookie and a TTL index (about 7 days) on all guest rows; signing up later re-assigns those rows to the new `userId`.

**Ownership in MongoDB.** Add `userId` to both `Profile` and `JobMatch` (copied onto each job row so it can be filtered directly). Index `(userId, status, score)` for the job list, and keep the unique `(profileId, jobKey)` index.

**Authorization on every route.** Load by both ids: `Profile.findOne({ _id, userId: req.user.id })`. If nothing matches, return 404, not 403, so ids cannot be probed. This covers `PATCH /jobs/:id` (done and delete), `GET /profiles/:id/export` and `DELETE /profiles/:id`. Wrap queries in one scoped repository helper so no handler can forget the `userId` filter.

| Data | Shared or per user | Why |
| --- | --- | --- |
| `Company` watchlist, ATS job cache, JSearch result cache | Shared, keyed only by normalized query and location | Contains no user data, and sharing it cuts API cost |
| `Profile`, parsed resume, preferences | Per user | Personal data |
| `JobMatch` scores and `status` (new, done, deleted) | Per user | The same job can be done for one user and new for another |
| Score cache | Per user, keyed by profile hash and `jobKey` | Scores depend on the resume |
| Exports | Generated on request, scoped by `userId` | Nothing stored |

**Background work and streaming.** BullMQ job payloads carry `userId` and `profileId`, and the worker re-checks ownership before writing. SSE or Socket.IO connections are authenticated at connect and joined to a private room `user:{id}`, so results are never broadcast on a shared channel.

**Limits per user.** Rate limit by `userId` (not only by IP), a daily search quota to control OpenAI and JSearch spend, and a cap on the number of profiles per user (for example 5).

**Deletion and logs.** `DELETE /profiles/:id` and account deletion remove every row with that `userId`. Logs carry `userId` and request ids, never resume text.

**Tests.** Add cross-user tests: user A requesting, changing, exporting or deleting user B's profile or jobs must get 404.

## LLM contracts

Every call uses OpenAI Structured Outputs with a Zod schema, so the response is always valid JSON. Resume text, job descriptions and web pages are untrusted data, never instructions.

| Call | Model | Output |
| --- | --- | --- |
| Resume extraction | `gpt-4o-mini` | `name`, `email`, `skills[]`, `experience[]` (company, title, start, end, summary), `education[]`. Missing fields are `null`; the model never guesses |
| Query generation | `gpt-4o-mini` | `queries[]` of 3 to 5 items, each `{ query, location, remoteOnly }` |
| Ranking | `gpt-4o-mini`, stronger model only for top-10 explanations | `results[]` of `{ jobId, scores, matchedSkills, missingSkills, reason, verdict, redFlags }` |

**Ranking fields:**

- `jobId`: must be one of the IDs sent. Any other ID is discarded, which is how invented jobs are blocked.
- `scores`: integers 0 to 100 for `skills`, `seniority`, `location`, and `salary` (null if unknown).
- `reason`: up to 300 characters. `verdict`: `strong`, `good`, `stretch` or `poor`. `redFlags`: for example "requires 8+ years" or "onsite only".

**Final score is computed in code, never by the LLM:** `0.5*skills + 0.2*seniority + 0.2*location + 0.1*salary`. If salary is null, the other weights are rescaled. Jobs are sorted by this score and saved.

Put the static instructions first in every prompt, because OpenAI caches long repeated prefixes automatically.

## API

| Endpoint | Purpose |
| --- | --- |
| `POST /profiles` | Upload resume and preferences, start the pipeline |
| `POST /profiles/:id/search` | Re-run the search and add only jobs not seen before |
| `GET /profiles/:id/jobs?status=&minScore=` | List jobs by status and minimum score |
| `PATCH /jobs/:id` with `{ status }` | Mark `done`, `deleted`, or undo either |
| `GET /profiles/:id/export?format=csv\|xlsx\|json&status=` | Download results |
| `DELETE /profiles/:id` | Hard-delete the profile and every job (privacy) |

**Same result twice:** duplicates inside one search are merged by `jobKey` (all apply links kept). Duplicates across searches are blocked by the unique index, so a re-run only adds new jobs. Scored jobs that are still `new` reuse their old score unless the profile or preferences changed.

**Done and delete:** both are status changes, never row deletion. Before any LLM call on a re-run, jobs already `done` or `deleted` are dropped, which also saves tokens.

**Download:** the file is generated from MongoDB on request and streamed, so nothing is stored. Use `json2csv` for CSV and `exceljs` for XLSX. Titles and companies are untrusted text, so prefix any cell starting with `=`, `+`, `-` or `@` with `'` to stop formula injection.

## Efficiency

The effects below are rough estimates, not measurements. Build the simple version first and measure each change.

| Improvement | What it fixes | Rough effect |
| --- | --- | --- |
| Pre-filter in code before the LLM | Drops jobs that fail hard rules before ranking | About 40 to 70% fewer ranking tokens, fewer irrelevant jobs |
| Better query generation | 3 to 5 varied queries (title synonyms, adjacent roles, skill-based) | Likely the biggest quality gain, since the LLM can only rank what was fetched |
| Parallel source calls | `Promise.all` instead of one after another | Latency becomes the slowest call, not the sum |
| Caching | Jobs by normalized query and location for a few hours; scores by profile hash and job ID | Repeat searches cost near zero |
| Scoring in code | LLM returns per-dimension scores, code computes the total | Consistent, explainable ranking |
| Model tiering | Small model for extraction and ranking, stronger model only for top-10 explanations | Lower cost, little quality loss |
| Streaming | Send results over SSE or Socket.IO with progress steps | Feels much faster at the same total time |

**Smaller items:** normalize skills with an alias map ("node", "nodejs", "Node.js"), compute years of experience from dates in code, and feed saved and dismissed jobs back into ranking.

**How to measure:** build a test set of 15 to 20 sample resumes with the jobs you would expect for each. Track these before and after every change:

- **Precision@10:** how many of the top 10 are good matches.
- **Latency:** time from upload to first result and to the full list.
- **Cost per search:** tokens plus jobs API calls.

## Privacy and safety

Resumes are personal data. The design stores the least it can.

- **No file stored:** the upload stays in memory and is dropped after text extraction. Raw resume text is not saved either, only the parsed JSON.
- **Consent and deletion:** a consent checkbox on upload, and `DELETE /profiles/:id` that removes the profile and all its jobs. For anonymous use, add a TTL index so data expires on its own.
- **No resume text in logs.**
- **Prompt injection:** resume text, job descriptions and fetched pages are treated as data only. Every LLM output is validated against its Zod schema, and ranking IDs must come from the fetched list.
- **Input limits:** cap file size, allowed types and extracted text length before calling the API.
- **Hallucinated jobs:** web-search results are accepted only after the citation, status 200 and title checks in Job sources.
- **Export safety:** formula-prefix escaping on CSV and XLSX cells.
- **Fetching pages:** follow `robots.txt` and rate-limit direct requests to company sites.

## Build order

1. Baseline: upload, extract, preferences, query generation, JSearch, ranking, save. Wire in the test set and the three measurements from day one.
2. Dedupe, `done` and `deleted` status, export, and delete-my-data.
3. Pre-filtering, caching, parallel calls and streaming.
4. Company watchlist with Greenhouse and Lever adapters, then career page JSON-LD.
5. OpenAI `web_search` as discovery and fallback, with the verification step.

**Open question:** does the app need user login, or should it work anonymously? With login, `profileId` ties to `userId` and a user can keep several resumes. Anonymously, use a session token and a TTL index.
