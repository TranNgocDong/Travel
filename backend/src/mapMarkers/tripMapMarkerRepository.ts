import type { Pool } from "pg";

export type TripMapMarkerKind = "ping" | "meetup" | "fuel" | "repair" | "warning" | "food" | "lodging";

export interface TripMapMarker {
  id: string;
  tripId: string;
  userId: string;
  displayName: string;
  label: string;
  kind: TripMapMarkerKind;
  latitude: number;
  longitude: number;
  createdAt: string;
}

export interface CreateTripMapMarkerInput {
  id: string;
  tripId: string;
  userId: string;
  displayName: string;
  label: string;
  kind: TripMapMarkerKind;
  latitude: number;
  longitude: number;
  createdAt?: Date;
}

export interface TripMapMarkerRepository {
  listByTrip(tripId: string): Promise<TripMapMarker[]>;
  findById(tripId: string, markerId: string): Promise<TripMapMarker | null>;
  create(input: CreateTripMapMarkerInput): Promise<TripMapMarker>;
  remove(tripId: string, markerId: string): Promise<void>;
}

export class InMemoryTripMapMarkerRepository implements TripMapMarkerRepository {
  private readonly markersByTrip = new Map<string, TripMapMarker[]>();

  async listByTrip(tripId: string): Promise<TripMapMarker[]> {
    return [...(this.markersByTrip.get(tripId) ?? [])].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  }

  async findById(tripId: string, markerId: string): Promise<TripMapMarker | null> {
    return (this.markersByTrip.get(tripId) ?? []).find((marker) => marker.id === markerId) ?? null;
  }

  async create(input: CreateTripMapMarkerInput): Promise<TripMapMarker> {
    const marker: TripMapMarker = {
      id: input.id,
      tripId: input.tripId,
      userId: input.userId,
      displayName: input.displayName,
      label: input.label,
      kind: input.kind,
      latitude: input.latitude,
      longitude: input.longitude,
      createdAt: (input.createdAt ?? new Date()).toISOString(),
    };
    const current = this.markersByTrip.get(input.tripId) ?? [];
    this.markersByTrip.set(input.tripId, [marker, ...current.filter((item) => item.id !== marker.id)]);
    return marker;
  }

  async remove(tripId: string, markerId: string): Promise<void> {
    const current = this.markersByTrip.get(tripId) ?? [];
    this.markersByTrip.set(
      tripId,
      current.filter((marker) => marker.id !== markerId),
    );
  }
}

export class PostgresTripMapMarkerRepository implements TripMapMarkerRepository {
  constructor(private readonly pool: Pool) {}

  async listByTrip(tripId: string): Promise<TripMapMarker[]> {
    const result = await this.pool.query<MarkerRow>(
      `
        SELECT id, trip_id, user_id, display_name, label, kind, latitude, longitude, created_at
        FROM trip_map_markers
        WHERE trip_id = $1
        ORDER BY created_at DESC, id DESC
      `,
      [tripId],
    );

    return result.rows.map(rowToMarker);
  }

  async findById(tripId: string, markerId: string): Promise<TripMapMarker | null> {
    const result = await this.pool.query<MarkerRow>(
      `
        SELECT id, trip_id, user_id, display_name, label, kind, latitude, longitude, created_at
        FROM trip_map_markers
        WHERE trip_id = $1 AND id = $2
      `,
      [tripId, markerId],
    );

    return result.rows[0] ? rowToMarker(result.rows[0]) : null;
  }

  async create(input: CreateTripMapMarkerInput): Promise<TripMapMarker> {
    const result = await this.pool.query<MarkerRow>(
      `
        INSERT INTO trip_map_markers (id, trip_id, user_id, display_name, label, kind, latitude, longitude, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id, trip_id, user_id, display_name, label, kind, latitude, longitude, created_at
      `,
      [
        input.id,
        input.tripId,
        input.userId,
        input.displayName,
        input.label,
        input.kind,
        input.latitude,
        input.longitude,
        input.createdAt ?? new Date(),
      ],
    );

    return rowToMarker(result.rows[0]!);
  }

  async remove(tripId: string, markerId: string): Promise<void> {
    await this.pool.query("DELETE FROM trip_map_markers WHERE trip_id = $1 AND id = $2", [tripId, markerId]);
  }
}

interface MarkerRow {
  id: string;
  trip_id: string;
  user_id: string;
  display_name: string;
  label: string;
  kind: TripMapMarkerKind;
  latitude: number | string;
  longitude: number | string;
  created_at: Date | string;
}

function rowToMarker(row: MarkerRow): TripMapMarker {
  return {
    id: row.id,
    tripId: row.trip_id,
    userId: row.user_id,
    displayName: row.display_name,
    label: row.label,
    kind: row.kind,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
  };
}
