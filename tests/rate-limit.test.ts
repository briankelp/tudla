import { describe, expect, it } from "vitest";
import supertest from "supertest";
import { createApp } from "../apps/server/src/app.js";
import { readConfig } from "../apps/server/src/config.js";

const app = (env: NodeJS.ProcessEnv = {}) =>
  supertest(createApp(readConfig({ REQUESTS_PER_MINUTE: "2", ...env }), null));

describe("server request limits", () => {
  it("shares a limit across API and static routes and returns retry information", async () => {
    const api = app();
    expect((await api.get("/api/config")).status).toBe(200);
    expect((await api.get("/")).status).toBe(200);
    const blocked = await api.get("/api/health");
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({
      message: "Too many requests. Try again shortly.",
    });
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    expect(blocked.headers.ratelimit).toContain("r=0");
    expect(blocked.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("does not let untrusted forwarded addresses bypass the allowance", async () => {
    const api = app();
    await api.get("/api/config").expect(200);
    await api
      .get("/api/config")
      .set("X-Forwarded-For", "198.51.100.1")
      .expect(200);
    await api
      .get("/api/config")
      .set("X-Forwarded-For", "203.0.113.1")
      .expect(429);
  });

  it("separates clients through an explicitly trusted proxy and ignores a spoofed prefix", async () => {
    const api = app({
      REQUESTS_PER_MINUTE: "1",
      TRUSTED_PROXY_CIDRS: "127.0.0.1/32, ::1/128",
    });
    await api
      .get("/api/config")
      .set("X-Forwarded-For", "198.51.100.1")
      .expect(200);
    await api
      .get("/api/config")
      .set("X-Forwarded-For", "192.0.2.1, 198.51.100.1")
      .expect(429);
    await api
      .get("/api/config")
      .set("X-Forwarded-For", "203.0.113.1")
      .expect(200);
  });

  it.each(["0", "-1", "1.5", "invalid"])(
    "rejects an invalid request limit: %s",
    (value) => {
      expect(() => readConfig({ REQUESTS_PER_MINUTE: value })).toThrow(
        "Invalid REQUESTS_PER_MINUTE",
      );
    },
  );
});
