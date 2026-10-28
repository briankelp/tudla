import { database, connections, eq } from "@lead/database";
import { readConfig } from "../apps/server/dist/config.js";
import { seal, unseal } from "../apps/server/dist/security.js";
const config = readConfig();
if (!process.env.DATABASE_ADMIN_URL || !config.encryptionKey)
  throw Error(
    "A migration connection and versioned encryption keys are required.",
  );
const apply = process.argv.includes("--apply");
const storage = database(process.env.DATABASE_ADMIN_URL, 1);
try {
  const count = await storage.db.transaction(async (tx) => {
    const rows = await tx.select().from(connections).for("update");
    let changed = 0;
    for (const row of rows) {
      if (row.encryptedKey.version === config.encryptionVersion) continue;
      const key = unseal(
        config.encryptionKeys,
        row.encryptedKey,
        `${row.workspaceId}:${row.provider}`,
      );
      const envelope = seal(
        config.encryptionKey,
        key,
        `${row.workspaceId}:${row.provider}`,
        config.encryptionVersion,
      );
      if (apply)
        await tx
          .update(connections)
          .set({ encryptedKey: envelope })
          .where(eq(connections.id, row.id));
      changed++;
    }
    return changed;
  });
  console.log(
    JSON.stringify({
      mode: apply ? "applied" : "dry-run",
      connections: count,
      targetVersion: config.encryptionVersion,
    }),
  );
} finally {
  await storage.pool.end();
}
