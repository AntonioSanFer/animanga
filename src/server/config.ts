import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

export const PORT = Number(process.env.PORT || 3000);
export const DATA_DIR = process.env.DATA_DIR || "./data";
export const DB_PATH = join(DATA_DIR, "app.db");
export const DOWNLOAD_DIR = join(DATA_DIR, "downloads");
export const DIST_DIR = join(process.cwd(), "dist");

export const BASE_URL = (process.env.BETTER_AUTH_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
export const TRUSTED_ORIGINS = [
  BASE_URL,
  ...(process.env.TRUSTED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
].filter((v, i, a) => a.indexOf(v) === i);

export const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
export const YTDLP = process.env.YTDLP_PATH || "yt-dlp";
export const MAX_CONCURRENT_DOWNLOADS = Number(process.env.MAX_CONCURRENT_DOWNLOADS || 2);
export const MAX_ACTIVE_JOBS = Number(process.env.MAX_ACTIVE_JOBS || 25);

export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(DOWNLOAD_DIR, { recursive: true });

export function loadSecret(): string {
  if (process.env.BETTER_AUTH_SECRET && process.env.BETTER_AUTH_SECRET.length >= 16) {
    return process.env.BETTER_AUTH_SECRET;
  }
  const file = join(DATA_DIR, "secret");
  try {
    const existing = readFileSync(file, "utf8").trim();
    if (existing.length >= 32) return existing;
  } catch {}
  const secret = randomBytes(32).toString("hex");
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export function isTrustedOrigin(origin: string): boolean {
  if (TRUSTED_ORIGINS.includes(origin)) return true;
  try {
    return new URL(origin).origin === new URL(BASE_URL).origin;
  } catch {
    return false;
  }
}

export const MANGA_LANGS = [
  "en", "es", "es-la", "fr", "de", "pt-br", "it", "ru", "pl", "tr", "ar", "hi", "id", "th", "vi", "ja", "ko", "zh", "zh-hk",
];

export function mangaLang(v: string | undefined | null, fallback = "en"): string {
  return v && MANGA_LANGS.includes(v) ? v : fallback;
}
