# JobPilot

Single-user job-application assistant. Monorepo (npm workspaces):

- `web/` – Next.js 16 (App Router, Tailwind 4, shadcn/ui). Talks only to the API via the same-origin `/api/*` rewrite.
- `server/` – Express 5 API + pg-boss worker, Prisma 7 (PostgreSQL). The only package that touches the DB or OpenAI.
- `shared/` – zod schemas and DTO types used by both.

Full architecture docs arrive in Phase 5.

## Setup

```bash
cp .env.example .env            # fill APP_PASSWORD, SESSION_SECRET, OPENAI_* (see comments)
npm install                     # also runs `prisma generate`
npm run db:up                   # Postgres 17 in Docker
npm run db:migrate              # prisma migrate dev (public schema only)
npm run db:test:create          # test DB, safe to re-run on an existing volume
npm run db:migrate:test         # apply migrations to the test DB
npm run dev                     # API :4000, worker, web :3000
```

Open http://localhost:3000 and log in with `APP_PASSWORD`.

## Tests

```bash
npm test                        # unit + HTTP tests, no database needed
npm run test:integration        # against TEST_DATABASE_URL (tables are truncated)
npm run llm:smoke --workspace server [-- path/to/resume.pdf]   # one real OpenAI call
npm run ats:smoke --workspace server -- greenhouse stripe       # live check of an ATS adapter (free)
```

## Job search (Phase 2)

1. **Search → Generate queries.** The AI writes queries from your profile. Nothing is sent to Serper yet.
2. Edit/remove/add queries (duplicates are highlighted and skipped; max `SERPER_MAX_QUERIES_PER_RUN`), then
   **Run search → Confirm**. Each query is 1 Serper credit (1 page, `gl=in`), at most one retry.
3. The worker logs progress live (Search page and the `worker |` lines of `npm run dev`).
4. **Jobs**: Done / Ignore hide a job permanently, including when it reappears under another URL with the same
   company + title + location. Jobs outside your preferred locations are flagged, never dropped.
5. **Settings**: add Greenhouse / Lever / Ashby boards; they are read on every run for free.

## Notes

- `DATABASE_URL` must end in `?schema=public`. Prisma manages only `public`; pg-boss owns the `pgboss` schema, so migrations never touch it.
- Never edit an applied migration; create a new one with `npm run db:migrate`.
- Prisma is pinned to 7.10.1 (npm's `latest` tag currently points to an 8.0 release candidate).
