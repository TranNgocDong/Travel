import type { Pool } from "pg";

export type TripAuditAction =
  | "trip_created"
  | "trip_status_changed"
  | "trip_deleted"
  | "member_added"
  | "member_role_changed"
  | "member_removed"
  | "route_plan_updated"
  | "member_route_saved"
  | "member_route_deleted"
  | "map_marker_created"
  | "map_marker_deleted"
  | "expense_created";

export interface TripAuditEvent {
  id: string;
  tripId: string;
  actorUserId: string;
  actorDisplayName: string;
  action: TripAuditAction;
  targetUserId: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface CreateTripAuditEventInput {
  id: string;
  tripId: string;
  actorUserId: string;
  actorDisplayName: string;
  action: TripAuditAction;
  targetUserId?: string | null;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface TripAuditRepository {
  create(input: CreateTripAuditEventInput): Promise<TripAuditEvent>;
  listByTrip(tripId: string, limit?: number): Promise<TripAuditEvent[]>;
}

export class InMemoryTripAuditRepository implements TripAuditRepository {
  private readonly eventsByTrip = new Map<string, TripAuditEvent[]>();

  /**
   * Stores an audit event in memory for local/demo runs without PostgreSQL.
   */
  async create(input: CreateTripAuditEventInput): Promise<TripAuditEvent> {
    const event: TripAuditEvent = {
      id: input.id,
      tripId: input.tripId,
      actorUserId: input.actorUserId,
      actorDisplayName: input.actorDisplayName,
      action: input.action,
      targetUserId: input.targetUserId ?? null,
      resourceId: input.resourceId ?? null,
      metadata: input.metadata ?? {},
      createdAt: new Date().toISOString(),
    };
    const current = this.eventsByTrip.get(input.tripId) ?? [];
    this.eventsByTrip.set(input.tripId, [event, ...current]);
    return event;
  }

  /**
   * Returns the latest in-memory audit events for a trip, newest first.
   */
  async listByTrip(tripId: string, limit = 80): Promise<TripAuditEvent[]> {
    return [...(this.eventsByTrip.get(tripId) ?? [])]
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, clampAuditLimit(limit));
  }
}

export class PostgresTripAuditRepository implements TripAuditRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Persists a trip audit event to PostgreSQL so sensitive membership and trip
   * mutations remain traceable.
   */
  async create(input: CreateTripAuditEventInput): Promise<TripAuditEvent> {
    const result = await this.pool.query<TripAuditEventRow>(
      `
        INSERT INTO trip_audit_events (id, trip_id, actor_user_id, actor_display_name, action, target_user_id, resource_id, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, trip_id, actor_user_id, actor_display_name, action, target_user_id, resource_id, metadata, created_at
      `,
      [
        input.id,
        input.tripId,
        input.actorUserId,
        input.actorDisplayName,
        input.action,
        input.targetUserId ?? null,
        input.resourceId ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );

    return rowToTripAuditEvent(result.rows[0]!);
  }

  /**
   * Loads recent trip audit events with a clamped limit to avoid oversized API
   * responses.
   */
  async listByTrip(tripId: string, limit = 80): Promise<TripAuditEvent[]> {
    const result = await this.pool.query<TripAuditEventRow>(
      `
        SELECT id, trip_id, actor_user_id, actor_display_name, action, target_user_id, resource_id, metadata, created_at
        FROM trip_audit_events
        WHERE trip_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2
      `,
      [tripId, clampAuditLimit(limit)],
    );

    return result.rows.map(rowToTripAuditEvent);
  }
}

interface TripAuditEventRow {
  id: string;
  trip_id: string;
  actor_user_id: string;
  actor_display_name: string;
  action: TripAuditAction;
  target_user_id: string | null;
  resource_id: string | null;
  metadata: Record<string, unknown>;
  created_at: Date | string;
}

/**
 * Converts the snake_case PostgreSQL row into the camelCase API model.
 */
function rowToTripAuditEvent(row: TripAuditEventRow): TripAuditEvent {
  return {
    id: row.id,
    tripId: row.trip_id,
    actorUserId: row.actor_user_id,
    actorDisplayName: row.actor_display_name,
    action: row.action,
    targetUserId: row.target_user_id,
    resourceId: row.resource_id,
    metadata: row.metadata,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
  };
}

/**
 * Bounds audit pagination to a safe range for both memory and database reads.
 */
function clampAuditLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return 80;
  }

  return Math.min(200, Math.max(1, Math.trunc(limit)));
}
