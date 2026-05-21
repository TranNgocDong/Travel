CREATE TABLE IF NOT EXISTS trip_map_markers (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT map_marker_trip_member_fk FOREIGN KEY (trip_id, user_id)
    REFERENCES trip_participants(trip_id, user_id) ON DELETE CASCADE,
  CONSTRAINT map_marker_kind CHECK (kind IN ('ping', 'meetup', 'fuel', 'repair', 'warning')),
  CONSTRAINT map_marker_label_length CHECK (char_length(trim(label)) BETWEEN 1 AND 80),
  CONSTRAINT map_marker_lat_range CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT map_marker_lng_range CHECK (longitude BETWEEN -180 AND 180)
);

CREATE INDEX IF NOT EXISTS idx_trip_map_markers_trip_created_at
  ON trip_map_markers (trip_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trip_map_markers_trip_kind
  ON trip_map_markers (trip_id, kind);
