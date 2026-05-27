CREATE TABLE IF NOT EXISTS trip_member_routes (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  route_plan JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT member_route_trip_member_fk FOREIGN KEY (trip_id, user_id)
    REFERENCES trip_participants(trip_id, user_id) ON DELETE CASCADE,
  CONSTRAINT member_route_plan_is_object CHECK (jsonb_typeof(route_plan) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_trip_member_routes_trip_updated_at
  ON trip_member_routes (trip_id, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trip_member_routes_unique_member
  ON trip_member_routes (trip_id, user_id);
