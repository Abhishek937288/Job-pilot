# JobPilot

Upload a resume, get it parsed with the OpenAI API, set your preferences, and get a ranked list of jobs from
Google for Jobs data (JSearch), company ATS boards, career-page JSON-LD and OpenAI web search, with dedupe,
Done/Delete and CSV/XLSX/JSON download. Built from [Resume Job Matcher Final Design.md](Resume%20Job%20Matcher%20Final%20Design.md).

Monorepo (npm workspaces), TypeScript end to end:

| Package | What |
| --- | --- |
| `shared/` | Zod request schemas, enums and response types used by both sides |
| `server/` | Express 5 API + BullMQ worker. MongoDB (Mongoose), Redis. The only package that talks to OpenAI, JSearch or job boards |
| `web/` | Next.js 16 app. Calls the API only through its same-origin `/api/*` rewrite |

## Run it locally

Needs Node 24, MongoDB 7+ and Redis running locally (`mongod` and `redis-server`).

```bash
sudo systemctl enable --now mongod redis-server   # once; both start on boot afterwards
cp .env.example .env     # set SESSION_SECRET (openssl rand -base64 48) and OPENAI_API_KEY; JSEARCH_API_KEY recommended
npm install              # also builds shared/
npm run dev              # shared (watch), API :4000, worker, web :3000
```

Open http://localhost:3000, then continue as a guest or sign up. Stop with Ctrl+C.

- Without `JSEARCH_API_KEY`, each run reports the JSearch source as failed and uses the watchlist and web search only.
- Google sign-in is optional: set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and register
  `http://localhost:3000/api/auth/google/callback` as a redirect URI.

## How a search works

1. **Upload** (`POST /profiles`): PDF or DOCX held in memory only (Multer `memoryStorage`, 5 MB, magic bytes checked).
2. **Extract text** with `pdf-parse` / `mammoth`. Too little text means a scanned PDF, which is sent to the vision-capable model instead (`VISION_FALLBACK_ENABLED`).
3. **Parse** with `gpt-4o-mini` Structured Outputs into skills, experience and education. Years of experience and normalized skills (alias map) are computed in code.
4. **Queue** a search run (BullMQ). The worker re-checks that the profile belongs to the payload's user.
5. **Queries:** the LLM writes 3 to 5 varied queries.
6. **Fetch** all sources in parallel: JSearch (one page per query, Redis-cached 6 h, shared) and the watchlist cache.
7. **Dedupe** by `jobKey`, then by fingerprint (title|company|city) across sources. All apply links are kept, company links first.
8. **Pre-filter** in code: done/deleted jobs, stale (>30 days), location, remote, salary floor, seniority and zero skill overlap.
9. **Web search fallback** when fewer than `WEB_SEARCH_MIN_RESULTS` jobs survive: OpenAI `web_search` limited to ATS domains. A job is kept only if its URL is in the citations, returns 200, and the page contains the title. ATS boards found this way are added to the watchlist.
10. **Rank** in batches of 10 with `gpt-4o-mini` (per-dimension scores; ids that weren't sent are discarded). The **final score is computed in code**: `0.5 skills + 0.2 seniority + 0.2 location + 0.1 salary`, rescaled when salary is unknown. Scores for jobs still `new` are reused unless the profile or preferences changed.
11. **Save and stream:** each batch is upserted and pushed over SSE (`/events`, a private per-user channel).
12. **Explain:** the top 10 get a better reason from the stronger model.

Re-runs add only jobs not seen before. Done and Delete are status changes, so those jobs never come back.

## Company watchlist

Add a careers page or board URL on the Companies page. Greenhouse, Lever, Ashby, Workable and SmartRecruiters
boards are detected from the URL; any other URL is read for JSON-LD `JobPosting` markup, following job links when
the listing page has none. A BullMQ repeatable job refreshes every company every `WATCHLIST_REFRESH_HOURS` into a
shared job cache, so searches read watchlist jobs from the database. Jobs that disappear from a board are marked
closed. Direct page fetches honour `robots.txt` and are rate-limited per host.

## Users and privacy

- Email/password (scrypt) or Google sign-in; the session is a JWT in an httpOnly, SameSite=Lax cookie. Guest mode: data expires after `GUEST_TTL_DAYS` (TTL indexes), and signing up or logging in keeps it.
- Every query goes through `server/src/db/scoped.ts`, filtered by the session's `userId`. Other users' ids return 404.
- Limits per user: rate limit, daily search quota (`DAILY_SEARCH_QUOTA`) and at most `MAX_PROFILES_PER_USER` profiles.
- The resume file and its raw text are never stored or logged. `DELETE /profiles/:id` and account deletion remove every row.
- LLM input is treated as data (tagged, never instructions). Every output is validated with Zod.
- Exports are generated on request and streamed, with formula-prefix escaping for CSV and XLSX.

API details: [docs/API.md](docs/API.md).

## Tests

```bash
npm test                    # unit tests, no services needed
npm run test:integration    # against TEST_MONGODB_URI / TEST_REDIS_URL (the test database is dropped)
npm run typecheck
```

The integration tests cover cross-user access (404 for another user's profile, jobs, export and delete), the upsert
rule (done/deleted never reset, only new jobs added, score reuse), guest upgrade and merge, and the export escaping.

## Production

`npm run build`, then run `npm start -w server`, `npm run start:worker -w server` and `npm start -w web` with
`NODE_ENV=production` (Secure cookies), `WEB_ORIGIN` and `TRUST_PROXY` set for your setup. Run one API instance per
host (rate-limit counters are in memory); workers can be scaled freely.
