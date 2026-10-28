import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const web = resolve(root, "apps/web/dist");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3100);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".png": "image/png",
  ".webp": "image/webp",
  ".txt": "text/plain; charset=utf-8",
};
const server = createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  );
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  );
  if (!["GET", "HEAD"].includes(req.method)) {
    res.writeHead(405, { Allow: "GET, HEAD" });
    return res.end();
  }
  try {
    const path = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    if (path.split("/").some((segment) => segment.startsWith("."))) {
      res.writeHead(404);
      return res.end();
    }
    if (path === "/api/health" || path === "/api/config") {
      const body =
        path === "/api/health"
          ? { status: "ok", mode: "demo" }
          : {
              authEnabled: false,
              supabaseUrl: "",
              publishableKey: "",
              compatibleAvailable: false,
            };
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      return res.end(req.method === "HEAD" ? undefined : JSON.stringify(body));
    }
    if (path.startsWith("/api/")) {
      res.writeHead(410);
      return res.end();
    }
    let file = resolve(web, `.${path}`);
    if (file !== web && !file.startsWith(web + sep)) {
      res.writeHead(404);
      return res.end();
    }
    try {
      if ((await stat(file)).isDirectory()) file = resolve(file, "index.html");
    } catch {
      if (!extname(path)) file = resolve(web, "index.html");
    }
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": types[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
server.listen(port, host, () =>
  console.log(
    JSON.stringify({
      event: "listening",
      port: server.address().port,
      mode: "demo",
    }),
  ),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => server.close());
