-- Initial Schema for Leca D1 Database
CREATE TABLE IF NOT EXISTS tasks (
  uuid TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  name TEXT NOT NULL,
  target_freq INTEGER NOT NULL,
  completions TEXT DEFAULT '[]',
  updated_at TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  name TEXT,
  picture TEXT,
  is_premium INTEGER DEFAULT 0,
  last_login TEXT DEFAULT CURRENT_TIMESTAMP,
  created_at DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_email ON tasks(user_email);
