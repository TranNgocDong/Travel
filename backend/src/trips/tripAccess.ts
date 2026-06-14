import type { TripMemberRepository } from "./tripMemberRepository.js";

export type TripRole = "owner" | "editor" | "viewer";

export class TripAccessService {
  constructor(private readonly memberRepository: TripMemberRepository) {}

  /**
   * Looks up the active membership role for a user in a trip.
   */
  async getRole(tripId: string, userId: string): Promise<TripRole | null> {
    const member = (await this.memberRepository.listByTrip(tripId)).find((item) => item.userId === userId && item.active);
    return member?.role ?? null;
  }
}

/**
 * Checks whether a role can mutate trip content such as expenses and routes.
 */
export function canWriteTrip(role: TripRole | null): boolean {
  return role === "owner" || role === "editor";
}

/**
 * Checks whether a role can manage room membership and roles.
 */
export function canManageMembers(role: TripRole | null): boolean {
  return role === "owner";
}
