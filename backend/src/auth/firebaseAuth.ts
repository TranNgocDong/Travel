import { createRemoteJWKSet, jwtVerify } from "jose";

import type { UserAccount } from "./types.js";
import { normalizeEmail, userIdFromEmail } from "./userIdentity.js";

const firebaseProjectId = process.env.FIREBASE_PROJECT_ID || "travel-b226f";
const firebaseIssuer = `https://securetoken.google.com/${firebaseProjectId}`;
const firebaseJwks = createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));

export async function verifyFirebaseBearerToken(token: string): Promise<UserAccount> {
  const result = await jwtVerify(token, firebaseJwks, {
    audience: firebaseProjectId,
    issuer: firebaseIssuer,
  });

  const payload = result.payload;

  if (!payload.sub || typeof payload.sub !== "string") {
    throw new Error("Firebase token is missing subject");
  }

  const email = typeof payload.email === "string" ? normalizeEmail(payload.email) : null;
  const displayName = typeof payload.name === "string" ? payload.name : undefined;

  return {
    id: email ? userIdFromEmail(email) : payload.sub,
    email: email ?? `${payload.sub}@firebase.local`,
    displayName: displayName ?? email ?? "Firebase User",
    passwordHash: "",
    roles: ["USER"],
    status: "active",
  };
}
