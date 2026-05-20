CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  currency_code CHAR(3) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trip_participants (
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, user_id)
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  paid_by_user_id TEXT NOT NULL,
  amount NUMERIC(20, 6) NOT NULL,
  currency_code CHAR(3) NOT NULL,
  split JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT amount_positive CHECK (amount > 0),
  CONSTRAINT payer_is_trip_member FOREIGN KEY (trip_id, paid_by_user_id)
    REFERENCES trip_participants(trip_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_expenses_trip_created_at
  ON expenses (trip_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_expenses_trip_payer
  ON expenses (trip_id, paid_by_user_id);

CREATE INDEX IF NOT EXISTS idx_expenses_split_gin
  ON expenses USING GIN (split);
