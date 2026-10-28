import pg from "pg";
const days = Number(process.env.HISTORY_RETENTION_DAYS || 90);
if (!Number.isInteger(days) || days < 7 || days > 3650)
  throw Error("HISTORY_RETENTION_DAYS must be 7 to 3650.");
if (!process.env.DATABASE_ADMIN_URL)
  throw Error("DATABASE_ADMIN_URL is required for maintenance.");
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_ADMIN_URL,
  max: 1,
});
const client = await pool.connect();
const apply = process.argv.includes("--apply");
try {
  await client.query("begin");
  const rows = await client.query(
    "select status,count(*)::int as count from lead.jobs where created_at<now()-$1*interval '1 day' and status in ('completed','partial','failed','cancelled') group by status",
    [days],
  );
  const usage = await client.query(
    "select count(*)::int as count from lead.usage where created_at<now()-$1*interval '1 day'",
    [days],
  );
  const drafts = await client.query(
    "select count(*)::int as count from lead.campaign_drafts d where d.created_at<now()-interval '30 days' and not exists(select 1 from lead.jobs j where j.id=d.job_id and j.status in ('queued','running','paused'))",
  );
  if (apply) {
    await client.query("select lead.prune_history($1)", [days]);
  }
  await client.query("commit");
  console.log(
    JSON.stringify({
      mode: apply ? "applied" : "dry-run",
      retentionDays: days,
      jobs: rows.rows,
      usage: usage.rows[0].count,
      drafts: drafts.rows[0].count,
    }),
  );
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  client.release();
  await pool.end();
}
