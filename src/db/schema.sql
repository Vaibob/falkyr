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
