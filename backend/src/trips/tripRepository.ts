import type { Pool } from "pg";

import type { TripRole } from "./tripAccess.js";

export type TripStatus = "active" | "completed" | "archived";

export interface TripSummary {
  id: string;
  title: string;
  currency: string;
  role: TripRole;
  status: TripStatus;
  completedAt: string | null;
  archivedAt: string | null;
}

export interface TripRepository {
  listForUser(userId: string): Promise<TripSummary[]>;
  findById(tripId: string): Promise<Omit<TripSummary, "role"> | null>;
  create(input: { id: string; title: string; currency: string }): Promise<Omit<TripSummary, "role">>;
  updateStatus(tripId: string, status: TripStatus): Promise<Omit<TripSummary, "role"> | null>;
  delete(tripId: string): Promise<void>;
  linkUser(tripId: string, userId: string, role: TripRole): Promise<void>;
  unlinkUser(tripId: string, userId: string): Promise<void>;
}

export class InMemoryTripRepository implements TripRepository {
  private readonly tripsById = new Map<string, Omit<TripSummary, "role">>();
  private readonly userTripRoles = new Map<string, Map<string, TripRole>>();

  /**
   * Lists trips linked to a user in memory, including the user's role.
   */
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

  /**
   * Finds an in-memory trip by id without membership role data.
   */
  async findById(tripId: string): Promise<Omit<TripSummary, "role"> | null> {
    return this.tripsById.get(tripId) ?? null;
  }

  /**
   * Creates a new in-memory trip in active status.
   */
  async create(input: { id: string; title: string; currency: string }): Promise<Omit<TripSummary, "role">> {
    const trip: Omit<TripSummary, "role"> = {
      id: input.id,
      title: input.title,
      currency: input.currency,
      status: "active",
      completedAt: null,
      archivedAt: null,
    };
    this.tripsById.set(input.id, trip);
    return trip;
  }

  /**
   * Updates in-memory trip lifecycle timestamps for active/completed/archived.
   */
  async updateStatus(tripId: string, status: TripStatus): Promise<Omit<TripSummary, "role"> | null> {
    const trip = this.tripsById.get(tripId);

    if (!trip) {
      return null;
    }

    const now = new Date().toISOString();
    const updated = {
      ...trip,
      status,
      completedAt: status === "active" ? null : trip.completedAt ?? now,
      archivedAt: status === "archived" ? now : null,
    };
    this.tripsById.set(tripId, updated);
    return updated;
  }

  /**
   * Deletes an in-memory trip and removes all role links to it.
   */
  async delete(tripId: string): Promise<void> {
    this.tripsById.delete(tripId);

    for (const rolesByTrip of this.userTripRoles.values()) {
      rolesByTrip.delete(tripId);
    }
  }

  /**
   * Links a user to an in-memory trip with a role.
   */
  async linkUser(tripId: string, userId: string, role: TripRole): Promise<void> {
    const current = this.userTripRoles.get(userId) ?? new Map<string, TripRole>();
    current.set(tripId, role);
    this.userTripRoles.set(userId, current);
  }

  /**
   * Removes a user's in-memory trip link.
   */
  async unlinkUser(tripId: string, userId: string): Promise<void> {
    this.userTripRoles.get(userId)?.delete(tripId);
  }
}

export class PostgresTripRepository implements TripRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Lists trips where the user is an active participant.
   */
  async listForUser(userId: string): Promise<TripSummary[]> {
    const result = await this.pool.query<TripRow>(
      `
        SELECT t.id, t.title, t.currency_code, t.status, t.completed_at, t.archived_at, tp.role
        FROM trips t
        INNER JOIN trip_participants tp ON tp.trip_id = t.id
        WHERE tp.user_id = $1 AND tp.removed_at IS NULL
        ORDER BY
          CASE t.status WHEN 'active' THEN 0 WHEN 'completed' THEN 1 ELSE 2 END,
          t.created_at DESC,
          t.title ASC
      `,
      [userId],
    );

    return result.rows.map(rowToTripSummary);
  }

  /**
   * Finds a trip by id without evaluating the caller's role.
   */
  async findById(tripId: string): Promise<Omit<TripSummary, "role"> | null> {
    const result = await this.pool.query<TripRow>(
      `
        SELECT id, title, currency_code, status, completed_at, archived_at, 'viewer' AS role
        FROM trips
        WHERE id = $1
      `,
      [tripId],
    );

    const trip = result.rows[0];
    return trip ? rowToTrip(trip) : null;
  }

  /**
   * Creates a new persisted trip.
   */
  async create(input: { id: string; title: string; currency: string }): Promise<Omit<TripSummary, "role">> {
    const result = await this.pool.query<TripRow>(
      `
        INSERT INTO trips (id, title, currency_code)
        VALUES ($1, $2, $3)
        RETURNING id, title, currency_code, status, completed_at, archived_at, 'owner' AS role
      `,
      [input.id, input.title, input.currency],
    );

    const trip = result.rows[0]!;
    return rowToTrip(trip);
  }

  /**
   * Updates persisted trip lifecycle status and timestamp fields.
   */
  async updateStatus(tripId: string, status: TripStatus): Promise<Omit<TripSummary, "role"> | null> {
    const result = await this.pool.query<TripRow>(
      `
        UPDATE trips
        SET status = $2,
            completed_at = CASE
              WHEN $2 = 'active' THEN NULL
              WHEN completed_at IS NULL THEN now()
              ELSE completed_at
            END,
            archived_at = CASE
              WHEN $2 = 'archived' THEN now()
              ELSE NULL
            END
        WHERE id = $1
        RETURNING id, title, currency_code, status, completed_at, archived_at, 'owner' AS role
      `,
      [tripId, status],
    );

    return result.rows[0] ? rowToTrip(result.rows[0]) : null;
  }

  /**
   * Deletes a persisted trip. Related rows are expected to be handled by
   * database constraints/migrations.
   */
  async delete(tripId: string): Promise<void> {
    await this.pool.query("DELETE FROM trips WHERE id = $1", [tripId]);
  }

  /**
   * No-op in PostgreSQL mode because trip membership is managed by the member
   * repository, not this trip repository.
   */
  async linkUser(_tripId: string, _userId: string, _role: TripRole): Promise<void> {
    return;
  }

  /**
   * No-op in PostgreSQL mode because membership removal is handled by the member
   * repository.
   */
  async unlinkUser(_tripId: string, _userId: string): Promise<void> {
    return;
  }
}

interface TripRow {
  id: string;
  title: string;
  currency_code: string;
  role: string;
  status: string;
  completed_at: Date | string | null;
  archived_at: Date | string | null;
}

/**
 * Converts a PostgreSQL trip row into a trip summary including role.
 */
function rowToTripSummary(row: TripRow): TripSummary {
  return {
    ...rowToTrip(row),
    role: row.role === "owner" || row.role === "viewer" ? row.role : "editor",
  };
}

/**
 * Converts a PostgreSQL trip row into the role-free trip model.
 */
function rowToTrip(row: TripRow): Omit<TripSummary, "role"> {
  return {
    id: row.id,
    title: row.title,
    currency: row.currency_code,
    status: row.status === "completed" || row.status === "archived" ? row.status : "active",
    completedAt: formatNullableDate(row.completed_at),
    archivedAt: formatNullableDate(row.archived_at),
  };
}

/**
 * Normalizes nullable date values from PostgreSQL into ISO strings.
 */
function formatNullableDate(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
