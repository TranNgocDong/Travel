import { createHash } from "node:crypto";

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  const email = normalizeEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

export function userIdFromEmail(value: string): string {
  const email = normalizeEmail(value);
  const digest = createHash("sha256").update(email).digest("hex").slice(0, 24);
  return `email_${digest}`;
}

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
