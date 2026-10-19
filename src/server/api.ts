import { Hono } from "hono";
import { AUTH_PROVIDERS, callbackUrl, passwordAuthEnabled } from "./auth";
import { countActiveAdmins, findAppUser, requireAdmin, requireSession, requireUser, type AppEnv } from "./access";
import { db, findDoneDownloadId, getDownload } from "./db";
import { findCachedImage, IMAGE_ITEM_LIMIT, saveCachedImage } from "./imageCache";
import { downloadName, chapterDownloadName, buildMangaZip, createDownload, deleteDownload, concurrency, setConcurrency } from "./downloads";
import { contentDisposition, serveFile } from "./files";
import { animeStreamResponse } from "./media";
import { coverUrl, getChapterImage } from "./sources/mangadex";
import { coverUrl as weebCoverUrl, getChapterImage as weebChapterImage } from "./sources/weebcentral";
import { coverUrl as pillCoverUrl, getChapterImage as pillChapterImage } from "./sources/mangapill";
import { popularAnime } from "./sources/hianime";
import {
  animeOrdered,
  contentProviders,
  knownProvider,
  mangaOrdered,
  tryProviders,
} from "./sources/registry";
import { UA, mangaLang } from "./config";
import { isAnimeId, assertPublicHttpsUrl, assertResolvesPublic, isMangaId, isMangaPillId, isWeebCentralId, sanitizeFilename } from "./util";
import type { DownloadJob, Kind } from "../shared/types";

export const api = new Hono<AppEnv>();

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function intParam(value: string, fallback = 1, max = 100_000): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), max) : fallback;
}

function validKind(v: string): v is Kind {
  return v === "manga" || v === "anime";
}

function validCover(v: unknown): string | null {
  const s = str(v, 2000);
  return s.startsWith("/api/img/") ? s : null;
}

function validEmail(v: string): boolean {
  return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

// ponytail: allowlisted filter params only — unknown values dropped, never forwarded.
function oneOf(v: unknown, allowed: string[]): string | undefined {
  const s = str(v, 40);
  return allowed.includes(s) ? s : undefined;
}

const MANGA_STATUS = ["ongoing", "completed", "hiatus", "cancelled"];
const MANGA_SORTS = ["relevance", "followedCount", "latestUploadedChapter", "rating"];
const MANGA_DEMOGRAPHICS = ["shounen", "shoujo", "josei", "seinen", "none"];
const ANIME_TYPES = ["tv", "movie", "ova", "ona", "special", "music"];
const ANIME_STATUS = ["completed", "releasing", "not_yet_aired"];
const ANIME_SORTS = ["updated_date", "added_date", "release_date", "trending", "title_az", "avg_score", "mal_score", "most_viewed", "most_followed", "episode_count"];

function mangaFilters(c: any) {
  return {
    status: oneOf(c.req.query("status"), MANGA_STATUS),
    sort: oneOf(c.req.query("sort"), MANGA_SORTS),
    demographic: oneOf(c.req.query("demographic"), MANGA_DEMOGRAPHICS),
  };
}

function animeFilters(c: any) {
  return {
    type: oneOf(c.req.query("type"), ANIME_TYPES),
    status: oneOf(c.req.query("status"), ANIME_STATUS),
    sort: oneOf(c.req.query("sort"), ANIME_SORTS),
  };
}
function providerOf(c: any, kind: Kind): string | undefined {
  const p = str(c.req.query("provider"), 40);
  return p || undefined;
}

function badProvider(c: any, kind: Kind): boolean {
  const p = providerOf(c, kind);
  return !!p && !knownProvider(kind, p);
}

function jobForItem(kind: Kind, itemId: string, lang?: string | null): DownloadJob | null {
  const id = findDoneDownloadId(kind, itemId, lang);
  return id === null ? null : getDownload(id);
}

api.get("/health", (c) => c.json({ ok: true }));

api.get("/providers", (c) =>
  c.json({
    providers: AUTH_PROVIDERS,
    password: passwordAuthEnabled,
    callbacks: AUTH_PROVIDERS.map((p) => ({ ...p, url: callbackUrl(p.id) })),
  }),
);

api.get("/content-providers", requireUser, (c) => c.json({ items: contentProviders() }));

api.get("/me", requireSession, async (c) => {
  const session = c.get("session");
  const email = session.user.email?.trim().toLowerCase();
  if (!email) return c.json({ error: "Your identity provider did not return an email address." }, 403);
  const { upsertAppUser } = await import("./db");
  const appUser = upsertAppUser(email, session.user.name || null);
  return c.json({
    user: { email, name: session.user.name || null, image: session.user.image || null },
    appUser,
  });
});

// ---------- favourites ----------

api.get("/favourites", requireUser, (c) => {
  const email = c.get("appUser").email;
  const rows = db
    .query("SELECT kind, source_id, title, cover, created_at FROM favourites WHERE email = ? ORDER BY created_at DESC")
    .all(email) as any[];
  return c.json({
    items: rows.map((r) => ({
      kind: r.kind,
      sourceId: r.source_id,
      title: r.title,
      cover: r.cover,
      createdAt: r.created_at,
    })),
  });
});

api.post("/favourites", requireUser, async (c) => {
  const body = obj(await c.req.json().catch(() => null));
  const kind = str(body.kind, 10);
  const sourceId = str(body.sourceId, 200);
  const title = str(body.title, 300);
  const cover = validCover(body.cover);
  if (!validKind(kind) || !title) return c.json({ error: "Invalid favourite" }, 400);
  if (kind === "manga" && !isMangaId(sourceId)) return c.json({ error: "Invalid manga id" }, 400);
  if (kind === "anime" && !isAnimeId(sourceId)) return c.json({ error: "Invalid anime id" }, 400);

  db.query(
    "INSERT OR IGNORE INTO favourites (email, kind, source_id, title, cover, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(c.get("appUser").email, kind, sourceId, title, cover, Date.now());
  return c.json({ ok: true }, 201);
});

api.delete("/favourites/:kind/:sourceId", requireUser, (c) => {
  const kind = c.req.param("kind");
  if (!validKind(kind)) return c.json({ error: "Invalid kind" }, 400);
  db.query("DELETE FROM favourites WHERE email = ? AND kind = ? AND source_id = ?").run(
    c.get("appUser").email,
    kind,
    c.req.param("sourceId"),
  );
  return c.json({ ok: true });
});

// ---------- manga ----------

api.get("/manga/search", requireUser, async (c) => {
  if (badProvider(c, "manga")) return c.json({ error: "Unknown provider" }, 400);
  const q = str(c.req.query("q"), 200);
  const lang = mangaLang(c.req.query("lang"));
  const page = intParam(c.req.query("page") || "1", 1, 500);
  const filters = mangaFilters(c);
  const clean = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined));
  const { result: data, providerId } = await tryProviders(mangaOrdered(providerOf(c, "manga")), (p) =>
    p.search(q, lang, page, clean),
  );
  c.header("Cache-Control", "private, max-age=30");
  return c.json({ ...data, providerId });
});

api.get("/manga/popular", requireUser, async (c) => {
  if (badProvider(c, "manga")) return c.json({ error: "Unknown provider" }, 400);
  const lang = mangaLang(c.req.query("lang"));
  const page = intParam(c.req.query("page") || "1", 1, 500);
  const filters = mangaFilters(c);
  const clean = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined));
  const { result: data, providerId } = await tryProviders(mangaOrdered(providerOf(c, "manga")), (p) =>
    p.popular(lang, page, clean),
  );
  c.header("Cache-Control", "private, max-age=120");
  return c.json({ items: data.items, total: data.total, providerId });
});

api.get("/manga/chapter/:chapterId", requireUser, async (c) => {
  if (badProvider(c, "manga")) return c.json({ error: "Unknown provider" }, 400);
  const chapterId = c.req.param("chapterId");
  if (!isMangaId(chapterId)) return c.json({ error: "Invalid chapter id" }, 400);
  const quality = c.req.query("q") === "hq" ? "data" : "data-saver";
  const { result: chapter, providerId } = await tryProviders(mangaOrdered(providerOf(c, "manga")), (p) =>
    p.chapter(chapterId, quality),
  );
  return c.json({ ...chapter, providerId, downloadId: findDoneDownloadId("manga", chapterId) });
});

let activeZips = 0;
api.get("/manga/chapter/:chapterId/file", requireUser, async (c) => {
  const chapterId = c.req.param("chapterId");
  if (!isMangaId(chapterId)) return c.json({ error: "Invalid chapter id" }, 400);

  const existing = jobForItem("manga", chapterId);
  if (existing?.status === "done") {
    const row = db.query("SELECT file_path FROM downloads WHERE id = ?").get(existing.id) as { file_path: string } | null;
    if (row?.file_path) {
      return serveFile(c, row.file_path, { downloadName: downloadName(existing, "cbz") });
    }
  }

  if (activeZips >= 2) return c.json({ error: "Too many chapter downloads in progress" }, 429);
  activeZips++;
  try {
    const name = await chapterDownloadName(chapterId);
    const data = await buildMangaZip(chapterId, c.req.raw.signal);
    return new Response(data as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.comicbook+zip",
        "Content-Disposition": contentDisposition(name),
        "Content-Length": String(data.length),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } finally {
    activeZips--;
  }
});

api.get("/manga/:id/chapters", requireUser, async (c) => {
  if (badProvider(c, "manga")) return c.json({ error: "Unknown provider" }, 400);
  const id = c.req.param("id");
  if (!isMangaId(id)) return c.json({ error: "Invalid manga id" }, 400);
  const lang = mangaLang(c.req.query("lang"));
  const { result: items, providerId } = await tryProviders(mangaOrdered(providerOf(c, "manga")), (p) =>
    p.chapters(id, lang),
  );
  c.header("Cache-Control", "private, max-age=120");
  return c.json({ items, lang, providerId });
});

api.get("/manga/:id", requireUser, async (c) => {
  if (badProvider(c, "manga")) return c.json({ error: "Unknown provider" }, 400);
  const id = c.req.param("id");
  if (!isMangaId(id)) return c.json({ error: "Invalid manga id" }, 400);
  const lang = mangaLang(c.req.query("lang"));
  const { result: manga, providerId } = await tryProviders(mangaOrdered(providerOf(c, "manga")), (p) => p.get(id));
  c.header("Cache-Control", "private, max-age=300");
  return c.json({ ...manga, lang, providerId });
});

api.get("/img/manga/:id/:file", requireUser, async (c) => {
  const size = c.req.query("size") === "512" ? "512" : "256";
  const id = c.req.param("id");
  let url: string;
  try {
    // ponytail: WeebCentral/MangaPill covers resolve server-side (no open ?u= proxy); file must be "cover".
    if (isWeebCentralId(id)) {
      if (c.req.param("file") !== "cover") throw new Error("Invalid cover");
      url = await weebCoverUrl(id);
    } else if (isMangaPillId(id)) {
      if (c.req.param("file") !== "cover") throw new Error("Invalid cover");
      url = await pillCoverUrl(id);
    } else {
      url = coverUrl(id, c.req.param("file"), size);
    }
  } catch {
    return c.json({ error: "Invalid cover" }, 400);
  }
  return proxyImage(c, url, "public, max-age=604800, stale-while-revalidate=86400");
});

api.get("/img/page/:chapterId/:index", requireUser, async (c) => {
  const chapterId = c.req.param("chapterId");
  if (!isMangaId(chapterId)) return c.json({ error: "Invalid chapter id" }, 400);
  const index = intParam(c.req.param("index"), -1, 10_000);
  if (index < 0) return c.json({ error: "Invalid page" }, 400);
  const quality = c.req.query("q") === "hq" ? "data" : "data-saver";
  try {
    const image = isWeebCentralId(chapterId)
      ? await weebChapterImage(chapterId, index, quality)
      : isMangaPillId(chapterId)
        ? await pillChapterImage(chapterId, index, quality)
        : await getChapterImage(chapterId, index, quality);
    return proxyImage(c, image.url, "public, max-age=31536000, immutable");
  } catch (err: any) {
    return c.json({ error: err?.message || "Image unavailable" }, 404);
  }
});

// ---------- anime ----------

api.get("/anime/search", requireUser, async (c) => {
  if (badProvider(c, "anime")) return c.json({ error: "Unknown provider" }, 400);
  const q = str(c.req.query("q"), 200);
  const page = intParam(c.req.query("page") || "1", 1, 100);
  const filters = animeFilters(c);
  const clean = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined));
  const { result: items, providerId } = await tryProviders(animeOrdered(providerOf(c, "anime")), (p) =>
    p.search(q, page, clean),
  );
  c.header("Cache-Control", "private, max-age=60");
  return c.json({ items, providerId });
});

api.get("/anime/popular", requireUser, async (c) => {
  const page = intParam(c.req.query("page") || "1", 1, 100);
  const filters = animeFilters(c);
  const clean = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined));
  const items = await popularAnime(page, clean);
  c.header("Cache-Control", "private, max-age=300");
  return c.json({ items });
});

api.get("/anime/stream/:episodeId", requireUser, async (c) => {
  if (badProvider(c, "anime")) return c.json({ error: "Unknown provider" }, 400);
  const episodeId = c.req.param("episodeId");
  if (!/^\d{1,10}$/.test(episodeId)) return c.json({ error: "Invalid episode id" }, 400);
  const lang = c.req.query("lang") === "dub" ? "dub" : "sub";
  const download = c.req.query("download") === "1";
  const name = download ? `${sanitizeFilename(str(c.req.query("name"), 140), `episode-${episodeId}`)}.mp4` : undefined;

  const existing = jobForItem("anime", episodeId, lang);
  if (existing?.status === "done") {
    const row = db.query("SELECT file_path FROM downloads WHERE id = ?").get(existing.id) as { file_path: string } | null;
    if (row?.file_path) return serveFile(c, row.file_path, { downloadName: name });
  }

  return animeStreamResponse(c, episodeId, lang, name, providerOf(c, "anime"));
});

api.get("/anime/subtitle/:episodeId", requireUser, async (c) => {
  if (badProvider(c, "anime")) return c.json({ error: "Unknown provider" }, 400);
  const episodeId = c.req.param("episodeId");
  if (!/^\d{1,10}$/.test(episodeId)) return c.json({ error: "Invalid episode id" }, 400);
  const lang = c.req.query("lang") === "dub" ? "dub" : "sub";
  try {
    const { result: sub, providerId } = await tryProviders(animeOrdered(providerOf(c, "anime")), (p) =>
      p.subtitle(episodeId, lang),
    );
    if (!sub) return c.body(null, 404);
    c.header("X-Provider", providerId);
    return new Response(sub.body, {
      headers: {
        "Content-Type": "text/vtt; charset=utf-8",
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return c.body(null, 404);
  }
});

api.get("/anime/:id/episodes", requireUser, async (c) => {
  if (badProvider(c, "anime")) return c.json({ error: "Unknown provider" }, 400);
  const id = c.req.param("id");
  if (!isAnimeId(id)) return c.json({ error: "Invalid anime id" }, 400);
  const { result: items, providerId } = await tryProviders(animeOrdered(providerOf(c, "anime")), (p) => p.episodes(id));
  c.header("Cache-Control", "private, max-age=600");
  return c.json({ items, providerId });
});

api.get("/anime/:id", requireUser, async (c) => {
  if (badProvider(c, "anime")) return c.json({ error: "Unknown provider" }, 400);
  const id = c.req.param("id");
  if (!isAnimeId(id)) return c.json({ error: "Invalid anime id" }, 400);
  const { result: anime, providerId } = await tryProviders(animeOrdered(providerOf(c, "anime")), (p) => p.get(id));
  c.header("Cache-Control", "private, max-age=600");
  return c.json({ ...anime, providerId });
});

api.get("/img/anime", requireUser, async (c) => {
  let url: URL;
  try {
    url = new URL(str(c.req.query("u"), 2000));
  } catch {
    return c.json({ error: "Invalid image" }, 400);
  }
  const host = url.hostname.toLowerCase();
  const allowed =
    url.protocol === "https:" &&
    (host === "hianime.at" || host.endsWith(".hianime.at") || host === "anipixcdn.co" || host.endsWith(".anipixcdn.co"));
  if (!allowed) return c.json({ error: "Invalid image host" }, 400);
  return proxyImage(c, url.toString(), "public, max-age=604800, stale-while-revalidate=86400", "https://hianime.at/");
});

// ---------- downloads ----------

api.get("/downloads", requireUser, (c) => {
  const rows = db.query("SELECT * FROM downloads ORDER BY created_at DESC LIMIT 500").all() as any[];
  return c.json({
    items: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      sourceId: r.source_id,
      itemId: r.item_id,
      title: r.title,
      label: r.label,
      cover: r.cover,
      lang: r.lang,
      status: r.status,
      progress: r.progress,
      size: r.size,
      error: r.error,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
  });
});

api.post("/downloads", requireUser, async (c) => {
  const body = obj(await c.req.json().catch(() => null));
  const kind = str(body.kind, 10);
  const sourceId = str(body.sourceId, 200);
  const itemId = str(body.itemId, 200);
  const title = str(body.title, 300);
  const label = str(body.label, 120);
  const cover = validCover(body.cover);
  const lang = str(body.lang, 20) || null;

  if (!validKind(kind) || !title || !label) return c.json({ error: "Invalid download request" }, 400);
  if (kind === "manga" && (!isMangaId(sourceId) || !isMangaId(itemId))) return c.json({ error: "Invalid manga ids" }, 400);
  if (kind === "anime" && (!isAnimeId(sourceId) || !/^\d{1,10}$/.test(itemId))) {
    return c.json({ error: "Invalid anime ids" }, 400);
  }
  if (kind === "anime" && lang !== "sub" && lang !== "dub") return c.json({ error: "Invalid language" }, 400);

  try {
    return c.json(createDownload({ kind, sourceId, itemId, title, label, cover, lang: kind === "anime" ? lang : null }), 201);
  } catch (err: any) {
    return c.json({ error: err?.message || "Could not queue download" }, 429);
  }
});

api.get("/downloads/:id/file", requireUser, (c) => {
  const id = intParam(c.req.param("id"), -1);
  const row = db.query("SELECT * FROM downloads WHERE id = ?").get(id) as any;
  if (!row || row.status !== "done" || !row.file_path) return c.json({ error: "File not ready" }, 404);
  const job = { ...row, sourceId: row.source_id, itemId: row.item_id, createdAt: row.created_at, updatedAt: row.updated_at } as DownloadJob;
  const ext = String(row.file_path).split(".").pop() || "bin";
  const wantsDownload = c.req.query("dl") === "1" || row.kind === "manga";
  return serveFile(c, row.file_path, { downloadName: wantsDownload ? downloadName(job, ext) : undefined });
});

api.delete("/downloads/:id", requireAdmin, (c) => {
  const id = intParam(c.req.param("id"), -1);
  if (id < 0) return c.json({ error: "Invalid id" }, 400);
  deleteDownload(id);
  return c.json({ ok: true });
});

// ---------- admin ----------

api.get("/admin/settings", requireAdmin, (c) => {
  return c.json({ concurrentDownloads: concurrency() });
});

api.patch("/admin/settings", requireAdmin, async (c) => {
  const body = obj(await c.req.json().catch(() => null));
  if (body.concurrentDownloads === undefined) return c.json({ concurrentDownloads: concurrency() });
  const n = Number(body.concurrentDownloads);
  if (!Number.isFinite(n)) return c.json({ error: "Invalid value" }, 400);
  return c.json({ concurrentDownloads: setConcurrency(n) });
});

api.get("/admin/users", requireAdmin, (c) => {
  const rows = db
    .query(
      `SELECT u.*, (SELECT COUNT(*) FROM favourites f WHERE f.email = u.email) AS favourites
       FROM app_users u ORDER BY u.created_at ASC`,
    )
    .all() as any[];
  return c.json({
    items: rows.map((r) => ({
      email: r.email,
      name: r.name,
      role: r.role,
      status: r.status,
      createdAt: r.created_at,
      lastLoginAt: r.last_login_at,
      favourites: r.favourites,
    })),
  });
});

api.post("/admin/users", requireAdmin, async (c) => {
  const body = obj(await c.req.json().catch(() => null));
  const email = str(body.email, 254).toLowerCase();
  const role = str(body.role, 10) === "admin" ? "admin" : "user";
  if (!validEmail(email)) return c.json({ error: "Enter a valid email address" }, 400);

  const existing = findAppUser(email);
  if (existing?.role === "admin" && existing.status === "active" && role !== "admin" && countActiveAdmins() <= 1) {
    return c.json({ error: "You cannot demote the last admin" }, 400);
  }

  if (existing) {
    db.query("UPDATE app_users SET role = ?, status = 'active' WHERE email = ?").run(role, email);
  } else {
    db.query("INSERT INTO app_users (email, name, role, status, created_at) VALUES (?, NULL, ?, 'active', ?)").run(
      email,
      role,
      Date.now(),
    );
  }
  return c.json({ ok: true, user: findAppUser(email) }, 201);
});

api.patch("/admin/users/:email", requireAdmin, async (c) => {
  const email = decodeURIComponent(c.req.param("email")).toLowerCase();
  const body = obj(await c.req.json().catch(() => null));
  const target = findAppUser(email);
  if (!target) return c.json({ error: "User not found" }, 404);
  if (target.email === c.get("appUser").email) return c.json({ error: "You cannot change your own access" }, 400);

  const role = body.role === undefined ? target.role : str(body.role, 10);
  const status = body.status === undefined ? target.status : str(body.status, 10);
  if (role !== "admin" && role !== "user") return c.json({ error: "Invalid role" }, 400);
  if (status !== "active" && status !== "pending" && status !== "blocked") return c.json({ error: "Invalid status" }, 400);
  if (target.role === "admin" && target.status === "active" && (role !== "admin" || status !== "active") && countActiveAdmins() <= 1) {
    return c.json({ error: "You cannot remove the last admin" }, 400);
  }

  db.query("UPDATE app_users SET role = ?, status = ? WHERE email = ?").run(role, status, email);
  return c.json({ ok: true, user: findAppUser(email) });
});

api.delete("/admin/users/:email", requireAdmin, (c) => {
  const email = decodeURIComponent(c.req.param("email")).toLowerCase();
  const target = findAppUser(email);
  if (!target) return c.json({ error: "User not found" }, 404);
  if (target.email === c.get("appUser").email) return c.json({ error: "You cannot remove yourself" }, 400);
  if (target.role === "admin" && target.status === "active" && countActiveAdmins() <= 1) {
    return c.json({ error: "You cannot remove the last admin" }, 400);
  }
  db.query("DELETE FROM favourites WHERE email = ?").run(email);
  db.query("DELETE FROM app_users WHERE email = ?").run(email);
  return c.json({ ok: true });
});

api.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

function imageResponse(path: string, type: string, cacheControl: string): Response {
  return new Response(Bun.file(path), {
    status: 200,
    headers: {
      "Content-Type": type,
      "Cache-Control": cacheControl,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function proxyImage(c: any, url: string, cacheControl: string, referer?: string): Promise<Response> {
  const cached = findCachedImage(url);
  if (cached) return imageResponse(cached.path, cached.type, cacheControl);

  let upstream: Response | null = null;
  try {
    let target = assertPublicHttpsUrl(url);
    const headers = { "User-Agent": referer ? UA : "AniManga/1.0", ...(referer ? { Referer: referer } : {}) };
    for (let hop = 0; hop < 4; hop++) {
      await assertResolvesPublic(target);
      const res = await fetch(target, { headers, signal: AbortSignal.timeout(30_000), redirect: "manual" });
      if (res.status < 300 || res.status >= 400) {
        upstream = res;
        break;
      }
      const location = res.headers.get("location");
      if (!location) break;
      target = assertPublicHttpsUrl(new URL(location, target).toString());
    }
  } catch {
    return c.body(null, 502);
  }
  if (!upstream) return c.body(null, 502);
  if (!upstream.ok) return c.body(null, upstream.status === 404 ? 404 : 502);
  const type = upstream.headers.get("content-type") || "application/octet-stream";
  if (!type.startsWith("image/")) return c.body(null, 502);

  const length = Number(upstream.headers.get("content-length") || 0);
  if (length > IMAGE_ITEM_LIMIT) return c.body(null, 502);

  let bytes: Uint8Array;
  try {
    const reader = upstream.body?.getReader();
    if (!reader) return c.body(null, 502);
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > IMAGE_ITEM_LIMIT) {
        await reader.cancel();
        return c.body(null, 502);
      }
      chunks.push(value);
    }
    bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
  } catch {
    return c.body(null, 502);
  }
  if (bytes.length === 0) return c.body(null, 502);
  await saveCachedImage(url, bytes, type);

  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": type,
      "Cache-Control": cacheControl,
      "Content-Length": String(bytes.length),
      "X-Content-Type-Options": "nosniff",
    },
  });
}
