import { pathToFileURL } from "node:url";

import { createPool } from "./config.js";

/**
 * Placeholder seed command for production-safe deployments. It verifies the
 * database connection without inserting demo trips into real workspaces.
 */
export async function seedDemoData() {
  const pool = createPool();

  try {
    await pool.query("SELECT 1");
    console.log("No starter trip seed is installed. The app starts with an empty workspace.");
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await seedDemoData();
}
