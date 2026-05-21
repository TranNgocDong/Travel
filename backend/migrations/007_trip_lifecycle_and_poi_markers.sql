ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'trips_status_check'
  ) THEN
    ALTER TABLE trips
      ADD CONSTRAINT trips_status_check CHECK (status IN ('active', 'completed', 'archived'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_trips_status_created_at
  ON trips (status, created_at DESC);

ALTER TABLE trip_map_markers DROP CONSTRAINT IF EXISTS map_marker_kind;

ALTER TABLE trip_map_markers
  ADD CONSTRAINT map_marker_kind
    CHECK (kind IN ('ping', 'meetup', 'fuel', 'repair', 'warning', 'food', 'lodging'));
