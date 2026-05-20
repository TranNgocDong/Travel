import { Pool } from "pg";

export function getDatabaseUrl(): string | null {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  return databaseUrl ? databaseUrl : null;
}

export function createPool(): Pool {
  const connectionString = getDatabaseUrl();

  if (!connectionString) {
    throw new Error("DATABASE_URL is required for PostgreSQL mode");
  }

  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ...(databaseSslEnabled() ? { ssl: { rejectUnauthorized: databaseSslRejectUnauthorized() } } : {}),
  });
}

export async function pingDatabase(pool: Pool): Promise<void> {
  await pool.query("SELECT 1");
}

function databaseSslEnabled(): boolean {
  const value = (process.env.DATABASE_SSL ?? process.env.PGSSLMODE ?? "").trim().toLowerCase();
  return value === "true" || value === "1" || value === "require" || value === "required";
}

function databaseSslRejectUnauthorized(): boolean {
  const value = (process.env.DATABASE_SSL_REJECT_UNAUTHORIZED ?? "").trim().toLowerCase();
  return value !== "false" && value !== "0";
}
