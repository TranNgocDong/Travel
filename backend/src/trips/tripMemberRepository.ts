import type { Pool } from "pg";

import type { TripRole } from "./tripAccess.js";

export interface TripMember {
  userId: string;
  displayName: string;
  role: TripRole;
  active: boolean;
  removedAt: string | null;
  phoneNumber?: string | null | undefined;
  homeBase?: string | null | undefined;
  travelStatus?: TripMemberTravelStatus | undefined;
  statusEmoji?: string | undefined;
  avatarColor?: TripMemberAvatarColor | undefined;
  backgroundKey?: TripMemberBackgroundKey | undefined;
}

export type TripMemberTravelStatus = "riding" | "resting" | "need-help" | "offline";
export type TripMemberAvatarColor = "teal" | "sky" | "green" | "amber" | "rose" | "violet";
export type TripMemberBackgroundKey = "forest" | "coast" | "mountain" | "night" | "sunrise";
export type TripMemberPatch = Partial<Pick<TripMember, "displayName" | "role" | "phoneNumber" | "homeBase" | "travelStatus" | "statusEmoji" | "avatarColor" | "backgroundKey">>;

export interface TripMemberRepository {
  // Members are soft-deleted rather than physically removed.
  // This keeps historical expenses, audit events, and trip recaps readable after someone leaves a room.
  listByTrip(tripId: string): Promise<TripMember[]>;
  add(tripId: string, member: TripMember): Promise<TripMember>;
  update(tripId: string, userId: string, patch: TripMemberPatch): Promise<TripMember | null>;
  remove(tripId: string, userId: string): Promise<void>;
}

export class InMemoryTripMemberRepository implements TripMemberRepository {
  private readonly membersByTrip = new Map<string, TripMember[]>();

  /**
   * Lists all in-memory trip members, including soft-removed members for history.
   */
  async listByTrip(tripId: string): Promise<TripMember[]> {
    return [...(this.membersByTrip.get(tripId) ?? [])];
  }

  /**
   * Adds a member to the in-memory room or reactivates a previously removed one.
   */
  async add(tripId: string, member: TripMember): Promise<TripMember> {
    const current = this.membersByTrip.get(tripId) ?? [];

    const existingIndex = current.findIndex((item) => item.userId === member.userId);

    if (existingIndex >= 0) {
      const existing = current[existingIndex]!;

      if (existing.active) {
        throw new Error("DUPLICATE_MEMBER");
      }

      // Re-adding a previously removed user reactivates the old membership row.
      // This mirrors the Postgres ON CONFLICT behavior and avoids duplicate member identities.
      const reactivated: TripMember = {
        phoneNumber: null,
        homeBase: null,
        travelStatus: "riding",
        statusEmoji: "🛵",
        avatarColor: "teal",
        backgroundKey: "forest",
        ...member,
        active: true,
        removedAt: null,
      };
      current[existingIndex] = reactivated;
      this.membersByTrip.set(tripId, current);
      return reactivated;
    }

    const activeMember: TripMember = {
      phoneNumber: null,
      homeBase: null,
      travelStatus: "riding",
      statusEmoji: "🛵",
      avatarColor: "teal",
      backgroundKey: "forest",
      ...member,
      active: true,
      removedAt: null,
    };
    this.membersByTrip.set(tripId, [...current, activeMember]);
    return activeMember;
  }

  /**
   * Updates an in-memory member profile or role.
   */
  async update(tripId: string, userId: string, patch: TripMemberPatch): Promise<TripMember | null> {
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
      phoneNumber: patch.phoneNumber === undefined ? existing.phoneNumber : patch.phoneNumber,
      homeBase: patch.homeBase === undefined ? existing.homeBase : patch.homeBase,
      travelStatus: patch.travelStatus ?? existing.travelStatus,
      statusEmoji: patch.statusEmoji ?? existing.statusEmoji,
      avatarColor: patch.avatarColor ?? existing.avatarColor,
      backgroundKey: patch.backgroundKey ?? existing.backgroundKey,
    };

    current[index] = next;
    this.membersByTrip.set(tripId, current);
    return next;
  }

  /**
   * Soft-removes a member from the in-memory room.
   */
  async remove(tripId: string, userId: string): Promise<void> {
    const current = this.membersByTrip.get(tripId) ?? [];
    const now = new Date().toISOString();
    // Soft remove keeps the member in history while hiding them from active trip actions.
    this.membersByTrip.set(tripId, current.map((member) => (member.userId === userId ? { ...member, active: false, removedAt: now } : member)));
  }
}

export class PostgresTripMemberRepository implements TripMemberRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Lists persisted trip members, keeping removed members for recap/audit views.
   */
  async listByTrip(tripId: string): Promise<TripMember[]> {
    const result = await this.pool.query<MemberRow>(
      `
        SELECT user_id, display_name, role, removed_at, phone_number, home_base, travel_status, status_emoji, avatar_color, background_key
        FROM trip_participants
        WHERE trip_id = $1
        ORDER BY removed_at ASC NULLS FIRST, created_at ASC, display_name ASC
      `,
      [tripId],
    );

    return result.rows.map(rowToMember);
  }

  /**
   * Adds a persisted member or reactivates an existing soft-removed membership.
   */
  async add(tripId: string, member: TripMember): Promise<TripMember> {
    const result = await this.pool.query<MemberRow>(
      `
        INSERT INTO trip_participants (trip_id, user_id, display_name, role)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (trip_id, user_id) DO UPDATE
        SET display_name = EXCLUDED.display_name,
            role = EXCLUDED.role,
            removed_at = NULL
        RETURNING user_id, display_name, role, removed_at, phone_number, home_base, travel_status, status_emoji, avatar_color, background_key
      `,
      [tripId, member.userId, member.displayName, member.role],
    );

    return rowToMember(result.rows[0]!);
  }

  /**
   * Updates a persisted member profile or role while preserving unspecified
   * fields.
   */
  async update(tripId: string, userId: string, patch: TripMemberPatch): Promise<TripMember | null> {
    // CASE WHEN flags let the API intentionally set nullable fields to null.
    // COALESCE alone would make "clear phone/home base" impossible because null would mean "do not update".
    const result = await this.pool.query<MemberRow>(
      `
        UPDATE trip_participants
        SET display_name = COALESCE($3, display_name),
            role = COALESCE($4, role),
            phone_number = CASE WHEN $5 THEN $6 ELSE phone_number END,
            home_base = CASE WHEN $7 THEN $8 ELSE home_base END,
            travel_status = COALESCE($9, travel_status),
            status_emoji = COALESCE($10, status_emoji),
            avatar_color = COALESCE($11, avatar_color),
            background_key = COALESCE($12, background_key)
        WHERE trip_id = $1 AND user_id = $2
        RETURNING user_id, display_name, role, removed_at, phone_number, home_base, travel_status, status_emoji, avatar_color, background_key
      `,
      [
        tripId,
        userId,
        patch.displayName ?? null,
        patch.role ?? null,
        patch.phoneNumber !== undefined,
        patch.phoneNumber ?? null,
        patch.homeBase !== undefined,
        patch.homeBase ?? null,
        patch.travelStatus ?? null,
        patch.statusEmoji ?? null,
        patch.avatarColor ?? null,
        patch.backgroundKey ?? null,
      ],
    );

    return result.rows[0] ? rowToMember(result.rows[0]) : null;
  }

  /**
   * Soft-removes a persisted member so historical expenses and audit events stay
   * readable.
   */
  async remove(tripId: string, userId: string): Promise<void> {
    // Keep the row for recap/audit/history, but mark it inactive for current room operations.
    await this.pool.query("UPDATE trip_participants SET removed_at = now() WHERE trip_id = $1 AND user_id = $2", [tripId, userId]);
  }
}

interface MemberRow {
  user_id: string;
  display_name: string;
  role: string;
  removed_at: Date | string | null;
  phone_number: string | null;
  home_base: string | null;
  travel_status: string | null;
  status_emoji: string | null;
  avatar_color: string | null;
  background_key: string | null;
}

/**
 * Converts a Postgres row into the TripMember shape used by the API.
 */
function rowToMember(row: MemberRow): TripMember {
  // Normalize database rows into safe application values.
  // Unknown enum strings fall back to conservative defaults so bad data does not crash the UI.
  return {
    userId: row.user_id,
    displayName: row.display_name,
    role: row.role === "owner" || row.role === "viewer" ? row.role : "editor",
    active: row.removed_at === null,
    removedAt: row.removed_at instanceof Date ? row.removed_at.toISOString() : row.removed_at ? new Date(row.removed_at).toISOString() : null,
    phoneNumber: row.phone_number,
    homeBase: row.home_base,
    travelStatus: parseTravelStatus(row.travel_status),
    statusEmoji: row.status_emoji || "🛵",
    avatarColor: parseAvatarColor(row.avatar_color),
    backgroundKey: parseBackgroundKey(row.background_key),
  };
}

/**
 * Parses a stored travel status and falls back to a safe default when data is unknown.
 */
function parseTravelStatus(value: string | null): TripMemberTravelStatus {
  return value === "resting" || value === "need-help" || value === "offline" ? value : "riding";
}

/**
 * Parses a stored avatar color and falls back to the default brand color.
 */
function parseAvatarColor(value: string | null): TripMemberAvatarColor {
  return value === "sky" || value === "green" || value === "amber" || value === "rose" || value === "violet" ? value : "teal";
}

/**
 * Parses a stored profile background key and falls back to the default travel theme.
 */
function parseBackgroundKey(value: string | null): TripMemberBackgroundKey {
  return value === "coast" || value === "mountain" || value === "night" || value === "sunrise" ? value : "forest";
}
