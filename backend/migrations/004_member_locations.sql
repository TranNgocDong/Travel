CREATE TABLE IF NOT EXISTS trip_member_locations (
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  accuracy_meters DOUBLE PRECISION,
  speed_mps DOUBLE PRECISION,
  heading_degrees DOUBLE PRECISION,
  shared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (trip_id, user_id),
  CONSTRAINT member_location_trip_member_fk FOREIGN KEY (trip_id, user_id)
    REFERENCES trip_participants(trip_id, user_id) ON DELETE CASCADE,
  CONSTRAINT member_location_lat_range CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT member_location_lng_range CHECK (longitude BETWEEN -180 AND 180),
  CONSTRAINT member_location_accuracy_positive CHECK (accuracy_meters IS NULL OR accuracy_meters >= 0),
  CONSTRAINT member_location_speed_positive CHECK (speed_mps IS NULL OR speed_mps >= 0),
  CONSTRAINT member_location_heading_range CHECK (heading_degrees IS NULL OR heading_degrees BETWEEN 0 AND 360)
);

CREATE INDEX IF NOT EXISTS idx_trip_member_locations_trip_shared_at
  ON trip_member_locations (trip_id, shared_at DESC);

CREATE INDEX IF NOT EXISTS idx_trip_member_locations_expires_at
  ON trip_member_locations (expires_at);
