import { createHash } from "node:crypto";

/**
 * Normalizes email input before validation, lookup, and deterministic id
 * generation.
 */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Performs the backend email format check used by membership invitation flows.
 */
export function isValidEmail(value: string): boolean {
  const email = normalizeEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

/**
 * Creates a stable non-reversible user id for email-invited members.
 */
export function userIdFromEmail(value: string): string {
  const email = normalizeEmail(value);
  const digest = createHash("sha256").update(email).digest("hex").slice(0, 24);
  return `email_${digest}`;
}

/**
 * Generates a readable fallback display name from an email local part.
 */
export function displayNameFromEmail(value: string): string {
  const email = normalizeEmail(value);
  const localPart = email.split("@")[0] || "Thanh vien";
  return localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ")
    .slice(0, 80) || "Thanh vien";
}
