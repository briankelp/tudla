import { database, assertRuntime } from "@lead/database";
import { readConfig, liveReady } from "./config.js";
import { startQueue } from "./queue.js";
const config = readConfig();
if (!liveReady(config)) {
  console.log("Worker is disabled in sample-only mode.");
  process.exit(0);
}
const storage = database(config.databaseUrl, config.poolSize);
await assertRuntime(storage.pool);
const queue = await startQueue(storage.db, config, true);
console.log(JSON.stringify({ event: "worker_ready" }));
async function stop() {
  await queue.stop();
  await storage.pool.end();
  process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
