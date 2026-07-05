-- JobPilot SQLite schema. Applied idempotently on DB init.
-- Mirrors src/types.ts EXACTLY. All CREATE statements use IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY,
  source TEXT,
  company TEXT,
  role TEXT,
  url TEXT UNIQUE,
  location TEXT,
  remote TEXT,
  comp_note TEXT,
  ats_provider TEXT,
  fit_score REAL,
  jd_text TEXT,
  stage TEXT NOT NULL DEFAULT 'discovered',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS answers (
  id INTEGER PRIMARY KEY,
  job_id INTEGER,
  kind TEXT CHECK(kind IN ('form','cover','cv')),
  question TEXT,
  answer TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  job_id INTEGER,
  type TEXT,
  detail TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_jobs_stage ON jobs(stage);
CREATE INDEX IF NOT EXISTS idx_answers_job_id ON answers(job_id);
CREATE INDEX IF NOT EXISTS idx_events_job_id ON events(job_id);

-- The Glove: single-row candidate profile (peer-card intake).
-- TRUST INVARIANT: grounding code reads ONLY peer_card (released) + approved_cv_md.
-- peer_card_draft and the fetched caches NEVER ground anything — they feed the
-- distill prompt and the review UI only.
CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  -- gathered inputs (Stage 1)
  cv_md TEXT,
  essay_work TEXT,
  essay_target TEXT,
  essay_edge TEXT,
  github_username TEXT,
  portfolio_url TEXT,
  linkedin_url TEXT,
  linkedin_paste TEXT,
  -- fetched caches (Stage 2; deterministic renderings, shown verbatim to the user)
  github_md TEXT,
  github_fetched_at TEXT,
  github_error TEXT,
  portfolio_text TEXT,
  portfolio_fetched_at TEXT,
  portfolio_error TEXT,
  -- the peer card: draft (distill output + user edits) vs released (grounds)
  peer_card_draft TEXT,
  draft_distilled_at TEXT,
  draft_inputs_hash TEXT,
  draft_model TEXT,
  peer_card TEXT,
  peer_card_approved_at TEXT,
  approved_inputs_hash TEXT,
  approved_cv_md TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
