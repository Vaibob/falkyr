// better-sqlite3 helper. Opens data/jobpilot.db, applies schema.sql idempotently,
// and exports a shared `db` instance plus typed helper functions.
import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DB_PATH } from '../config.js';
import type { Answer, AnswerKind, Job, JobEvent, Profile, Stage } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Ensure the data/ directory exists before opening the file.
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db: Database.Database = new Database(DB_PATH);
// journal_mode = DELETE, deliberately NOT WAL. The DB is bind-mounted from the
// host into the container (docker-compose ./data), and WAL's shared-memory
// index (-shm, mmap-backed) does not coordinate across a Docker Desktop
// virtualized mount (Windows/macOS host → Linux container). Under WAL that
// caused the container's server and host-side tooling to see DIFFERENT
// owner_id values — a signed-in owner was wrongly walled as owner_mismatch.
// This app is single-process/single-user, so WAL's concurrency win is moot;
// DELETE keeps every commit in the main .db file, consistent across the mount.
db.pragma('journal_mode = DELETE');
db.pragma('foreign_keys = ON');

// Apply schema idempotently (every CREATE uses IF NOT EXISTS).
const schemaPath = join(__dirname, 'schema.sql');
const schemaSql = readFileSync(schemaPath, 'utf8');
db.exec(schemaSql);

// Guarded additive migrations (CREATE IF NOT EXISTS can't add columns).
// owner_id: binds this single-profile install to its first authenticated
// Clerk user (see src/server/security.ts). Errors mean "already exists".
try {
  db.exec(`ALTER TABLE profile ADD COLUMN owner_id TEXT`);
} catch {
  /* column already present */
}

// ---------------------------------------------------------------------------
// Typed helper functions
// ---------------------------------------------------------------------------

/** Return all jobs, optionally filtered by stage, newest-updated first. */
export function getJobs(stage?: Stage): Job[] {
  if (stage) {
    return db
      .prepare(`SELECT * FROM jobs WHERE stage = ? ORDER BY updated_at DESC, id DESC`)
      .all(stage) as Job[];
  }
  return db
    .prepare(`SELECT * FROM jobs ORDER BY updated_at DESC, id DESC`)
    .all() as Job[];
}

/** Return a single job by id, or undefined if not found. */
export function getJob(id: number): Job | undefined {
  return db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id) as Job | undefined;
}

/**
 * Insert a job, or update the existing one matching the UNIQUE url.
 * Only provided (non-undefined) fields overwrite existing values on conflict.
 * Returns the resulting Job row (never undefined on success).
 */
export function upsertJob(
  job: Partial<Omit<Job, 'id' | 'created_at' | 'updated_at'>> & { url: string },
): Job {
  const {
    source = null,
    company = null,
    role = null,
    url,
    location = null,
    remote = null,
    comp_note = null,
    ats_provider = null,
    fit_score = null,
    jd_text = null,
    stage = 'discovered',
  } = job;

  const stmt = db.prepare(`
    INSERT INTO jobs (source, company, role, url, location, remote, comp_note, ats_provider, fit_score, jd_text, stage)
    VALUES (@source, @company, @role, @url, @location, @remote, @comp_note, @ats_provider, @fit_score, @jd_text, @stage)
    ON CONFLICT(url) DO UPDATE SET
      source       = COALESCE(excluded.source, jobs.source),
      company      = COALESCE(excluded.company, jobs.company),
      role         = COALESCE(excluded.role, jobs.role),
      location     = COALESCE(excluded.location, jobs.location),
      remote       = COALESCE(excluded.remote, jobs.remote),
      comp_note    = COALESCE(excluded.comp_note, jobs.comp_note),
      ats_provider = COALESCE(excluded.ats_provider, jobs.ats_provider),
      fit_score    = COALESCE(excluded.fit_score, jobs.fit_score),
      jd_text      = COALESCE(excluded.jd_text, jobs.jd_text),
      updated_at   = CURRENT_TIMESTAMP
  `);
  stmt.run({
    source,
    company,
    role,
    url,
    location,
    remote,
    comp_note,
    ats_provider,
    fit_score,
    jd_text,
    stage,
  });

  const row = db.prepare(`SELECT * FROM jobs WHERE url = ?`).get(url) as Job | undefined;
  if (!row) throw new Error(`upsertJob failed to persist url=${url}`);
  return row;
}

/**
 * Update a job's stage, bump updated_at, and record an event.
 * Returns the updated Job, or undefined if the job does not exist.
 */
export function setStage(id: number, stage: Stage, detail?: string): Job | undefined {
  const existing = getJob(id);
  if (!existing) return undefined;

  const tx = db.transaction(() => {
    db.prepare(`UPDATE jobs SET stage = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
      stage,
      id,
    );
    addEvent(id, 'stage', detail ?? `${existing.stage} -> ${stage}`);
  });
  tx();

  return getJob(id);
}

/** Insert an answer row and return it. */
export function addAnswer(
  job_id: number,
  kind: AnswerKind,
  question: string | null,
  answer: string | null,
): Answer {
  const info = db
    .prepare(`INSERT INTO answers (job_id, kind, question, answer) VALUES (?, ?, ?, ?)`)
    .run(job_id, kind, question, answer);
  return db.prepare(`SELECT * FROM answers WHERE id = ?`).get(info.lastInsertRowid) as Answer;
}

/**
 * Delete generated answer rows for a job. Optional filters keep callers from
 * wiping unrelated answer types, such as de-correlated resume rewrites.
 */
export function deleteAnswersForJob(
  job_id: number,
  filters: { kind?: AnswerKind; questions?: readonly string[] } = {},
): number {
  const where = ['job_id = ?'];
  const params: unknown[] = [job_id];

  if (filters.kind) {
    where.push('kind = ?');
    params.push(filters.kind);
  }

  if (filters.questions?.length) {
    where.push(`question IN (${filters.questions.map(() => '?').join(', ')})`);
    params.push(...filters.questions);
  }

  const info = db.prepare(`DELETE FROM answers WHERE ${where.join(' AND ')}`).run(...params);
  return info.changes;
}

/** Return all answers for a job, oldest first. */
export function getAnswers(job_id: number): Answer[] {
  return db
    .prepare(`SELECT * FROM answers WHERE job_id = ? ORDER BY id ASC`)
    .all(job_id) as Answer[];
}

/** Insert an event row and return it. */
export function addEvent(job_id: number, type: string, detail?: string | null): JobEvent {
  const info = db
    .prepare(`INSERT INTO events (job_id, type, detail) VALUES (?, ?, ?)`)
    .run(job_id, type, detail ?? null);
  return db.prepare(`SELECT * FROM events WHERE id = ?`).get(info.lastInsertRowid) as JobEvent;
}

/** Return all events for a job, oldest first. */
export function getEvents(job_id: number): JobEvent[] {
  return db
    .prepare(`SELECT * FROM events WHERE job_id = ? ORDER BY id ASC`)
    .all(job_id) as JobEvent[];
}

// ---------------------------------------------------------------------------
// The Glove: single-row profile helpers
// ---------------------------------------------------------------------------

/** Columns writable through upsertProfile (everything except id/created_at/updated_at). */
export type ProfilePatch = Partial<Omit<Profile, 'id' | 'created_at' | 'updated_at'>>;

/** Return the single profile row, or undefined if the Glove was never touched. */
export function getProfile(): Profile | undefined {
  return db.prepare(`SELECT * FROM profile WHERE id = 1`).get() as Profile | undefined;
}

const PROFILE_COLUMNS = [
  'cv_md',
  'essay_work',
  'essay_target',
  'essay_edge',
  'github_username',
  'portfolio_url',
  'linkedin_url',
  'linkedin_paste',
  'github_md',
  'github_fetched_at',
  'github_error',
  'portfolio_text',
  'portfolio_fetched_at',
  'portfolio_error',
  'peer_card_draft',
  'draft_distilled_at',
  'draft_inputs_hash',
  'draft_model',
  'peer_card',
  'peer_card_approved_at',
  'approved_inputs_hash',
  'approved_cv_md',
] as const;

/**
 * Merge a patch into the single profile row and return the result.
 * Semantics: keys absent/undefined in the patch are left unchanged; explicit
 * null CLEARS a column (needed for fetch errors/timestamps) — unlike upsertJob's
 * COALESCE pattern, which can never clear. JS-merge is safe here because the
 * table is single-row and AI intake routes are single-flight.
 */
export function upsertProfile(patch: ProfilePatch): Profile {
  const existing = getProfile();
  const merged: Record<string, string | null> = {};
  for (const col of PROFILE_COLUMNS) {
    const patched = patch[col];
    merged[col] =
      patched !== undefined ? patched : ((existing?.[col] ?? null) as string | null);
  }

  db.prepare(
    `INSERT INTO profile (id, ${PROFILE_COLUMNS.join(', ')}, updated_at)
     VALUES (1, ${PROFILE_COLUMNS.map((c) => `@${c}`).join(', ')}, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET
       ${PROFILE_COLUMNS.map((c) => `${c} = excluded.${c}`).join(',\n       ')},
       updated_at = CURRENT_TIMESTAMP`,
  ).run(merged);

  const row = getProfile();
  if (!row) throw new Error('upsertProfile failed to persist the profile row');
  return row;
}
