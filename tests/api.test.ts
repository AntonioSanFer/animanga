import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const PASSWORD = "correct-horse-battery-staple";
const MANGA_ID = "3f2b9c1e-8a4d-4e6f-9b2a-1c3d5e7f9a0b";

type Client = {
  cookie: () => string;
  request: (path: string, init?: RequestInit) => Promise<Response>;
};

function spawnServer(port: number, dataDir: string) {
  return Bun.spawn([process.execPath, "src/server/index.ts"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      BETTER_AUTH_URL: `http://localhost:${port}`,
      BETTER_AUTH_SECRET: "",
      AUTH_PASSWORD_ENABLED: "1",
      TRUSTED_ORIGINS: "",
      OIDC_ISSUER: "",
      OIDC_DISCOVERY_URL: "",
      OIDC_CLIENT_ID: "",
      OIDC_CLIENT_SECRET: "",
      GITHUB_CLIENT_ID: "",
      GITHUB_CLIENT_SECRET: "",
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
    },
    stdout: "ignore",
    stderr: "pipe",
  });
}

type Child = ReturnType<typeof spawnServer>;

let proc: Child | null = null;
let base = "";
let dataDir = "";
let admin: Client;
let second: Client;

function makeClient(): Client {
  const jar = new Map<string, string>();
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

  return {
    cookie,
    async request(path, init = {}) {
      const headers = new Headers(init.headers);
      const current = cookie();
      if (current) headers.set("cookie", current);
      if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");

      const res = await fetch(base + path, { ...init, headers });
      for (const raw of res.headers.getSetCookie()) {
        const pair = raw.split(";", 1)[0];
        const eq = pair.indexOf("=");
        if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
      }
      return res;
    },
  };
}

async function signUp(client: Client, email: string): Promise<void> {
  const res = await client.request("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password: PASSWORD, name: email.split("@")[0] }),
  });
  expect(res.status).toBe(200);
}

beforeAll(async () => {
  let lastError: unknown;

  for (let attempt = 0; attempt < 5; attempt++) {
    const port = 3900 + Math.floor(Math.random() * 100);
    const dir = mkdtempSync(join(tmpdir(), "animanga-test-"));
    const child = spawnServer(port, dir);
    const healthUrl = `http://localhost:${port}/api/health`;
    const deadline = Date.now() + 15_000;
    let healthy = false;

    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        const stderr = await new Response(child.stderr).text().catch(() => "");
        lastError = new Error(`Server exited with code ${child.exitCode}: ${stderr.slice(-2000)}`);
        break;
      }
      try {
        const res = await fetch(healthUrl, { signal: AbortSignal.timeout(1000) });
        if (res.ok) {
          healthy = true;
          break;
        }
      } catch {}
      await Bun.sleep(100);
    }

    if (healthy) {
      proc = child;
      base = `http://localhost:${port}`;
      dataDir = dir;
      admin = makeClient();
      second = makeClient();
      return;
    }

    lastError ??= new Error("Server did not become healthy within 15s");
    try {
      child.kill();
    } catch {}
    await Promise.race([child.exited, Bun.sleep(3000)]).catch(() => {});
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }

  throw lastError;
});

afterAll(async () => {
  if (proc) {
    try {
      proc.kill();
    } catch {}
    await Promise.race([proc.exited, Bun.sleep(5000)]).catch(() => {});
  }
  if (dataDir) {
    for (let i = 0; i < 10; i++) {
      try {
        rmSync(dataDir, { recursive: true, force: true });
        break;
      } catch {
        await Bun.sleep(200);
      }
    }
  }
});

describe("AniManga API", () => {
  test("rejects unauthenticated favourites access", async () => {
    const res = await makeClient().request("/api/favourites");
    expect(res.status).toBe(401);
  });

  test("first account becomes an active admin", async () => {
    await signUp(admin, "admin@example.com");
    expect(admin.cookie()).toContain("session_token");

    const res = await admin.request("/api/me");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.appUser.role).toBe("admin");
    expect(body.appUser.status).toBe("active");
    expect(body.user.email).toBe("admin@example.com");
  });

  test("second account starts pending and cannot access data", async () => {
    await signUp(second, "second@example.com");

    const res = await second.request("/api/me");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.appUser.status).toBe("pending");

    const favs = await second.request("/api/favourites");
    expect(favs.status).toBe(403);
  });

  test("admin can approve the pending user", async () => {
    const res = await admin.request("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ email: "second@example.com", role: "user" }),
    });
    expect(res.status).toBe(201);

    const me = await second.request("/api/me");
    expect(me.status).toBe(200);
    const body = (await me.json()) as any;
    expect(body.appUser.role).toBe("user");
    expect(body.appUser.status).toBe("active");
  });

  test("approved non-admin cannot use admin endpoints", async () => {
    const res = await second.request("/api/admin/users");
    expect(res.status).toBe(403);
  });

  test("favourites are per-user and removable", async () => {
    const created = await admin.request("/api/favourites", {
      method: "POST",
      body: JSON.stringify({ kind: "manga", sourceId: MANGA_ID, title: "Test Manga", cover: null }),
    });
    expect(created.status).toBe(201);

    const adminList = await admin.request("/api/favourites");
    expect(adminList.status).toBe(200);
    const adminBody = (await adminList.json()) as any;
    expect(adminBody.items).toHaveLength(1);
    expect(adminBody.items[0]).toMatchObject({ kind: "manga", sourceId: MANGA_ID, title: "Test Manga", cover: null });

    const secondList = await second.request("/api/favourites");
    expect(secondList.status).toBe(200);
    expect(((await secondList.json()) as any).items).toHaveLength(0);

    const deleted = await admin.request(`/api/favourites/manga/${MANGA_ID}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);

    const afterDelete = await admin.request("/api/favourites");
    expect(((await afterDelete.json()) as any).items).toHaveLength(0);
  });

  test("validates ids and blocks untrusted origins", async () => {
    const badId = await admin.request("/api/favourites", {
      method: "POST",
      body: JSON.stringify({ kind: "manga", sourceId: "not-a-uuid", title: "Nope", cover: null }),
    });
    expect(badId.status).toBe(400);

    const badOrigin = await admin.request("/api/favourites", {
      method: "POST",
      headers: { origin: "https://evil.example" },
      body: JSON.stringify({ kind: "manga", sourceId: MANGA_ID, title: "Nope", cover: null }),
    });
    expect(badOrigin.status).toBe(403);
  });

  test("manga tags endpoint validates provider and lists genres", async () => {
    const missing = await admin.request("/api/manga/tags");
    expect(missing.status).toBe(400);

    const unknown = await admin.request("/api/manga/tags?provider=nope");
    expect(unknown.status).toBe(400);

    const anime = await admin.request("/api/manga/tags?provider=hianime");
    expect(anime.status).toBe(400);

    const pill = await admin.request("/api/manga/tags?provider=mangapill");
    expect(pill.status).toBe(200);
    const body = (await pill.json()) as any;
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThan(10);
    expect(body.items[0]).toMatchObject({ id: expect.any(String), label: expect.any(String) });
  });
});
