# Running JobPilot in Docker

JobPilot containerizes as a **single service**: Fastify serves the API (`/api/*`)
and the built React UI (everything else) on **one port** — no cross-origin proxy
needed. The container serves on 3001 internally and is published on host port
**3007** by default (3001 is commonly taken by other dev containers; override with
`JOBPILOT_HOST_PORT`). SQLite persists in a mounted `./data` volume; the
`career-ops` repo is mounted read-only for grounding files.

## Quick start

```bash
# from the jobpilot/ directory
docker compose up --build
# open http://localhost:3007   (or $JOBPILOT_HOST_PORT)
```

Seed / refresh jobs (runs the multi-source ingest inside the container):

```bash
docker compose run --rm jobpilot npm run ingest
# or only the live sources:
docker compose run --rm jobpilot npm run ingest -- --sources-only
```

The DB at `./data/jobpilot.db` survives rebuilds. To reset, delete it.

## What runs in the container

✅ HTTP API, the React board UI, multi-source ingest (Greenhouse/Lever/Ashby/
Workable/SmartRecruiters/Breezy + Himalayas/RemoteOK/Remotive/Arbeitnow/Jobicy),
the non-rejection **strategy engine** (`/api/jobs/:id/strategy`), and the SQLite DB.

## Two host-coupled features (by design)

1. **Playwright autofill / submit is host-only.** It launches a *visible* browser
   on your machine so you can watch it fill each field and click Submit yourself.
   A container has no display, so the "Autofill/Submit" actions won't launch a
   browser in-container. Run them on the host instead:
   ```bash
   npm run apply -- --job <id> --mode fill      # fill, stop at submit
   ```
   (The submit gate — `approved` + `JOBPILOT_ALLOW_SUBMIT=true` — and the
   LinkedIn/Indeed hard block are unchanged.)

2. **`claude -p` generation falls back in-container.** The generate/rewrite
   modules shell out to the Claude CLI (your auth). Inside the container that CLI
   isn't present, so they use the deterministic template fallback (answers marked
   `[[review-needed]]`). For real generation, run on the host:
   ```bash
   npm run generate -- --job <id>
   npm run rewrite  -- --job <id>
   ```
   Or mount an authenticated `claude` CLI into the container if you prefer.

## Environment variables

| Var | Default | Purpose |
|-----|---------|---------|
| `CAREER_OPS_ROOT` | `/career-ops` | Grounding files (mounted read-only) |
| `JOBPILOT_DB` | `/app/data/jobpilot.db` | SQLite path (volume) |
| `APIFY_TOKEN` | *(unset)* | Enables the dormant Dice/Apify ingest source |
| `JOBPILOT_ALLOW_SUBMIT` | *(unset)* | Half of the submit gate — leave unset in-container |

## Notes

- `better-sqlite3` compiles/prebuilds cleanly for Linux in the build stage — none
  of the Windows native-binary friction applies inside the container.
- Image base is `node:24-bookworm-slim`; the build stage adds `python3/make/g++`
  only for native module builds and is discarded from the runtime image.
