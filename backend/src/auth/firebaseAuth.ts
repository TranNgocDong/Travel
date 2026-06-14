import { createRemoteJWKSet, jwtVerify } from "jose";

import type { UserAccount } from "./types.js";
import { normalizeEmail, userIdFromEmail } from "./userIdentity.js";

const firebaseProjectId = process.env.FIREBASE_PROJECT_ID || "travel-b226f";
const firebaseIssuer = `https://securetoken.google.com/${firebaseProjectId}`;
// Google rotates Firebase signing keys. createRemoteJWKSet fetches and caches the public keys
// used to verify ID tokens without storing any private service-account secret in this server.
const firebaseJwks = createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));

/**
 * Verifies a Firebase ID token and converts it into the app's UserAccount shape.
 */
export async function verifyFirebaseBearerToken(token: string): Promise<UserAccount> {
  // Verify the token cryptographically and make sure it was issued for this Firebase project.
  // A decoded-but-unverified JWT must never be trusted for authorization.
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

  // The app user id is stable for email accounts, which lets invited members match the same
  // person before and after they sign in. Providers without email fall back to Firebase subject.
  return {
    id: email ? userIdFromEmail(email) : payload.sub,
    email: email ?? `${payload.sub}@firebase.local`,
    displayName: displayName ?? email ?? "Firebase User",
    passwordHash: "",
    roles: ["USER"],
    status: "active",
  };
}
