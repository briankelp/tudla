import { database, assertRuntime } from "@lead/database";
import { createApp } from "./app.js";
import { readConfig, liveReady } from "./config.js";
import { startQueue } from "./queue.js";
const config = readConfig();
const storage = liveReady(config)
  ? database(config.databaseUrl, config.poolSize)
  : null;
if (storage) await assertRuntime(storage.pool);

const queue =
  storage && liveReady(config)
    ? await startQueue(storage.db, config, config.embeddedWorker)
    : null;
const server = createApp(config, storage?.db ?? null).listen(
  config.port,
  "0.0.0.0",
  () =>
    console.log(
      JSON.stringify({
        event: "listening",
        port: config.port,
        mode: liveReady(config) ? "live" : "demo",
      }),
    ),
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  server.close();
  await queue?.stop();
  await storage?.pool.end();
  process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
