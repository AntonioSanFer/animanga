import { cached } from "../cache";
import { UA } from "../config";
import { absoluteUrl, assertPublicHttpsUrl, assertResolvesPublic, decodeEntities, isMangaPillId, stripTags } from "../util";
import type { Chapter, ChapterPage, MangaSummary } from "../../shared/types";
import type { MangaFilters } from "./registry";

// ponytail: overridable so a domain change doesn't kill the provider (Suwayomi getBaseUrl pattern).
export const MANGAPILL_BASE = (process.env.MANGAPILL_BASE_URL || "https://mangapill.com").replace(/\/$/, "");

const HEADERS = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

async function getText(path: string, ttl = 300): Promise<string> {
  return cached<string>(`mp:${MANGAPILL_BASE}${path}`, ttl, async () => {
    const res = await fetch(`${MANGAPILL_BASE}${path}`, { headers: HEADERS, signal: AbortSignal.timeout(25_000) });
    if (!res.ok) throw new Error(`MangaPill request failed (${res.status})`);
    const text = await res.text();
    if (/<title>\s*Just a moment/i.test(text)) throw new Error("Manga source is blocking this server (Cloudflare)");
    return text;
  });
}

function rawMangaId(id: string): string {
  const m = id.match(/^mp-(\d{1,10})$/);
  if (!m || !isMangaPillId(id)) throw new Error("Invalid manga id");
  return m[1];
}

function rawChapterIds(id: string): { manga: string; chapter: string } {
  const m = id.match(/^mp-(\d{1,10})-(\d{1,12})$/);
  if (!m || !isMangaPillId(id)) throw new Error("Invalid manga id");
  return { manga: m[1], chapter: m[2] };
}

// ponytail: allowlists only — unknown values ignored, never forwarded.
const STATUS_TO_MP: Record<string, string> = { ongoing: "publishing", completed: "finished", hiatus: "on hiatus", cancelled: "discontinued" };
const STATUS_FROM_MP: Record<string, string> = { publishing: "ongoing", finished: "completed", "on hiatus": "hiatus", discontinued: "cancelled" };
const DEMOGRAPHIC_TO_GENRE: Record<string, string> = { shounen: "Shounen", shoujo: "Shoujo", josei: "Josei", seinen: "Seinen" };

const PAGE_SIZE = 50;

function searchQuery(query: string, page: number, filters: MangaFilters): string {
  const qs = new URLSearchParams();
  if (query.trim()) qs.set("q", query.trim());
  const status = STATUS_TO_MP[filters.status ?? ""];
  if (status) qs.set("status", status);
  const genre = DEMOGRAPHIC_TO_GENRE[filters.demographic ?? ""];
  if (genre) qs.set("genre", genre);
  // ponytail: site has no sort/language params — sort ignored, lang ignored (EN-only).
  if ([...qs].length === 0) qs.set("status", "publishing");
  qs.set("page", String(Math.max(1, page)));
  return `/search?${qs}`;
}

function parseCards(html: string): MangaSummary[] {
  const out: MangaSummary[] = [];
  const seen = new Set<string>();
  // ponytail: one image anchor (class="relative block") per card; two links per card so split on links.
  const cards = html.matchAll(/<a href="\/manga\/(\d{1,10})\/[^"]*" class="relative block">([\s\S]*?)(?=<a href="\/manga\/\d+\/[^"]*" class="relative block">|$)/g);
  for (const card of cards) {
    const raw = card[1];
    if (seen.has(raw)) continue;
    seen.add(raw);
    const scope = card[2];
    const title = scope.match(/line-clamp-2">([^<]+)</)?.[1] || raw;
    const cover = scope.match(/data-src="([^"]+)"/)?.[1] || scope.match(/src="(https:[^"]+)"/)?.[1] || null;
    const year = Number(scope.match(/bg-orange-500[^>]*>(\d{4})</)?.[1]) || null;
    const statusRaw = scope.match(/bg-green-500[^>]*>([^<]+)</)?.[1]?.trim().toLowerCase() || null;
    const tags = [...scope.matchAll(/bg-card rounded px-1\.5">([^<]+)</g)].map((m) => decodeEntities(m[1].trim())).filter(Boolean).slice(0, 12);
    out.push({
      id: `mp-${raw}`,
      title: decodeEntities(title.trim()),
      cover: cover ? `/api/img/manga/mp-${raw}/cover` : null,
      description: "",
      year: Number.isFinite(year) ? year : null,
      status: statusRaw && STATUS_FROM_MP[statusRaw] ? STATUS_FROM_MP[statusRaw] : null,
      tags,
    });
  }
  return out;
}

async function searchData(query: string, page: number, filters: MangaFilters): Promise<{ items: MangaSummary[]; total: number }> {
  const path = searchQuery(query, page, filters);
  const html = await getText(path, 120);
  const items = parseCards(html);
  const offset = Math.max(0, (page - 1) * PAGE_SIZE);
  // ponytail: no total in markup — next-page link means more pages; +1 keeps infinite scroll going.
  const total = offset + items.length + (html.includes("page=") && items.length >= PAGE_SIZE ? 1 : 0);
  return { items, total };
}

export async function searchManga(query: string, _lang: string, page = 1, filters: MangaFilters = {}): Promise<{ items: MangaSummary[]; total: number }> {
  // ponytail: site is English-only (no language filter in search form) — lang ignored.
  return searchData(query, page, filters);
}

export async function popularManga(_lang: string, page = 1, filters: MangaFilters = {}): Promise<{ items: MangaSummary[]; total: number }> {
  return searchData("", page, filters);
}

function metaName(html: string, name: string): string | null {
  return html.match(new RegExp(`<meta name="${name}" content="([^"]*)"`))?.[1] || null;
}

export async function getManga(id: string): Promise<MangaSummary & { authors: string[] }> {
  const raw = rawMangaId(id);
  const html = await getText(`/manga/${raw}`, 900);
  const title = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] || raw;
  const desc = metaName(html, "description") || "";
  const statusRaw = html.match(/<label class="text-secondary">Status<\/label>\s*<div>([^<]+)<\/div>/)?.[1]?.trim().toLowerCase() || null;
  const year = Number(html.match(/<label class="text-secondary">Year<\/label>\s*<div>(\d{4})<\/div>/)?.[1]) || null;
  return {
    id,
    title: decodeEntities(stripTags(title)),
    cover: `/api/img/manga/${id}/cover`,
    // ponytail: meta descriptions are double-escaped (&amp;#34;) — decode twice.
    description: stripTags(decodeEntities(desc)),
    year: Number.isFinite(year) ? year : null,
    status: statusRaw && STATUS_FROM_MP[statusRaw] ? STATUS_FROM_MP[statusRaw] : null,
    tags: [...html.matchAll(/href="\/search\?genre=([^"]+)"/g)].map((m) => decodeEntities(decodeURIComponent(m[1]))).filter(Boolean).slice(0, 12),
    // ponytail: series pages expose no author/artist field.
    authors: [],
  };
}

export async function getChapters(mangaId: string, _lang: string): Promise<Chapter[]> {
  const raw = rawMangaId(mangaId);
  const html = await getText(`/manga/${raw}`, 300);
  const out: Chapter[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/href="\/chapters\/(\d{1,10})-(\d{1,12})\/[^"]*"[^>]*>([^<]*)</g)) {
    const key = `${m[1]}-${m[2]}`;
    if (m[1] !== raw || seen.has(key)) continue;
    seen.add(key);
    const number = m[3].match(/Chapter\s+([\d.]+)/i)?.[1] || null;
    out.push({
      id: `mp-${key}`,
      volume: null,
      chapter: number,
      title: null,
      lang: "en",
      // ponytail: page count unknown until the chapter page is fetched — client tolerates 0.
      pages: 0,
      group: null,
      publishedAt: null,
    });
  }
  out.sort((a, b) => (parseFloat(a.chapter || "") || 0) - (parseFloat(b.chapter || "") || 0));
  return out;
}

async function chapterImageUrls(chapterId: string): Promise<string[]> {
  const { manga, chapter } = rawChapterIds(chapterId);
  const html = await getText(`/chapters/${manga}-${chapter}`, 480);
  const urls = [...html.matchAll(/<img[^>]+class="js-page"[^>]+data-src="([^"]+)"/g)]
    .map((m) => decodeEntities(m[1]))
    .filter((u) => u.startsWith("https://"));
  if (urls.length === 0) throw new Error("Chapter has no pages");
  // ponytail: one DNS check per host (usually a single scan CDN).
  const checked = new Set<string>();
  for (const raw of urls) {
    const url = assertPublicHttpsUrl(raw);
    if (!checked.has(url.host)) {
      checked.add(url.host);
      await assertResolvesPublic(url);
    }
  }
  return urls;
}

function chapterHead(html: string, mangaRaw: string): { number: string | null; mangaTitle: string | null; mangaRaw: string | null } {
  const title = html.match(/<title>(.*?)<\/title>/)?.[1] || "";
  const main = title.replace(/\s*-\s*Mangapill\s*$/, "");
  const number = main.match(/Chapter\s+([\d.]+)/i)?.[1] || null;
  const mangaTitle = number ? main.slice(0, main.indexOf("Chapter")).trim() || null : main || null;
  const series = html.match(/href="\/manga\/(\d{1,10})"/)?.[1] || mangaRaw;
  return { number, mangaTitle: mangaTitle ? decodeEntities(mangaTitle) : null, mangaRaw: series ? `mp-${series}` : null };
}

export async function getChapter(chapterId: string, quality: "data" | "data-saver" = "data-saver"): Promise<ChapterPage> {
  const { manga } = rawChapterIds(chapterId);
  const [head, urls] = await Promise.all([getText(`/chapters/${manga}-${rawChapterIds(chapterId).chapter}`, 900), chapterImageUrls(chapterId)]);
  const meta = chapterHead(head, manga);
  return {
    id: chapterId,
    volume: null,
    chapter: meta.number,
    title: null,
    lang: "en",
    mangaId: meta.mangaRaw,
    mangaTitle: meta.mangaTitle,
    pages: urls.map((_, i) => `/api/img/page/${chapterId}/${i}?q=${quality === "data" ? "hq" : "saver"}`),
  };
}

export async function getChapterImage(chapterId: string, index: number, _quality: "data" | "data-saver"): Promise<{ url: string; fileName: string }> {
  const urls = await chapterImageUrls(chapterId);
  if (index < 0 || index >= urls.length) throw new Error("Page out of range");
  const url = urls[index];
  const fileName = url.split("?")[0].split("/").pop() || `${index + 1}.jpeg`;
  return { url, fileName };
}

export async function getChapterImages(chapterId: string): Promise<{ url: string; fileName: string }[]> {
  const urls = await chapterImageUrls(chapterId);
  return urls.map((url, i) => ({ url, fileName: url.split("?")[0].split("/").pop() || `${i + 1}.jpeg` }));
}

export async function coverUrl(id: string): Promise<string> {
  const html = await getText(`/manga/${rawMangaId(id)}`, 900);
  const src = html.match(/<meta property="og:image" content="([^"]*)"/)?.[1];
  if (!src) throw new Error("Cover not found");
  const url = assertPublicHttpsUrl(absoluteUrl(src, MANGAPILL_BASE));
  await assertResolvesPublic(url);
  return url.toString();
}

export async function chapterDownloadName(chapterId: string): Promise<string> {
  const { manga, chapter } = rawChapterIds(chapterId);
  const html = await getText(`/chapters/${manga}-${chapter}`, 900);
  const meta = chapterHead(html, manga);
  const label = `Ch.${meta.number || "?"}`;
  const title = `${meta.mangaTitle || "manga"} - ${label}`;
  return `${title.replace(/[<>:\"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || chapterId}.cbz`;
}

export const MANGAPILL_CREDIT = "Manga data provided by MangaPill.";
