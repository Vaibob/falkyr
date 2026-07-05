# JobPilot

A **local-first job application copilot**. JobPilot ingests job listings into a
small SQLite database, evaluates fit, and uses Claude to draft tailored answers,
cover letters, and CV notes for each role. It then helps you **fill** application
forms in a real browser — and stops at the submit button.

JobPilot runs entirely on **your own machine**, under **your own control**. It is
built to keep a human in the loop: nothing is submitted without an explicit,
per-job approval. See [SAFETY.md](./SAFETY.md) for the terms-of-service reality
and the hard safety gate around submission.

---

## What it is

- **Pipeline, not autopilot.** Jobs move through explicit stages
  (`discovered → evaluated → drafted → ready → approved → applied → …`). You
  advance them; JobPilot does the tedious parts in between.
- **A single SQLite database** (`data/jobpilot.db`) is the source of truth for
  jobs, generated answers, and an event log.
- **Claude for generation.** Drafting shells out to Claude Code headless
  (`claude -p`) — no API key required — with a deterministic template fallback if
  the `claude` CLI is not installed.
- **A local web UI** to review jobs, read generated drafts, approve, and trigger
  autofill.
- **career-ops as the source of truth for you.** JobPilot reads your CV, profile,
  and article digest from a sibling [career-ops](https://github.com/santifer/career-ops)
  checkout (read-only) to ground its drafts.

---

## Architecture

```
                        ┌──────────────────────────────┐
                        │  career-ops repo (read-only)  │
                        │  cv.md · profile.yml · digest │
                        └───────────────┬──────────────┘
                                        │ read
                                        ▼
  ┌─────────┐   upsert   ┌───────────────────────────┐   HTTP    ┌──────────────┐
  │ ingest  │──────────▶ │   data/jobpilot.db (SQLite)│ ◀───────▶ │  Fastify API │
  │ src/    │            │  jobs · answers · events   │           │  :3001 /api  │
  │ ingest/ │            └──────────────┬────────────┘           └──────┬───────┘
  └─────────┘                           │                                │ fetch
                          read/write    │                                ▼
                    ┌───────────────────┴──────────┐              ┌──────────────┐
                    │  generate (src/generate/)     │              │  Web UI      │
                    │  claude -p → drafts           │              │  web/ (Vite  │
                    └───────────────────────────────┘              │  React :5173)│
                    ┌───────────────────────────────┐              └──────────────┘
                    │  apply (src/apply/)            │
                    │  Playwright fill → STOP at     │  ◀─── HARD-GATED submit
                    │  submit (approval + env gate)  │
                    └───────────────────────────────┘
```

### Components

| Layer      | Path            | Responsibility                                                        |
|------------|-----------------|-----------------------------------------------------------------------|
| Config     | `src/config.ts` | Absolute paths, ports, and the `JOBPILOT_ALLOW_SUBMIT` safety flag.    |
| Types      | `src/types.ts`  | `Job`, `Answer`, `JobEvent`, `Stage` — mirror the DB tables exactly.   |
| DB         | `src/db/`       | `better-sqlite3` + `schema.sql`; typed helpers (`upsertJob`, `setStage`, `addAnswer`, …). |
| API        | `src/server/`   | Fastify HTTP API on port `3001`, all routes under `/api`; CORS for the Vite dev origin. |
| Ingest     | `src/ingest/`   | Pull listings from sources and `upsertJob` them (dedup by unique `url`). |
| Generate   | `src/generate/` | Draft form answers, cover letters, CV notes via `claude -p`.          |
| Autofill   | `src/apply/`    | Playwright automation that fills forms and **hard-gates submit**.     |
| Web UI     | `web/`          | Vite + React + Tailwind review/approval dashboard.                    |

### Stack

- **Runtime:** Node 24, TypeScript (ESM, `"type": "module"`), run via `tsx`.
- **Backend:** Fastify 5 · `@fastify/cors` · better-sqlite3 · zod.
- **Frontend:** Vite 6 · React 18 · TypeScript · Tailwind CSS (in `web/`).
- **Automation:** Playwright. Reuses career-ops's installed browsers via
  `PLAYWRIGHT_BROWSERS_PATH` if you'd rather not re-download them.
- **Generation:** Claude Code headless (`claude -p`), with a template fallback.

### Data model

One SQLite file, `data/jobpilot.db`, created on first run (schema applied
idempotently from `src/db/schema.sql`):

- **`jobs`** — one row per listing, deduplicated by a `UNIQUE` `url`. Carries
  `company`, `role`, `location`, `ats_provider`, `fit_score`, `jd_text`, and the
  current `stage`.
- **`answers`** — generated content per job, `kind` ∈ (`form`, `cover`, `cv`).
- **`events`** — an append-only audit log (stage changes, generation runs, fill
  and submit actions).

**Stages (in order):** `discovered → evaluated → drafted → ready → approved →
applied → responded → interview → offer → rejected → skipped`.

### HTTP API

Fastify on **`http://localhost:3001`**, everything under `/api`. CORS allows the
Vite dev origin (`http://localhost:5173`).

| Method | Route                       | Description                                                            |
|--------|-----------------------------|------------------------------------------------------------------------|
| GET    | `/api/health`               | `{ ok: true }`                                                         |
| GET    | `/api/jobs?stage=`          | List jobs, optionally filtered by stage.                              |
| GET    | `/api/jobs/:id`             | `{ job, answers, events }`                                            |
| POST   | `/api/jobs/:id/stage`       | Body `{ stage }` — set stage, record an event; returns updated job.   |
| POST   | `/api/jobs/:id/approve`     | Set stage to `approved`; record an event.                            |
| GET    | `/api/jobs/:id/answers`     | Answers for the job.                                                  |
| POST   | `/api/jobs/:id/generate`    | Queue generation for the job; returns `{ queued: true }`.            |
| POST   | `/api/jobs/:id/apply`       | Body `{ mode: 'fill' \| 'submit' }` — trigger autofill; returns `{ started: true }`. **409** if `mode === 'submit'` and the job is not `approved`. |

---

## Install & run

**Prerequisites:** Node 24+, npm. Optionally the `claude` CLI (for real
generation) and Playwright browsers (for autofill). A sibling `career-ops`
checkout at `C:\Users\VaibhavGangaramShela\Documents\career-ops` (override with
`CAREER_OPS_ROOT`).

```bash
# 1. Install dependencies (root package.json covers backend + UI + Playwright)
npm install

# 2. (optional) Install Playwright browsers, or point at career-ops's copy
npx playwright install chromium
#   or:  set PLAYWRIGHT_BROWSERS_PATH to career-ops's browser cache

# 3. Ingest job listings into data/jobpilot.db
npm run ingest

# 4. Start the API server (http://localhost:3001)
npm run server

# 5. In another terminal, start the web UI (http://localhost:5173)
npm run ui:dev
```

Open **http://localhost:5173** and work the pipeline: review a job, generate
drafts, edit as needed, **approve**, then fill.

Other scripts: `npm run generate` (CLI generation), `npm run apply` (CLI
autofill), `npm run dev` (server + UI together), `npm run typecheck`,
`npm run ui:build`.

### Environment variables

| Variable                   | Default                          | Purpose                                             |
|----------------------------|----------------------------------|-----------------------------------------------------|
| `JOBPILOT_ALLOW_SUBMIT`    | *(unset → off)*                  | Must equal `true` to enable the submit path.        |
| `CAREER_OPS_ROOT`          | `…\Documents\career-ops`         | Read-only career-ops checkout (CV/profile/digest).  |
| `JOBPILOT_DB`              | `data/jobpilot.db`               | SQLite database file path.                          |
| `JOBPILOT_API_PORT`        | `3001`                           | Fastify API port.                                   |
| `JOBPILOT_UI_PORT`         | `5173`                           | Vite dev port (also the CORS-allowed origin).       |
| `PLAYWRIGHT_BROWSERS_PATH` | *(Playwright default)*           | Reuse browsers installed elsewhere (e.g. career-ops). |

---

## How generation uses `claude -p`

Generation (`src/generate/`) drafts three kinds of content per job — application
**form** answers, a **cover** letter, and **CV** notes — and stores them as
`answers` rows.

1. **Context is assembled locally.** JobPilot reads your `cv.md`,
   `config/profile.yml`, and `article-digest.md` from the read-only career-ops
   checkout, plus the job's `jd_text` from the database.
2. **Claude is invoked headless.** The context and instructions are passed to
   Claude Code in print mode:

   ```bash
   claude -p "<prompt with your CV, profile, the JD, and the question>"
   ```

   This uses your existing Claude Code login — **no API key** is required. Output
   is captured from stdout.
3. **Deterministic fallback.** If the `claude` CLI is not on `PATH`, generation
   falls back to a deterministic template so the pipeline still works offline
   (clearly lower quality — meant as a placeholder for human editing).
4. **Everything is stored for review.** Drafts land in the `answers` table and a
   `generate` event is recorded. Nothing is sent anywhere; you review and edit in
   the UI before advancing the job to `ready`/`approved`.

Trigger generation from the UI, via `POST /api/jobs/:id/generate`, or with
`npm run generate`.

---

## How autofill / submit works

Autofill (`src/apply/`) uses Playwright to open the job's application page **in a
browser on your machine** and fill fields from your profile and the generated
`answers`. It has two modes, and a hard safety gate.

- **`fill` (default).** Populates the form and **stops at the submit button**.
  Nothing is clicked to submit. You inspect the filled form in the browser and
  submit yourself if you choose to.
- **`submit`.** Only permitted when **both** conditions hold:
  1. the job's stage is **`approved`** (per-job human approval), **and**
  2. the environment variable **`JOBPILOT_ALLOW_SUBMIT=true`** is set.

  If either is missing, the autofill module refuses to click submit. The API
  returns **HTTP 409** when `mode === 'submit'` is requested for a job that is not
  `approved`.

There is **no "submit all"** and **no code path** that submits an un-approved
job. Every fill and submit action is recorded in the `events` log. This gate is a
project invariant — see [SAFETY.md](./SAFETY.md) for the full rationale and the
terms-of-service reality behind it.

```bash
# Fill only (safe default) — via CLI
npm run apply -- --job <id> --mode fill

# Submit — requires stage=approved AND the env flag, on your own machine
JOBPILOT_ALLOW_SUBMIT=true npm run apply -- --job <id> --mode submit
```
