import { database } from "./index.js";
import { migrate } from "drizzle-orm/node-postgres/migrator";
const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw Error("DATABASE_ADMIN_URL is required for migrations.");
const { db, pool } = database(url, 1);
try {
  await migrate(db, {
    migrationsFolder: new URL("../drizzle", import.meta.url).pathname,
  });
  console.log("Database migrations complete.");
} finally {
  await pool.end();
}
