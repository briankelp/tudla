import pg from "pg";
const admin = process.env.DATABASE_ADMIN_URL;
if (!admin) throw Error("DATABASE_ADMIN_URL is required.");
const quote = (s) => '"' + s.replaceAll('"', '""') + '"';
const literal = (s) => "'" + s.replaceAll("'", "''") + "'";
const pool = new pg.Pool({ connectionString: admin, max: 1 });
try {
  for (const role of ["lead_app", "lead_queue_access"]) {
    if (
      !(await pool.query("select 1 from pg_roles where rolname=$1", [role]))
        .rowCount
    )
      await pool.query(`create role ${quote(role)} nologin`);
  }
  for (const [value, group] of [
    [process.env.DATABASE_URL, "lead_app"],
    [process.env.QUEUE_DATABASE_URL, "lead_queue_access"],
  ]) {
    if (!value) throw Error("Application and queue URLs are required.");
    const url = new URL(value);
    const name = decodeURIComponent(url.username).split(
      url.hostname.endsWith(".pooler.supabase.com") ? "." : "\0",
    )[0];
    const password = decodeURIComponent(url.password);
    if (
      name ===
        decodeURIComponent(new URL(admin).username).split(
          new URL(admin).hostname.endsWith(".pooler.supabase.com") ? "." : "\0",
        )[0] ||
      ["postgres", "lead_app", "lead_queue_access"].includes(name)
    )
      throw Error("Runtime roles must be distinct from the migration role.");
    if (!password) throw Error("Runtime database passwords are required.");
    if (
      !(await pool.query("select 1 from pg_roles where rolname=$1", [name]))
        .rowCount
    )
      await pool.query(
        `create role ${quote(name)} login password ${literal(password)}`,
      );
    else
      await pool.query(
        `alter role ${quote(name)} login nosuperuser nobypassrls nocreatedb nocreaterole password ${literal(password)}`,
      );
    await pool.query(`grant ${quote(group)} to ${quote(name)}`);
  }
  const name = (await pool.query("select current_database() as name")).rows[0]
    .name;
  await pool.query(
    `grant connect on database ${quote(name)} to lead_app,lead_queue_access`,
  );
  await pool.query(
    `grant create on database ${quote(name)} to lead_queue_access`,
  );
  console.log("Runtime database roles configured.");
} finally {
  await pool.end();
}
