import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { serveStatic } from "hono/bun";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getMigrations } from "better-auth/db/migration";
import { auth } from "./auth";
import { api } from "./api";
import { BASE_URL, DIST_DIR, isTrustedOrigin, PORT } from "./config";
import { pruneCache } from "./cache";
import { pruneImageCache } from "./imageCache";
import { recoverDownloads } from "./downloads";

const migrations = await getMigrations(auth.options);
await migrations.runMigrations();
recoverDownloads();
pruneCache();
pruneImageCache();
setInterval(pruneCache, 60 * 60 * 1000);
setInterval(pruneImageCache, 60 * 60 * 1000);

const app = new Hono();

app.use(
  "*",
  secureHeaders({
    strictTransportSecurity: BASE_URL.startsWith("https://") ? "max-age=15552000; includeSubDomains" : false,
    xFrameOptions: "DENY",
    crossOriginEmbedderPolicy: false,
    referrerPolicy: "no-referrer",
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", "data:", "blob:"],
      mediaSrc: ["'self'"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
    permissionsPolicy: { camera: [], microphone: [], geolocation: [] },
  }),
);

app.use("*", async (c, next) => {
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD" && c.req.path.startsWith("/api/") && !c.req.path.startsWith("/api/auth/")) {
    const origin = c.req.header("origin");
    if (origin && !isTrustedOrigin(origin) && origin !== new URL(c.req.url).origin) {
      return c.json({ error: "Invalid origin" }, 403);
    }
  }
  await next();
});

app.all("/api/auth/*", (c) => auth.handler(c.req.raw));
app.route("/api", api);
app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

const indexHtml = join(DIST_DIR, "index.html");
if (existsSync(indexHtml)) {
  app.use(
    "/*",
    serveStatic({
      root: "./dist",
      onFound: (path, c) => {
        if (path.endsWith(".html")) c.header("Cache-Control", "no-cache");
        else if (/index-[\w.-]+\.(js|css)$/.test(path)) c.header("Cache-Control", "public, max-age=31536000, immutable");
        else c.header("Cache-Control", "public, max-age=3600");
      },
    }),
  );
  app.get("*", serveStatic({ path: "dist/index.html", onFound: (_path, c) => c.header("Cache-Control", "no-cache") }));
} else {
  app.get("*", (c) => c.text("Frontend not built. Run: bun run build", 503));
}

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  console.error("[server]", err);
  return c.json({ error: err.message || "Server error" }, 500);
});

Bun.serve({
  port: PORT,
  fetch: app.fetch,
  idleTimeout: 120,
});

console.log(`AniManga listening on ${BASE_URL} (port ${PORT})`);
