import { Database } from "bun:sqlite";
import { DB_PATH } from "./config";
import type { AppUser, DownloadJob, Favourite, Kind } from "../shared/types";

export const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA busy_timeout = 5000");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS app_users (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS favourites (
  email TEXT NOT NULL COLLATE NOCASE,
  kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  title TEXT NOT NULL,
  cover TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (email, kind, source_id)
);

CREATE TABLE IF NOT EXISTS downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  title TEXT NOT NULL,
  label TEXT NOT NULL,
  cover TEXT,
  lang TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  file_path TEXT,
  size INTEGER,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (kind, source_id, item_id, lang)
);
CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status);

CREATE TABLE IF NOT EXISTS cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache(expires);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

export function getSetting(key: string): string | null {
  const row = db.query("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | null;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
}

export type AppUserRow = {
  email: string;
  name: string | null;
  role: "admin" | "user";
  status: "pending" | "active" | "blocked";
  created_at: number;
  last_login_at: number | null;
};

export type DownloadRow = {
  id: number;
  kind: Kind;
  source_id: string;
  item_id: string;
  title: string;
  label: string;
  cover: string | null;
  lang: string | null;
  status: "queued" | "downloading" | "done" | "error";
  progress: number;
  file_path: string | null;
  size: number | null;
  error: string | null;
  created_at: number;
  updated_at: number;
};

function toAppUser(row: AppUserRow): AppUser {
  return {
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

export function findAppUser(email: string): AppUser | null {
  const row = db.query("SELECT * FROM app_users WHERE email = ?").get(email) as AppUserRow | null;
  return row ? toAppUser(row) : null;
}

export function hasActiveAdmin(): boolean {
  const row = db.query("SELECT COUNT(*) AS n FROM app_users WHERE role = 'admin' AND status = 'active'").get() as { n: number };
  return row.n > 0;
}

export function upsertAppUser(email: string, name: string | null): AppUser {
  const now = Date.now();
  const existing = db.query("SELECT * FROM app_users WHERE email = ?").get(email) as AppUserRow | null;
  if (existing) {
    const fresh = !existing.last_login_at || now - existing.last_login_at > 5 * 60_000;
    if (fresh) {
      db.query("UPDATE app_users SET last_login_at = ?, name = COALESCE(NULLIF(name, ''), ?) WHERE email = ?").run(now, name, email);
    } else if (name && !existing.name) {
      db.query("UPDATE app_users SET name = ? WHERE email = ?").run(name, email);
    }
    return findAppUser(email)!;
  }

  const first = !hasActiveAdmin();
  db.query(
    "INSERT INTO app_users (email, name, role, status, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(email, name, first ? "admin" : "user", first ? "active" : "pending", now, now);
  return findAppUser(email)!;
}

export function toDownload(row: DownloadRow): DownloadJob {
  return {
    id: row.id,
    kind: row.kind,
    sourceId: row.source_id,
    itemId: row.item_id,
    title: row.title,
    label: row.label,
    cover: row.cover,
    lang: row.lang,
    status: row.status,
    progress: row.progress,
    size: row.size,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getDownload(id: number): DownloadJob | null {
  const row = db.query("SELECT * FROM downloads WHERE id = ?").get(id) as DownloadRow | null;
  return row ? toDownload(row) : null;
}

export function getDownloadByKey(kind: Kind, sourceId: string, itemId: string, lang: string | null): DownloadJob | null {
  const row = db
    .query("SELECT * FROM downloads WHERE kind = ? AND source_id = ? AND item_id = ? AND lang IS ?")
    .get(kind, sourceId, itemId, lang) as DownloadRow | null;
  return row ? toDownload(row) : null;
}

export function findDoneDownloadId(kind: Kind, itemId: string, lang?: string | null): number | null {
  const row =
    lang === undefined
      ? (db
          .query("SELECT id FROM downloads WHERE kind = ? AND item_id = ? AND status = 'done' ORDER BY id DESC LIMIT 1")
          .get(kind, itemId) as { id: number } | null)
      : (db
          .query("SELECT id FROM downloads WHERE kind = ? AND item_id = ? AND lang IS ? AND status = 'done' ORDER BY id DESC LIMIT 1")
          .get(kind, itemId, lang) as { id: number } | null);
  return row ? row.id : null;
}

export function toFavourite(row: {
  kind: Kind;
  source_id: string;
  title: string;
  cover: string | null;
  created_at: number;
}): Favourite {
  return { kind: row.kind, sourceId: row.source_id, title: row.title, cover: row.cover, createdAt: row.created_at };
}
