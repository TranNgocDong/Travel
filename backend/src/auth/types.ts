export interface UserAccount {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  roles: string[];
  status: "active" | "locked" | "deleted";
}

export interface SafeUser {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
}

export interface RefreshSession {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

/**
 * Removes sensitive account fields before returning user data to the frontend.
 */
export function toSafeUser(user: UserAccount): SafeUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    roles: user.roles,
  };
}
