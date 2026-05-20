import type { TripMemberRepository } from "./tripMemberRepository.js";

export type TripRole = "owner" | "editor" | "viewer";

export class TripAccessService {
  constructor(private readonly memberRepository: TripMemberRepository) {}

  async getRole(tripId: string, userId: string): Promise<TripRole | null> {
    const member = (await this.memberRepository.listByTrip(tripId)).find((item) => item.userId === userId);
    return member?.role ?? null;
  }
}

export function canWriteTrip(role: TripRole | null): boolean {
  return role === "owner" || role === "editor";
}

export function canManageMembers(role: TripRole | null): boolean {
  return role === "owner";
}
