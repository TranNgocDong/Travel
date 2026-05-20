import type { Pool } from "pg";

const defaultLocationTtlSeconds = 10 * 60;

export interface TripMemberLocation {
  tripId: string;
  userId: string;
  displayName: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  speedMps: number | null;
  headingDegrees: number | null;
  sharedAt: string;
  expiresAt: string;
}

export interface SaveTripMemberLocationInput {
  tripId: string;
  userId: string;
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
  speedMps?: number | null;
  headingDegrees?: number | null;
  ttlSeconds?: number;
}

export interface TripMemberLocationRepository {
  listActiveByTrip(tripId: string, now?: Date): Promise<TripMemberLocation[]>;
  upsert(input: SaveTripMemberLocationInput, now?: Date): Promise<TripMemberLocation>;
  remove(tripId: string, userId: string): Promise<void>;
  pruneExpired(now?: Date): Promise<void>;
}

export class InMemoryTripMemberLocationRepository implements TripMemberLocationRepository {
  private readonly locationsByTripUser = new Map<string, TripMemberLocation>();

  async listActiveByTrip(tripId: string, now = new Date()): Promise<TripMemberLocation[]> {
    await this.pruneExpired(now);

    return [...this.locationsByTripUser.values()]
      .filter((location) => location.tripId === tripId)
      .sort((left, right) => Date.parse(right.sharedAt) - Date.parse(left.sharedAt));
  }

  async upsert(input: SaveTripMemberLocationInput, now = new Date()): Promise<TripMemberLocation> {
    const ttlSeconds = input.ttlSeconds ?? defaultLocationTtlSeconds;
    const location: TripMemberLocation = {
      tripId: input.tripId,
      userId: input.userId,
      displayName: "",
      latitude: input.latitude,
      longitude: input.longitude,
      accuracyMeters: input.accuracyMeters ?? null,
      speedMps: input.speedMps ?? null,
      headingDegrees: input.headingDegrees ?? null,
      sharedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
    };

    this.locationsByTripUser.set(locationKey(input.tripId, input.userId), location);
    return location;
  }

  async remove(tripId: string, userId: string): Promise<void> {
    this.locationsByTripUser.delete(locationKey(tripId, userId));
  }

  async pruneExpired(now = new Date()): Promise<void> {
    const cutoff = now.getTime();

    for (const [key, location] of this.locationsByTripUser) {
      if (Date.parse(location.expiresAt) <= cutoff) {
        this.locationsByTripUser.delete(key);
      }
    }
  }
}

export class PostgresTripMemberLocationRepository implements TripMemberLocationRepository {
  constructor(private readonly pool: Pool) {}

  async listActiveByTrip(tripId: string, now = new Date()): Promise<TripMemberLocation[]> {
    const result = await this.pool.query<LocationRow>(
      `
        SELECT
          locations.trip_id,
          locations.user_id,
          COALESCE(participants.display_name, '') AS display_name,
          locations.latitude,
          locations.longitude,
          locations.accuracy_meters,
          locations.speed_mps,
          locations.heading_degrees,
          locations.shared_at,
          locations.expires_at
        FROM trip_member_locations locations
        LEFT JOIN trip_participants participants
          ON participants.trip_id = locations.trip_id
         AND participants.user_id = locations.user_id
        WHERE locations.trip_id = $1
          AND locations.expires_at > $2
        ORDER BY locations.shared_at DESC
      `,
      [tripId, now],
    );

    return result.rows.map(rowToLocation);
  }

  async upsert(input: SaveTripMemberLocationInput, now = new Date()): Promise<TripMemberLocation> {
    const ttlSeconds = input.ttlSeconds ?? defaultLocationTtlSeconds;
    const result = await this.pool.query<LocationRow>(
      `
        INSERT INTO trip_member_locations (
          trip_id,
          user_id,
          latitude,
          longitude,
          accuracy_meters,
          speed_mps,
          heading_degrees,
          shared_at,
          expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8::timestamptz + ($9::int * interval '1 second'))
        ON CONFLICT (trip_id, user_id) DO UPDATE
        SET latitude = EXCLUDED.latitude,
            longitude = EXCLUDED.longitude,
            accuracy_meters = EXCLUDED.accuracy_meters,
            speed_mps = EXCLUDED.speed_mps,
            heading_degrees = EXCLUDED.heading_degrees,
            shared_at = EXCLUDED.shared_at,
            expires_at = EXCLUDED.expires_at
        RETURNING
          trip_id,
          user_id,
          '' AS display_name,
          latitude,
          longitude,
          accuracy_meters,
          speed_mps,
          heading_degrees,
          shared_at,
          expires_at
      `,
      [
        input.tripId,
        input.userId,
        input.latitude,
        input.longitude,
        input.accuracyMeters ?? null,
        input.speedMps ?? null,
        input.headingDegrees ?? null,
        now,
        ttlSeconds,
      ],
    );

    return rowToLocation(result.rows[0]!);
  }

  async remove(tripId: string, userId: string): Promise<void> {
    await this.pool.query("DELETE FROM trip_member_locations WHERE trip_id = $1 AND user_id = $2", [tripId, userId]);
  }

  async pruneExpired(now = new Date()): Promise<void> {
    await this.pool.query("DELETE FROM trip_member_locations WHERE expires_at <= $1", [now]);
  }
}

interface LocationRow {
  trip_id: string;
  user_id: string;
  display_name: string;
  latitude: number | string;
  longitude: number | string;
  accuracy_meters: number | string | null;
  speed_mps: number | string | null;
  heading_degrees: number | string | null;
  shared_at: Date | string;
  expires_at: Date | string;
}

function rowToLocation(row: LocationRow): TripMemberLocation {
  return {
    tripId: row.trip_id,
    userId: row.user_id,
    displayName: row.display_name,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    accuracyMeters: nullableNumber(row.accuracy_meters),
    speedMps: nullableNumber(row.speed_mps),
    headingDegrees: nullableNumber(row.heading_degrees),
    sharedAt: dateToIso(row.shared_at),
    expiresAt: dateToIso(row.expires_at),
  };
}

function nullableNumber(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}

function dateToIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function locationKey(tripId: string, userId: string): string {
  return `${tripId}:${userId}`;
}
