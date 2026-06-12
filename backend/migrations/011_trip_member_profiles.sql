ALTER TABLE trip_participants
  ADD COLUMN IF NOT EXISTS phone_number TEXT,
  ADD COLUMN IF NOT EXISTS home_base TEXT,
  ADD COLUMN IF NOT EXISTS travel_status TEXT NOT NULL DEFAULT 'riding',
  ADD COLUMN IF NOT EXISTS status_emoji TEXT NOT NULL DEFAULT '🛵',
  ADD COLUMN IF NOT EXISTS avatar_color TEXT NOT NULL DEFAULT 'teal',
  ADD COLUMN IF NOT EXISTS background_key TEXT NOT NULL DEFAULT 'forest';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'trip_participants_travel_status_check'
  ) THEN
    ALTER TABLE trip_participants
      ADD CONSTRAINT trip_participants_travel_status_check
      CHECK (travel_status IN ('riding', 'resting', 'need-help', 'offline'))
      NOT VALID;
  END IF;
END
$$;

ALTER TABLE trip_participants
  VALIDATE CONSTRAINT trip_participants_travel_status_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'trip_participants_avatar_color_check'
  ) THEN
    ALTER TABLE trip_participants
      ADD CONSTRAINT trip_participants_avatar_color_check
      CHECK (avatar_color IN ('teal', 'sky', 'green', 'amber', 'rose', 'violet'))
      NOT VALID;
  END IF;
END
$$;

ALTER TABLE trip_participants
  VALIDATE CONSTRAINT trip_participants_avatar_color_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'trip_participants_background_key_check'
  ) THEN
    ALTER TABLE trip_participants
      ADD CONSTRAINT trip_participants_background_key_check
      CHECK (background_key IN ('forest', 'coast', 'mountain', 'night', 'sunrise'))
      NOT VALID;
  END IF;
END
$$;

ALTER TABLE trip_participants
  VALIDATE CONSTRAINT trip_participants_background_key_check;
