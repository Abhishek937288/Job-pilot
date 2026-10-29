# API reference

The Express API listens on `PORT` (default 4000). The web app never calls it directly: Next.js rewrites
`/api/:path*` to `${API_INTERNAL_URL}/:path*`, so the browser calls `/api/profiles` and the API sees `/profiles`.

All request and response types are in [`shared/src/index.ts`](../shared/src/index.ts).

## Conventions

- **Session:** an httpOnly JWT cookie (`jp_session`) set by the auth routes. Every route except `/health` and
  `/auth/*` returns `401 {error}` without a session. Guests have a session too.
- **Errors:** `{ error: string, issues?: {path, message}[] }`. `400` validation, `401` no session, `403` forbidden
  (e.g. a guest adding companies, bad Origin), `404` not found *or not yours* (ids cannot be probed), `409` conflict,
  `413` file too large, `415` wrong file type, `422` unreadable resume, `429` rate limit or daily quota.
- **Dates** are ISO strings. **Ids** are MongoDB ObjectId strings.
- State-changing requests must come from the web origin (`Origin` header is checked when present).

## Auth

| Method and path | Body | Response |
| --- | --- | --- |
| `GET /auth/config` | | `AuthConfigDto` |
| `GET /auth/me` | | `UserDto`, or `401` |
| `POST /auth/guest` | | `201 UserDto`. Starts a guest session; guest data expires after `GUEST_TTL_DAYS`. |
| `POST /auth/register` | `RegisterInput` | `201 UserDto`. If the caller is a guest, the guest account becomes this account and keeps its data. `409` if the email exists. |
| `POST /auth/login` | `Credentials` | `UserDto`. A guest's profiles and jobs move to the account. `401` on bad credentials. |
| `POST /auth/logout` | | `204` |
| `GET /auth/google` | | `302` to Google (only when `googleEnabled`). Callback `GET /auth/google/callback` redirects to `/profiles`, or `/login?error=google`. |
| `DELETE /auth/account` | | `204`. Deletes the user and every profile, job and run they own. |

## Profiles

| Method and path | Body / query | Response |
| --- | --- | --- |
| `GET /profiles` | | `ProfileDto[]`, newest first |
| `POST /profiles` | `multipart/form-data`: `file` (PDF or DOCX), `preferences` (JSON string of `PreferencesInput`), `consent` = `"true"`, optional `label` | `201 CreateProfileResponse`. Takes 5 to 30 s (text extraction + LLM parse). The search run starts in the background; follow it over `/events`. |
| `GET /profiles/:id` | | `ProfileDto` |
| `PATCH /profiles/:id` | `UpdateProfileInput` | `ProfileDto`. Changing preferences makes the next search re-score jobs. |
| `DELETE /profiles/:id` | | `204`. Hard-deletes the profile, its jobs and runs. |
| `POST /profiles/:id/search` | | `202 SearchRunDto`. Re-runs the search; only jobs not seen before are added. `409` if a run is already active for this profile, `429` when the daily quota is used up. |
| `GET /profiles/:id/runs` | | `SearchRunDto[]`, newest first (last 20) |
| `GET /profiles/:id/jobs?status=new\|done\|deleted&minScore=0` | | `JobMatchDto[]`, sorted by `match.score` desc. Unscored jobs last. |
| `GET /profiles/:id/export?format=csv\|xlsx\|json&status=` | | File download (`Content-Disposition: attachment`). Without `status`, all non-deleted jobs. |

## Jobs and runs

| Method and path | Body | Response |
| --- | --- | --- |
| `PATCH /jobs/:id` | `{ status: "new" \| "done" \| "deleted" }` | `JobMatchDto`. `"new"` undoes done or delete. |
| `GET /runs/:id` | | `SearchRunDto` |

## Company watchlist

Shared by all users (it holds no personal data). Guests can read it but not change it.

| Method and path | Body | Response |
| --- | --- | --- |
| `GET /companies` | | `CompanyDto[]` |
| `POST /companies` | `CreateCompanyInput` | `201 CompanyDto`. The ATS type and token are detected from board URLs (`boards.greenhouse.io/x`, `jobs.lever.co/x`, `jobs.ashbyhq.com/x`, `apply.workable.com/x`, `jobs.smartrecruiters.com/X`); any other URL is read as a careers page with JSON-LD `JobPosting` markup. A refresh is queued immediately. `409` if the board already exists. |
| `POST /companies/:id/refresh` | | `202` |
| `DELETE /companies/:id` | | `204`. Only by the user who added it. |

## Live events

`GET /events` is a Server-Sent Events stream, private to the signed-in user. Each message is
`data: <ServerEvent JSON>`; a comment line is sent every 20 s as a heartbeat.

- `run.progress` — a pipeline step started (`queries`, `fetch`, `prefilter`, `web_search`, `rank`, `explain`, `done`).
- `run.job` — a job was saved or re-scored. Upsert it into the list by `job.id`.
- `run.finished` — the run ended (`run.status` is `succeeded` or `failed`), with stats and metrics.

Events are not replayed. After (re)connecting, reload `GET /profiles/:id/jobs` and `GET /profiles/:id/runs`.
