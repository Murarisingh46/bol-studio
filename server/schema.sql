CREATE TABLE IF NOT EXISTS transcripts (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  engine TEXT NOT NULL,
  source TEXT NOT NULL,
  seconds INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS transcripts_by_owner ON transcripts(owner, created_at DESC);
