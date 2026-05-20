CREATE TABLE IF NOT EXISTS trip_messages (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT trip_message_body_length CHECK (char_length(trim(body)) BETWEEN 1 AND 1000)
);

CREATE INDEX IF NOT EXISTS idx_trip_messages_trip_created_at
  ON trip_messages (trip_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trip_messages_trip_user
  ON trip_messages (trip_id, user_id);
