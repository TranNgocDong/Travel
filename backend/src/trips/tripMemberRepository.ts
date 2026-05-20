import type { Pool } from "pg";

import type { TripRole } from "./tripAccess.js";

export interface TripMember {
  userId: string;
  displayName: string;
  role: TripRole;
}

export interface TripMemberRepository {
  listByTrip(tripId: string): Promise<TripMember[]>;
  add(tripId: string, member: TripMember): Promise<TripMember>;
  update(tripId: string, userId: string, patch: { displayName?: string; role?: TripRole }): Promise<TripMember | null>;
  remove(tripId: string, userId: string): Promise<void>;
}

export class InMemoryTripMemberRepository implements TripMemberRepository {
  private readonly membersByTrip = new Map<string, TripMember[]>();

  async listByTrip(tripId: string): Promise<TripMember[]> {
    return [...(this.membersByTrip.get(tripId) ?? [])];
  }

  async add(tripId: string, member: TripMember): Promise<TripMember> {
    const current = this.membersByTrip.get(tripId) ?? [];

    if (current.some((item) => item.userId === member.userId)) {
      throw new Error("DUPLICATE_MEMBER");
    }

    this.membersByTrip.set(tripId, [...current, member]);
    return member;
  }

  async update(tripId: string, userId: string, patch: { displayName?: string; role?: TripRole }): Promise<TripMember | null> {
    const current = this.membersByTrip.get(tripId) ?? [];
    const index = current.findIndex((member) => member.userId === userId);

    if (index < 0) {
      return null;
    }

    const existing = current[index]!;
    const next = {
      ...existing,
      displayName: patch.displayName ?? existing.displayName,
      role: patch.role ?? existing.role,
    };

    current[index] = next;
    this.membersByTrip.set(tripId, current);
    return next;
  }

  async remove(tripId: string, userId: string): Promise<void> {
    const current = this.membersByTrip.get(tripId) ?? [];
    this.membersByTrip.set(
      tripId,
      current.filter((member) => member.userId !== userId),
    );
  }
}

export class PostgresTripMemberRepository implements TripMemberRepository {
  constructor(private readonly pool: Pool) {}

  async listByTrip(tripId: string): Promise<TripMember[]> {
    const result = await this.pool.query<MemberRow>(
      `
        SELECT user_id, display_name, role
        FROM trip_participants
        WHERE trip_id = $1
        ORDER BY created_at ASC, display_name ASC
      `,
      [tripId],
    );

    return result.rows.map(rowToMember);
  }

  async add(tripId: string, member: TripMember): Promise<TripMember> {
    try {
      await this.pool.query(
        `
          INSERT INTO trip_participants (trip_id, user_id, display_name, role)
          VALUES ($1, $2, $3, $4)
        `,
        [tripId, member.userId, member.displayName, member.role],
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new Error("DUPLICATE_MEMBER");
      }

      throw error;
    }

    return member;
  }

  async update(tripId: string, userId: string, patch: { displayName?: string; role?: TripRole }): Promise<TripMember | null> {
    const result = await this.pool.query<MemberRow>(
      `
        UPDATE trip_participants
        SET display_name = COALESCE($3, display_name),
            role = COALESCE($4, role)
        WHERE trip_id = $1 AND user_id = $2
        RETURNING user_id, display_name, role
      `,
      [tripId, userId, patch.displayName ?? null, patch.role ?? null],
    );

    return result.rows[0] ? rowToMember(result.rows[0]) : null;
  }

  async remove(tripId: string, userId: string): Promise<void> {
    await this.pool.query("DELETE FROM trip_participants WHERE trip_id = $1 AND user_id = $2", [tripId, userId]);
  }
}

interface MemberRow {
  user_id: string;
  display_name: string;
  role: string;
}

function rowToMember(row: MemberRow): TripMember {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    role: row.role === "owner" || row.role === "viewer" ? row.role : "editor",
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23505";
}
