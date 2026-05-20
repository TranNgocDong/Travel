import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createPool } from "./config.js";

export async function runMigrations() {
  const pool = createPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const migrationDir = join(process.cwd(), "migrations");
    const files = (await readdir(migrationDir)).filter((file) => file.endsWith(".sql")).sort();

    for (const file of files) {
      const applied = await client.query("SELECT 1 FROM schema_migrations WHERE id = $1", [file]);

      if (applied.rowCount) {
        continue;
      }

      const sql = await readFile(join(migrationDir, file), "utf8");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [file]);
      console.log(`Applied migration ${file}`);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runMigrations();
}
