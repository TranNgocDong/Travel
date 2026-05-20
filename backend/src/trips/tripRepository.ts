import type { Pool } from "pg";

import type { TripRole } from "./tripAccess.js";

export interface TripSummary {
  id: string;
  title: string;
  currency: string;
  role: TripRole;
}

export interface TripRepository {
  listForUser(userId: string): Promise<TripSummary[]>;
  findById(tripId: string): Promise<Omit<TripSummary, "role"> | null>;
  create(input: { id: string; title: string; currency: string }): Promise<Omit<TripSummary, "role">>;
  linkUser(tripId: string, userId: string, role: TripRole): Promise<void>;
  unlinkUser(tripId: string, userId: string): Promise<void>;
}

export class InMemoryTripRepository implements TripRepository {
  private readonly tripsById = new Map<string, Omit<TripSummary, "role">>();
  private readonly userTripRoles = new Map<string, Map<string, TripRole>>();

  async listForUser(userId: string): Promise<TripSummary[]> {
    const rolesByTrip = this.userTripRoles.get(userId) ?? new Map<string, TripRole>();

    return [...rolesByTrip.entries()]
      .map(([tripId, role]) => {
        const trip = this.tripsById.get(tripId);
        return trip ? { ...trip, role } : null;
      })
      .filter((trip): trip is TripSummary => trip !== null)
      .sort((left, right) => left.title.localeCompare(right.title));
  }

  async findById(tripId: string): Promise<Omit<TripSummary, "role"> | null> {
    return this.tripsById.get(tripId) ?? null;
  }

  async create(input: { id: string; title: string; currency: string }): Promise<Omit<TripSummary, "role">> {
    const trip = {
      id: input.id,
      title: input.title,
      currency: input.currency,
    };
    this.tripsById.set(input.id, trip);
    return trip;
  }

  async linkUser(tripId: string, userId: string, role: TripRole): Promise<void> {
    const current = this.userTripRoles.get(userId) ?? new Map<string, TripRole>();
    current.set(tripId, role);
    this.userTripRoles.set(userId, current);
  }

  async unlinkUser(tripId: string, userId: string): Promise<void> {
    this.userTripRoles.get(userId)?.delete(tripId);
  }
}

export class PostgresTripRepository implements TripRepository {
  constructor(private readonly pool: Pool) {}

  async listForUser(userId: string): Promise<TripSummary[]> {
    const result = await this.pool.query<TripRow>(
      `
        SELECT t.id, t.title, t.currency_code, tp.role
        FROM trips t
        INNER JOIN trip_participants tp ON tp.trip_id = t.id
        WHERE tp.user_id = $1
        ORDER BY t.created_at DESC, t.title ASC
      `,
      [userId],
    );

    return result.rows.map(rowToTripSummary);
  }

  async findById(tripId: string): Promise<Omit<TripSummary, "role"> | null> {
    const result = await this.pool.query<TripRow>(
      `
        SELECT id, title, currency_code, 'viewer' AS role
        FROM trips
        WHERE id = $1
      `,
      [tripId],
    );

    const trip = result.rows[0];
    return trip ? { id: trip.id, title: trip.title, currency: trip.currency_code } : null;
  }

  async create(input: { id: string; title: string; currency: string }): Promise<Omit<TripSummary, "role">> {
    const result = await this.pool.query<TripRow>(
      `
        INSERT INTO trips (id, title, currency_code)
        VALUES ($1, $2, $3)
        RETURNING id, title, currency_code, 'owner' AS role
      `,
      [input.id, input.title, input.currency],
    );

    const trip = result.rows[0]!;
    return { id: trip.id, title: trip.title, currency: trip.currency_code };
  }

  async linkUser(_tripId: string, _userId: string, _role: TripRole): Promise<void> {
    return;
  }

  async unlinkUser(_tripId: string, _userId: string): Promise<void> {
    return;
  }
}

interface TripRow {
  id: string;
  title: string;
  currency_code: string;
  role: string;
}

function rowToTripSummary(row: TripRow): TripSummary {
  return {
    id: row.id,
    title: row.title,
    currency: row.currency_code,
    role: row.role === "owner" || row.role === "viewer" ? row.role : "editor",
  };
}
