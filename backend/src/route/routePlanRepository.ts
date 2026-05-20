import type { Pool } from "pg";

import type { RoutePlan } from "./routePlanner.js";

export interface RoutePlanRepository {
  findByTrip(tripId: string): Promise<RoutePlan | null>;
  save(tripId: string, userId: string, routePlan: RoutePlan): Promise<RoutePlan>;
}

export class InMemoryRoutePlanRepository implements RoutePlanRepository {
  private readonly routePlansByTrip = new Map<string, RoutePlan>();

  async findByTrip(tripId: string): Promise<RoutePlan | null> {
    return this.routePlansByTrip.get(tripId) ?? null;
  }

  async save(tripId: string, _userId: string, routePlan: RoutePlan): Promise<RoutePlan> {
    this.routePlansByTrip.set(tripId, routePlan);
    return routePlan;
  }
}

export class PostgresRoutePlanRepository implements RoutePlanRepository {
  constructor(private readonly pool: Pool) {}

  async findByTrip(tripId: string): Promise<RoutePlan | null> {
    const result = await this.pool.query<RoutePlanRow>(
      `
        SELECT route_plan
        FROM trip_route_plans
        WHERE trip_id = $1
      `,
      [tripId],
    );

    return result.rows[0]?.route_plan ?? null;
  }

  async save(tripId: string, userId: string, routePlan: RoutePlan): Promise<RoutePlan> {
    const result = await this.pool.query<RoutePlanRow>(
      `
        INSERT INTO trip_route_plans (trip_id, route_plan, updated_by_user_id, updated_at)
        VALUES ($1, $2, $3, now())
        ON CONFLICT (trip_id) DO UPDATE
        SET route_plan = EXCLUDED.route_plan,
            updated_by_user_id = EXCLUDED.updated_by_user_id,
            updated_at = now()
        RETURNING route_plan
      `,
      [tripId, JSON.stringify(routePlan), userId],
    );

    return result.rows[0]?.route_plan ?? routePlan;
  }
}

interface RoutePlanRow {
  route_plan: RoutePlan;
}
