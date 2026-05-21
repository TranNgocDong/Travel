ALTER TABLE trip_participants
  ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_trip_participants_active_user
  ON trip_participants (user_id, trip_id)
  WHERE removed_at IS NULL;
