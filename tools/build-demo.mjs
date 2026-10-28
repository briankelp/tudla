import { spawnSync } from "node:child_process";

// A public demo build cannot inherit a live-auth flag from the host.
const env = { ...process.env, VITE_LIVE_WORKSPACES: "false" };
for (const workspace of ["@lead/contracts", "@lead/web"]) {
  const result = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", "build", "--workspace", workspace],
    { env, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
