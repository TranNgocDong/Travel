import type { Pool } from "pg";

import type { RoutePlan } from "./routePlanner.js";

export interface MemberRoute {
  id: string;
  tripId: string;
  userId: string;
  displayName: string;
  routePlan: RoutePlan;
  createdAt: string;
  updatedAt: string;
}

export interface SaveMemberRouteInput {
  id: string;
  tripId: string;
  userId: string;
  displayName: string;
  routePlan: RoutePlan;
}

export interface MemberRouteRepository {
  listByTrip(tripId: string): Promise<MemberRoute[]>;
  findById(tripId: string, routeId: string): Promise<MemberRoute | null>;
  save(input: SaveMemberRouteInput): Promise<MemberRoute>;
  remove(tripId: string, routeId: string): Promise<void>;
}

export class InMemoryMemberRouteRepository implements MemberRouteRepository {
  private readonly routesByTrip = new Map<string, MemberRoute[]>();

  async listByTrip(tripId: string): Promise<MemberRoute[]> {
    return [...(this.routesByTrip.get(tripId) ?? [])].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  }

  async findById(tripId: string, routeId: string): Promise<MemberRoute | null> {
    return (this.routesByTrip.get(tripId) ?? []).find((route) => route.id === routeId) ?? null;
  }

  async save(input: SaveMemberRouteInput): Promise<MemberRoute> {
    const now = new Date().toISOString();
    const current = this.routesByTrip.get(input.tripId) ?? [];
    const existing = current.find((route) => route.userId === input.userId);
    const route: MemberRoute = {
      id: input.id,
      tripId: input.tripId,
      userId: input.userId,
      displayName: input.displayName,
      routePlan: input.routePlan,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.routesByTrip.set(input.tripId, [route, ...current.filter((item) => item.userId !== route.userId)]);
    return route;
  }

  async remove(tripId: string, routeId: string): Promise<void> {
    const current = this.routesByTrip.get(tripId) ?? [];
    this.routesByTrip.set(
      tripId,
      current.filter((route) => route.id !== routeId),
    );
  }
}

export class PostgresMemberRouteRepository implements MemberRouteRepository {
  constructor(private readonly pool: Pool) {}

  async listByTrip(tripId: string): Promise<MemberRoute[]> {
    const result = await this.pool.query<MemberRouteRow>(
      `
        SELECT id, trip_id, user_id, display_name, route_plan, created_at, updated_at
        FROM trip_member_routes
        WHERE trip_id = $1
        ORDER BY updated_at DESC, id DESC
      `,
      [tripId],
    );

    return result.rows.map(rowToMemberRoute);
  }

  async findById(tripId: string, routeId: string): Promise<MemberRoute | null> {
    const result = await this.pool.query<MemberRouteRow>(
      `
        SELECT id, trip_id, user_id, display_name, route_plan, created_at, updated_at
        FROM trip_member_routes
        WHERE trip_id = $1 AND id = $2
      `,
      [tripId, routeId],
    );

    return result.rows[0] ? rowToMemberRoute(result.rows[0]) : null;
  }

  async save(input: SaveMemberRouteInput): Promise<MemberRoute> {
    const result = await this.pool.query<MemberRouteRow>(
      `
        INSERT INTO trip_member_routes (id, trip_id, user_id, display_name, route_plan, updated_at)
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (trip_id, user_id) DO UPDATE
        SET id = EXCLUDED.id,
            display_name = EXCLUDED.display_name,
            route_plan = EXCLUDED.route_plan,
            updated_at = now()
        RETURNING id, trip_id, user_id, display_name, route_plan, created_at, updated_at
      `,
      [input.id, input.tripId, input.userId, input.displayName, JSON.stringify(input.routePlan)],
    );

    return rowToMemberRoute(result.rows[0]!);
  }

  async remove(tripId: string, routeId: string): Promise<void> {
    await this.pool.query("DELETE FROM trip_member_routes WHERE trip_id = $1 AND id = $2", [tripId, routeId]);
  }
}

interface MemberRouteRow {
  id: string;
  trip_id: string;
  user_id: string;
  display_name: string;
  route_plan: RoutePlan;
  created_at: Date | string;
  updated_at: Date | string;
}

function rowToMemberRoute(row: MemberRouteRow): MemberRoute {
  return {
    id: row.id,
    tripId: row.trip_id,
    userId: row.user_id,
    displayName: row.display_name,
    routePlan: row.route_plan,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString(),
  };
}
