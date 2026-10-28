import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as schema from "./schema.js";
export * from "./schema.js";
export { and, eq, desc, asc, inArray, sql, isNull, or, lt } from "drizzle-orm";
export function database(url: string, max = 4) {
  const pool = new pg.Pool({
    connectionString: url,
    max,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 20000,
  });
  pool.on("error", () =>
    console.error(JSON.stringify({ event: "database_pool_error" })),
  );
  return { pool, db: drizzle(pool, { schema }) };
}
export type DB = ReturnType<typeof database>["db"];
export async function assertRuntime(pool: pg.Pool) {
  const result = await pool.query(
    "select rolsuper,rolbypassrls,exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='lead' and pg_has_role(current_user,c.relowner,'MEMBER')) as owns_tables from pg_roles where rolname=current_user",
  );
  const role = result.rows[0];
  if (!role || role.rolsuper || role.rolbypassrls || role.owns_tables)
    throw Error(
      "Use a restricted runtime database role, not an administrator.",
    );
}
export type TX = Parameters<Parameters<DB["transaction"]>[0]>[0];
export async function withIdentity<T>(
  db: DB,
  userId: string,
  email: string,
  fn: (tx: TX) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('lead.user_id',${userId},true),set_config('lead.email',${email},true)`,
    );
    return fn(tx);
  });
}
