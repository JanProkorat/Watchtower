CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS instances (
  id TEXT PRIMARY KEY,
  cwd TEXT NOT NULL,
  status TEXT NOT NULL,
  claude_session_id TEXT,
  spawned_at INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  exit_code INTEGER,
  termination_reason TEXT,
  resumed_from_instance_id TEXT REFERENCES instances(id),
  jira_key_hint TEXT,
  args_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_instances_status ON instances(status);

CREATE TABLE IF NOT EXISTS hook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id TEXT REFERENCES instances(id),
  event_name TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hook_events_instance ON hook_events(instance_id, received_at);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id TEXT REFERENCES instances(id),
  kind TEXT NOT NULL,
  fired_at INTEGER NOT NULL,
  dismissed_at INTEGER,
  body TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
