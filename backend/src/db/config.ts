import { Pool } from "pg";

/**
 * Reads the PostgreSQL connection string from the environment and normalizes
 * empty values to null so callers can choose memory mode safely.
 */
export function getDatabaseUrl(): string | null {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  return databaseUrl ? databaseUrl : null;
}

/**
 * Creates the shared PostgreSQL pool used by repositories in production mode.
 */
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

/**
 * Performs a lightweight connectivity check for health endpoints and startup
 * validation.
 */
export async function pingDatabase(pool: Pool): Promise<void> {
  await pool.query("SELECT 1");
}

/**
 * Detects whether SSL should be enabled for managed PostgreSQL providers.
 */
function databaseSslEnabled(): boolean {
  const value = (process.env.DATABASE_SSL ?? process.env.PGSSLMODE ?? "").trim().toLowerCase();
  return value === "true" || value === "1" || value === "require" || value === "required";
}

/**
 * Controls certificate verification for SSL database connections.
 */
function databaseSslRejectUnauthorized(): boolean {
  const value = (process.env.DATABASE_SSL_REJECT_UNAUTHORIZED ?? "").trim().toLowerCase();
  return value !== "false" && value !== "0";
}
