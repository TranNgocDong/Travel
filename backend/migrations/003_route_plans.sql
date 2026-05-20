CREATE TABLE IF NOT EXISTS trip_route_plans (
  trip_id TEXT PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
  route_plan JSONB NOT NULL,
  updated_by_user_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT route_plan_is_object CHECK (jsonb_typeof(route_plan) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_trip_route_plans_updated_at
  ON trip_route_plans (updated_at DESC);
