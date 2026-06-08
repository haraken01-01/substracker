CREATE TABLE IF NOT EXISTS devices (
  device_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  notification_time TEXT NOT NULL DEFAULT '09:00',
  generic_body INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reminder_rules (
  device_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  name TEXT NOT NULL,
  amount_text TEXT NOT NULL DEFAULT '',
  due_date TEXT NOT NULL,
  cycle TEXT NOT NULL DEFAULT 'none',
  auto_renew INTEGER NOT NULL DEFAULT 0,
  offsets_json TEXT NOT NULL,
  target_url TEXT NOT NULL DEFAULT '/substracker/',
  PRIMARY KEY (device_id, source_type, source_id),
  FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notification_log (
  notification_key TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rules_device ON reminder_rules(device_id);
CREATE INDEX IF NOT EXISTS idx_log_sent_at ON notification_log(sent_at);
