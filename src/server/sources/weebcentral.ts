import { cached } from "../cache";
import { UA } from "../config";
import { absoluteUrl, assertPublicHttpsUrl, assertResolvesPublic, decodeEntities, isWeebCentralId, stripTags } from "../util";
import type { Chapter, ChapterPage, MangaSummary } from "../../shared/types";
import type { MangaFilters } from "./registry";

// ponytail: overridable so a domain change doesn't kill the provider (Suwayomi getBaseUrl pattern).
export const WEEBCENTRAL_BASE = (process.env.WEEBCENTRAL_BASE_URL || "https://weebcentral.com").replace(/\/$/, "");

const HEADERS = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

async function getText(path: string, ttl = 300): Promise<string> {
  return cached<string>(`wc:${WEEBCENTRAL_BASE}${path}`, ttl, async () => {
    const res = await fetch(`${WEEBCENTRAL_BASE}${path}`, { headers: HEADERS, signal: AbortSignal.timeout(25_000) });
    if (!res.ok) throw new Error(`WeebCentral request failed (${res.status})`);
    const text = await res.text();
    if (/<title>\s*Just a moment/i.test(text)) throw new Error("Manga source is blocking this server (Cloudflare)");
    return text;
  });
}

function rawId(id: string): string {
  if (!isWeebCentralId(id)) throw new Error("Invalid manga id");
  return id.slice(3);
}

// ponytail: allowlists only — unknown values ignored, never forwarded.
const STATUS_TO_WC: Record<string, string> = { ongoing: "Ongoing", completed: "Complete", hiatus: "Hiatus", cancelled: "Canceled" };
const STATUS_FROM_WC: Record<string, string> = { ongoing: "ongoing", complete: "completed", hiatus: "hiatus", canceled: "cancelled" };
const SORT_TO_WC: Record<string, string> = {
  relevance: "Best Match",
  followedCount: "Subscribers",
  latestUploadedChapter: "Latest Updates",
  rating: "Popularity",
};

function searchQuery(query: string, page: number, filters: MangaFilters, defaultSort: string): string {
  const limit = 30;
  const qs = new URLSearchParams({
    text: query.trim(),
    display_mode: "Full Display",
    sort: SORT_TO_WC[filters.sort ?? ""] ?? defaultSort,
    order: "Descending",
    official: "Any",
    limit: String(limit),
    offset: String(Math.max(0, (page - 1) * limit)),
  });
  const status = STATUS_TO_WC[filters.status ?? ""];
  if (status) qs.append("included_status", status);
  // ponytail: demographic has no site equivalent (type=Manga/Manhwa/Manhua is not demographic) — ignored.
  return `/search/data?${qs}`;
}

function cardMeta(card: string, label: string): string | null {
  return card.match(new RegExp(`<strong>${label}:</strong>\\s*<span>([^<]+)</span>`))?.[1]?.trim() || null;
}

function parseCards(html: string): MangaSummary[] {
  const out: MangaSummary[] = [];
  const seen = new Set<string>();
  for (const card of html.split('<article class="bg-base-300 flex gap-4 p-4">').slice(1)) {
    const series = card.match(/\/series\/([A-Za-z0-9]{26})\/[^"]*/);
    const raw = series?.[1];
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    const title = card.match(/line-clamp-1 link link-hover">([^<]+)</)?.[1] || raw;
    const statusRaw = cardMeta(card, "Status")?.toLowerCase() || null;
    const year = Number(cardMeta(card, "Year")) || null;
    const tagscope = card.split("Tag(s):")[1]?.split("</div>")[0] || "";
    const tags = [...tagscope.matchAll(/<span>([^<]+)<\/span>/g)]
      .map((m) => m[1].replace(/,$/, "").trim())
      .filter(Boolean)
      .slice(0, 12);
    out.push({
      id: `wc-${raw}`,
      title: decodeEntities(title.trim()),
      cover: `/api/img/manga/wc-${raw}/cover`,
      description: "",
      year: Number.isFinite(year) ? year : null,
      status: statusRaw && STATUS_FROM_WC[statusRaw] ? STATUS_FROM_WC[statusRaw] : null,
      tags,
    });
  }
  return out;
}

async function searchData(query: string, page: number, filters: MangaFilters, defaultSort: string): Promise<{ items: MangaSummary[]; total: number }> {
  const path = searchQuery(query, page, filters, defaultSort);
  const html = await getText(path, 120);
  const items = parseCards(html);
  const offset = Math.max(0, (page - 1) * 30);
  // ponytail: no total in markup — load-more link means more pages; +1 keeps infinite scroll going.
  const total = offset + items.length + (html.includes("/search/data?limit=") ? 1 : 0);
  return { items, total };
}

export async function searchManga(query: string, _lang: string, page = 1, filters: MangaFilters = {}): Promise<{ items: MangaSummary[]; total: number }> {
  // ponytail: site is English-only (no language filter in search form) — lang ignored.
  return searchData(query, page, filters, "Best Match");
}

export async function popularManga(_lang: string, page = 1, filters: MangaFilters = {}): Promise<{ items: MangaSummary[]; total: number }> {
  return searchData("", page, filters, "Popularity");
}

function og(html: string, prop: string): string | null {
  return html.match(new RegExp(`<meta property="og:${prop}" content="([^"]*)"`))?.[1] || null;
}

function listAfter(html: string, label: string): string[] {
  const escaped = label.replace(/:$/, "").replace(/[()]/g, "\\$&");
  const scope = html.split(new RegExp(`<strong>${escaped}:\\s*</strong>`))[1]?.split("</li>")[0] || "";
  return [...scope.matchAll(/>([^<>]+)<\/a>/g)].map((m) => decodeEntities(m[1].trim())).filter(Boolean);
}

export async function getManga(id: string): Promise<MangaSummary & { authors: string[] }> {
  const raw = rawId(id);
  const html = await getText(`/series/${raw}`, 900);
  const title = og(html, "title")?.replace(/\s*\|\s*Weeb Central\s*$/, "") || raw;
  const desc = html.match(/<strong>Description<\/strong>\s*<p[^>]*>([\s\S]*?)<\/p>/)?.[1] || "";
  const statusRaw = html.match(/<strong>Status:\s*<\/strong>\s*<a[^>]*>([^<]+)<\/a>/)?.[1]?.trim().toLowerCase() || null;
  const year = Number(html.match(/<strong>Released:\s*<\/strong>\s*<span>(\d{4})<\/span>/)?.[1]) || null;
  return {
    id,
    title: decodeEntities(title),
    cover: `/api/img/manga/${id}/cover`,
    description: stripTags(desc),
    year: Number.isFinite(year) ? year : null,
    status: statusRaw && STATUS_FROM_WC[statusRaw] ? STATUS_FROM_WC[statusRaw] : null,
    tags: listAfter(html, "Tags(s):").slice(0, 12),
    authors: [...new Set(listAfter(html, "Author(s):"))],
  };
}

export async function getChapters(mangaId: string, _lang: string): Promise<Chapter[]> {
  const raw = rawId(mangaId);
  const html = await getText(`/series/${raw}/full-chapter-list`, 300);
  const out: Chapter[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a href="\/chapters\/([A-Za-z0-9]{26})"[^>]*>([\s\S]*?)<\/a>/g)) {
    const chRaw = m[1];
    if (seen.has(chRaw)) continue;
    seen.add(chRaw);
    const label = stripTags(m[2].split("<time")[0]);
    const number = label.match(/Chapter\s+([\d.]+)/i)?.[1] || null;
    const publishedAt = m[2].match(/datetime="([^"]+)"/)?.[1] || null;
    out.push({
      id: `wc-${chRaw}`,
      volume: null,
      chapter: number,
      title: null,
      lang: "en",
      // ponytail: page count unknown until the images endpoint is fetched — client tolerates 0.
      pages: 0,
      group: null,
      publishedAt,
    });
  }
  out.sort((a, b) => (parseFloat(a.chapter || "") || 0) - (parseFloat(b.chapter || "") || 0));
  return out;
}

async function chapterImageUrls(chapterRaw: string): Promise<string[]> {
  const html = await getText(`/chapters/${chapterRaw}/images?is_prev=False`, 480);
  const urls = [...html.matchAll(/<img\s+src="(https:\/\/[^"]+)"/g)]
    .map((m) => decodeEntities(m[1]))
    .filter((u) => !u.includes("/static/"));
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

function chapterHead(html: string): { number: string | null; mangaTitle: string | null; mangaRaw: string | null } {
  const title = og(html, "title") || "";
  const parts = title.split("|").map((s) => s.trim());
  return {
    number: parts[0]?.match(/Chapter\s+([\d.]+)/i)?.[1] || null,
    mangaTitle: parts[1] || null,
    mangaRaw: html.match(/\/series\/([A-Za-z0-9]{26})\/chapter-select/)?.[1] || null,
  };
}

export async function getChapter(chapterId: string, quality: "data" | "data-saver" = "data-saver"): Promise<ChapterPage> {
  const raw = rawId(chapterId);
  const [head, urls] = await Promise.all([getText(`/chapters/${raw}`, 900), chapterImageUrls(raw)]);
  const meta = chapterHead(head);
  return {
    id: chapterId,
    volume: null,
    chapter: meta.number,
    title: null,
    lang: "en",
    mangaId: meta.mangaRaw ? `wc-${meta.mangaRaw}` : null,
    mangaTitle: meta.mangaTitle ? decodeEntities(meta.mangaTitle) : null,
    pages: urls.map((_, i) => `/api/img/page/${chapterId}/${i}?q=${quality === "data" ? "hq" : "saver"}`),
  };
}

export async function getChapterImage(chapterId: string, index: number, _quality: "data" | "data-saver"): Promise<{ url: string; fileName: string }> {
  const urls = await chapterImageUrls(rawId(chapterId));
  if (index < 0 || index >= urls.length) throw new Error("Page out of range");
  const url = urls[index];
  const fileName = url.split("?")[0].split("/").pop() || `${index + 1}.png`;
  return { url, fileName };
}

export async function getChapterImages(chapterId: string): Promise<{ url: string; fileName: string }[]> {
  const urls = await chapterImageUrls(rawId(chapterId));
  return urls.map((url, i) => ({ url, fileName: url.split("?")[0].split("/").pop() || `${i + 1}.png` }));
}

export async function coverUrl(id: string): Promise<string> {
  const html = await getText(`/series/${rawId(id)}`, 900);
  const src = og(html, "image");
  if (!src) throw new Error("Cover not found");
  const url = assertPublicHttpsUrl(absoluteUrl(src, WEEBCENTRAL_BASE));
  await assertResolvesPublic(url);
  return url.toString();
}

export async function chapterDownloadName(chapterId: string): Promise<string> {
  const html = await getText(`/chapters/${rawId(chapterId)}`, 900);
  const meta = chapterHead(html);
  const label = `Ch.${meta.number || "?"}`;
  const title = `${meta.mangaTitle || "manga"} - ${label}`;
  return `${title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || chapterId}.cbz`;
}

export const WEEBCENTRAL_CREDIT = "Manga data provided by WeebCentral.";
