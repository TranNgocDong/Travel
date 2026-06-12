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
  listByTrip(tripId: string): Promise<TripMember[]>;
  add(tripId: string, member: TripMember): Promise<TripMember>;
  update(tripId: string, userId: string, patch: TripMemberPatch): Promise<TripMember | null>;
  remove(tripId: string, userId: string): Promise<void>;
}

export class InMemoryTripMemberRepository implements TripMemberRepository {
  private readonly membersByTrip = new Map<string, TripMember[]>();

  async listByTrip(tripId: string): Promise<TripMember[]> {
    return [...(this.membersByTrip.get(tripId) ?? [])];
  }

  async add(tripId: string, member: TripMember): Promise<TripMember> {
    const current = this.membersByTrip.get(tripId) ?? [];

    const existingIndex = current.findIndex((item) => item.userId === member.userId);

    if (existingIndex >= 0) {
      const existing = current[existingIndex]!;

      if (existing.active) {
        throw new Error("DUPLICATE_MEMBER");
      }

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

  async remove(tripId: string, userId: string): Promise<void> {
    const current = this.membersByTrip.get(tripId) ?? [];
    const now = new Date().toISOString();
    this.membersByTrip.set(tripId, current.map((member) => (member.userId === userId ? { ...member, active: false, removedAt: now } : member)));
  }
}

export class PostgresTripMemberRepository implements TripMemberRepository {
  constructor(private readonly pool: Pool) {}

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

  async update(tripId: string, userId: string, patch: TripMemberPatch): Promise<TripMember | null> {
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

  async remove(tripId: string, userId: string): Promise<void> {
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

function rowToMember(row: MemberRow): TripMember {
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

function parseTravelStatus(value: string | null): TripMemberTravelStatus {
  return value === "resting" || value === "need-help" || value === "offline" ? value : "riding";
}

function parseAvatarColor(value: string | null): TripMemberAvatarColor {
  return value === "sky" || value === "green" || value === "amber" || value === "rose" || value === "violet" ? value : "teal";
}

function parseBackgroundKey(value: string | null): TripMemberBackgroundKey {
  return value === "coast" || value === "mountain" || value === "night" || value === "sunrise" ? value : "forest";
}
