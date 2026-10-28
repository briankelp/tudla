import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("public static demo", () => {
  let child: ChildProcess;
  let site: string;
  beforeAll(async () => {
    child = spawn(process.execPath, ["tools/serve.mjs"], {
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: "0",
        DATABASE_URL: "postgresql://unused@127.0.0.1:9/unused",
        SUPABASE_URL: "https://unused.supabase.co",
        DEMO_ONLY: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    site = await new Promise<string>((resolve, reject) => {
      let output = "";
      child.once("exit", (code) =>
        reject(Error(`Site exited before ready: ${code}`)),
      );
      child.once("error", reject);
      child.stderr!.on("data", (data) => reject(Error(String(data))));
      child.stdout!.on("data", (data) => {
        output += data;
        if (output.includes("\n"))
          resolve(`http://127.0.0.1:${JSON.parse(output.trim()).port}`);
      });
    });
  });
  afterAll(async () => {
    if (!child || child.exitCode !== null) return;
    child.kill();
    await once(child, "exit");
  });
  it("serves the built app while ignoring hosted credentials", async () => {
    expect(await (await fetch(site)).text()).toContain('id="root"');
    expect(await (await fetch(`${site}/api/config`)).json()).toEqual({
      authEnabled: false,
      supabaseUrl: "",
      publishableKey: "",
      compatibleAvailable: false,
    });
    expect(await (await fetch(`${site}/api/health`)).json()).toEqual({
      status: "ok",
      mode: "demo",
    });
    expect((await fetch(`${site}/api/bootstrap`)).status).toBe(410);
  });
  it("serves privacy and redistribution notices without enabling an API", async () => {
    const privacy = await fetch(`${site}/privacy.html`);
    expect(privacy.status).toBe(200);
    expect(await privacy.text()).toContain("Privacy");
    const notices = await fetch(`${site}/THIRD_PARTY_NOTICES.txt`);
    expect(notices.status).toBe(200);
    expect(await notices.text()).toContain("react@");
    expect((await fetch(`${site}/api/workspaces`)).status).toBe(410);
  });
  it("blocks writes and path traversal", async () => {
    expect(
      (await fetch(site, { method: "POST", body: "example" })).status,
    ).toBe(405);
    expect((await fetch(`${site}/%2e%2e%2fpackage.json`)).status).toBe(404);
    expect((await fetch(`${site}/.env`)).status).toBe(404);
    expect((await fetch(`${site}/assets/missing.js`)).status).toBe(404);
    expect(await (await fetch(site, { method: "HEAD" })).text()).toBe("");
  });
  it("keeps local and hosted privacy/security headers consistent", async () => {
    const response = await fetch(site);
    const config = JSON.parse(await readFile("vercel.json", "utf8"));
    for (const header of config.headers[0].headers)
      expect(response.headers.get(header.key)).toBe(header.value);
  });
});
