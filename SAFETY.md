# Safety, Terms of Service, and the Submit Gate

JobPilot is a **human-in-the-loop copilot**, not an auto-applier. This document
explains the terms-of-service reality it operates in, the design choices that
follow from it, and the hard technical gate that prevents un-reviewed
submissions.

> **Not legal advice.** You are responsible for how you use JobPilot and for
> complying with the terms of every site you interact with.

---

## The ToS reality

Most job platforms and applicant tracking systems (ATS) **prohibit automated or
bot-driven submission** of applications. In practice:

- **LinkedIn** — its User Agreement forbids using bots, scrapers, or other
  automated methods to access the service or to submit content (including
  automated "Easy Apply"). Automated activity risks account restriction or a
  permanent ban.
- **Indeed** — its Terms of Service prohibit automated access and automated
  submission of applications; applying is expected to be a human action.
- **ATS platforms** (Greenhouse, Lever, Workday, Ashby, iCIMS, SmartRecruiters,
  and similar) — their terms generally prohibit automated form submission and
  scripted interaction with their application flows. Many also offer **official
  integrations and apply APIs** intended for legitimate programmatic use.

Consequences of ignoring this are real: rate-limiting, CAPTCHA walls, application
rejection, account suspension or permanent bans, and — for the employer — a
flood of low-signal applications that hurts every candidate.

**Blind, high-volume, automated mass-submission is against these terms and is not
something JobPilot does or facilitates.**

---

## How JobPilot is designed around this

1. **Runs on your own machine, as you.** JobPilot is local-first. It uses your
   own browser session and your own logins. There is no central service
   submitting on anyone's behalf and no shared credential pool.
2. **Generates for human review.** Claude drafts form answers, cover letters, and
   CV notes. These are stored in the local database for you to **read and edit**
   before anything happens. Generation is not submission.
3. **Fills, then stops.** The default autofill mode populates a form and **halts
   at the submit button**. You look at the filled form and decide.
4. **Per-job approval, every time.** Submission requires you to explicitly move
   that specific job to the `approved` stage. Approval is per-job and is recorded
   as an event.
5. **No blind mass-submit.** There is deliberately **no "submit all"** feature and
   no batch path that bypasses per-job approval. Volume is not a goal; fit and
   quality are.
6. **Auditable.** Every stage change, generation run, fill, and submit is written
   to the `events` log so you always know what happened.
7. **Prefer official flows.** Where an ATS offers an official apply API or
   integration, that is the recommended route. Treat browser autofill as a
   convenience for **your own** review-and-submit, not as a scraper or bot.

---

## The hard submit gate (technical invariant)

This is enforced in code, not just documented. The autofill module
(`src/apply/`) **will not click a submit button** unless **both** of the
following are true:

1. **`job.stage === 'approved'`** — you approved this specific job, and
2. **`JOBPILOT_ALLOW_SUBMIT === 'true'`** — the environment flag is set on the
   machine performing the run.

Both come together in `src/config.ts`:

```ts
// HARD SAFETY GATE. Autofill must refuse to click submit unless
// job.stage === 'approved' AND this flag is true. Default is false.
export const SUBMIT_ALLOWED = process.env.JOBPILOT_ALLOW_SUBMIT === 'true';
```

Consequences of this invariant:

- **`fill` is the default.** With no flag and no approval, JobPilot fills the form
  and stops at submit. This is the safe, everyday path.
- **The API refuses early.** `POST /api/jobs/:id/apply` with `{ mode: 'submit' }`
  returns **HTTP 409 Conflict** if the job is not `approved`.
- **No un-approved submit path exists.** There is no code route — CLI, API, UI, or
  batch — that submits a job which is not `approved`, and none that submits with
  the env flag unset.
- **Off by default.** `JOBPILOT_ALLOW_SUBMIT` is unset out of the box, so a fresh
  clone cannot submit anything until you knowingly opt in.

---

## Data & credential security (the Glove, the Claude token)

Falkyr holds two sensitive things: your **profile / CV** (the Glove) and, when you
connect Claude in-product, a long-lived **Claude Code OAuth token**. How they're
protected, and the threats each defense answers:

- **The token never leaves your machine, and never travels in an API response.**
  It's stored in `data/claude-token` (0600), which lives *outside* `web/dist`, so
  the static file server cannot serve it — a `GET /data/claude-token` hits the SPA
  fallback and returns HTML, not the file. As defense-in-depth, every error string
  the API emits is run through `redactSecrets()`, which scrubs anything
  `sk-ant-…`-shaped. It is git- and docker-ignored.
- **Loopback only.** The container publishes to `127.0.0.1` exclusively; the API
  refuses any non-loopback `Host` header (DNS-rebinding guard). Nothing on the LAN
  can reach it.
- **Cross-site writes are blocked (CSRF).** A malicious page you visit cannot make
  your browser fire state-changing POSTs at `127.0.0.1` — the origin guard rejects
  any write whose `Origin` isn't one of Falkyr's own. This matters even for
  no-body routes like `scan` and `distill` (which spend your Claude quota) and
  `disconnect`. This guard is always on, in every mode.
- **One install, one owner (identity guard).** When Falkyr is configured with a
  Clerk server key, every `/api` request must carry a valid Clerk session JWT,
  verified server-side. The install binds to the **first** authenticated user;
  any other signed-in account is refused everywhere with `403 owner_mismatch` and
  sees none of the owner's data. This is the fix for "a second account saw the
  first user's Glove" — the UI gate alone was never a security boundary. Without a
  server key (pure local single-user mode) the API is open on loopback, exactly as
  it was before; loopback is then the boundary.
- **Reset:** delete `data/jobpilot.db` to unbind the owner and wipe the profile;
  Disconnect (or delete `data/claude-token`) removes the Claude token.

These are verified by `npm run e2e` — the `security` project asserts the host,
origin, and identity guards; the `app` project drives a real second account and
asserts it is walled out and the owner's CV never appears in its DOM or API
responses.

## Recommendations

- **Use official ATS apply flows / APIs** when available; they are the
  terms-compliant way to submit programmatically.
- **Keep a human in the loop.** Read every draft. Approve deliberately, one job at
  a time.
- **Apply selectively.** JobPilot's value is better-targeted applications, not
  more of them.
- **Respect each site's terms.** If a platform's terms prohibit automated
  submission, do not use the `submit` path against it — use `fill`, review, and
  submit manually, or use the site's official channel.
- **Leave `JOBPILOT_ALLOW_SUBMIT` unset** unless you have a specific, reviewed job
  you intend to submit, and you have confirmed doing so is consistent with that
  site's terms.
