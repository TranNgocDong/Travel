CREATE TABLE IF NOT EXISTS trip_audit_events (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  actor_display_name TEXT NOT NULL,
  action TEXT NOT NULL,
  target_user_id TEXT,
  resource_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT trip_audit_events_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT trip_audit_events_action_length CHECK (char_length(trim(action)) BETWEEN 3 AND 80)
);

CREATE INDEX IF NOT EXISTS idx_trip_audit_events_trip_created_at
  ON trip_audit_events (trip_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trip_audit_events_actor_created_at
  ON trip_audit_events (actor_user_id, created_at DESC);
