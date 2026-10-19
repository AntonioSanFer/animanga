import { cached } from "../cache";
import { UA } from "../config";
import { decodeEntities, isUuid, stripTags } from "../util";
import type { Chapter, ChapterPage, MangaSummary } from "../../shared/types";

const API = "https://api.mangadex.org";
const UPLOADS = "https://uploads.mangadex.org";

const HEADERS = {
  "User-Agent": "AniManga/1.0 (self-hosted; https://github.com/)",
  Accept: "application/json",
};

type Params = [string, string][];

async function mdGet<T>(path: string, params: Params = [], ttl = 300): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of params) qs.append(k, v);
  const url = `${API}${path}${qs.size ? `?${qs}` : ""}`;
  return cached<T>(`md:${url}`, ttl, async () => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20_000) });
      if (res.ok) return (await res.json()) as T;
      // ponytail: single retry for MangaDex CDN flakes (seen 404/5xx on valid ids)
      if (attempt === 0 && (res.status === 404 || res.status >= 500)) {
        await Bun.sleep(1000);
        continue;
      }
      throw new Error(`MangaDex request failed (${res.status})`);
    }
  });
}

function titleOf(attrs: any): string {
  const t = attrs?.title || {};
  return t.en || t["ja-ro"] || t.ja || Object.values(t)[0] || "Untitled";
}

function descriptionOf(attrs: any): string {
  const d = attrs?.description || {};
  return stripTags(d.en || d["es-la"] || d.es || d.fr || Object.values(d)[0] || "");
}

export function mangaSummary(m: any): MangaSummary {
  const coverFile = m.relationships?.find((r: any) => r.type === "cover_art")?.attributes?.fileName as string | undefined;
  return {
    id: m.id,
    title: titleOf(m.attributes),
    cover: coverFile ? `/api/img/manga/${m.id}/${encodeURIComponent(coverFile)}?size=256` : null,
    description: descriptionOf(m.attributes),
    year: m.attributes?.year ?? null,
    status: m.attributes?.status ?? null,
    tags: (m.attributes?.tags || []).map((t: any) => t.attributes?.name?.en).filter(Boolean).slice(0, 12),
  };
}

export async function searchManga(query: string, lang: string, page = 1): Promise<{ items: MangaSummary[]; total: number }> {
  const limit = 30;
  const offset = Math.max(0, (page - 1) * limit);
  const params: Params = [
    ["limit", String(limit)],
    ["offset", String(offset)],
    ["includes[]", "cover_art"],
    ["contentRating[]", "safe"],
    ["contentRating[]", "suggestive"],
    ["hasAvailableChapters", "true"],
    ["availableTranslatedLanguage[]", lang],
    ["order[relevance]", "desc"],
  ];
  if (query.trim()) params.push(["title", query.trim()]);
  const data = await mdGet<any>("/manga", params, 120);
  return { items: (data.data || []).map(mangaSummary), total: data.total || 0 };
}

export async function popularManga(lang: string): Promise<MangaSummary[]> {
  const data = await mdGet<any>(
    "/manga",
    [
      ["limit", "30"],
      ["includes[]", "cover_art"],
      ["contentRating[]", "safe"],
      ["contentRating[]", "suggestive"],
      ["hasAvailableChapters", "true"],
      ["availableTranslatedLanguage[]", lang],
      ["order[followedCount]", "desc"],
    ],
    600,
  );
  return (data.data || []).map(mangaSummary);
}

export async function getManga(id: string): Promise<MangaSummary & { authors: string[] }> {
  if (!isUuid(id)) throw new Error("Invalid manga id");
  const data = await mdGet<any>(`/manga/${id}`, [["includes[]", "cover_art"], ["includes[]", "author"], ["includes[]", "artist"]], 900);
  const summary = mangaSummary(data.data);
  const authors = (data.data.relationships || [])
    .filter((r: any) => r.type === "author" || r.type === "artist")
    .map((r: any) => r.attributes?.name)
    .filter(Boolean);
  return { ...summary, authors: [...new Set(authors)] as string[] };
}

export async function getChapters(mangaId: string, lang: string): Promise<Chapter[]> {
  if (!isUuid(mangaId)) throw new Error("Invalid manga id");
  // ponytail: 60s outer TTL so a flaky empty feed isn't pinned for 5 minutes
  return cached(`md:chapters:${mangaId}:${lang}`, 60, async () => {
    const out: Chapter[] = [];
    let offset = 0;
    for (let i = 0; i < 10; i++) {
      const data = await mdGet<any>(
        `/manga/${mangaId}/feed`,
        [
          ["translatedLanguage[]", lang],
          ["order[volume]", "asc"],
          ["order[chapter]", "asc"],
          ["limit", "500"],
          ["offset", String(offset)],
          ["includeExternalUrl", "0"],
          ["includes[]", "scanlation_group"],
        ],
        300,
      );
      const rows = data.data || [];
      for (const c of rows) {
        if (!c.attributes?.pages) continue;
        out.push({
          id: c.id,
          volume: c.attributes.volume || null,
          chapter: c.attributes.chapter || null,
          title: c.attributes.title ? decodeEntities(c.attributes.title) : null,
          lang: c.attributes.translatedLanguage,
          pages: c.attributes.pages,
          group: c.relationships?.find((r: any) => r.type === "scanlation_group")?.attributes?.name || null,
          publishedAt: c.attributes.publishAt || null,
        });
      }
      offset += rows.length;
      if (offset >= (data.total || 0) || rows.length === 0) break;
    }
    return out;
  });
}

type AtHome = {
  baseUrl: string;
  chapter: { hash: string; data: string[]; dataSaver: string[] };
};

export async function getAtHome(chapterId: string): Promise<AtHome> {
  if (!isUuid(chapterId)) throw new Error("Invalid chapter id");
  return mdGet<AtHome>(`/at-home/server/${chapterId}`, [], 480);
}

export async function getChapterMeta(chapterId: string): Promise<any> {
  if (!isUuid(chapterId)) throw new Error("Invalid chapter id");
  return mdGet<any>(`/chapter/${chapterId}`, [["includes[]", "scanlation_group"], ["includes[]", "manga"]], 3600);
}

function pageUrls(at: AtHome, quality: "data" | "data-saver"): string[] {
  const files = quality === "data" ? at.chapter.data : at.chapter.dataSaver;
  return files.map((f) => `${at.baseUrl}/${quality}/${at.chapter.hash}/${f}`);
}

export async function getChapter(chapterId: string, quality: "data" | "data-saver" = "data-saver"): Promise<ChapterPage> {
  const [at, meta] = await Promise.all([getAtHome(chapterId), getChapterMeta(chapterId)]);
  const mangaRel = meta.data?.relationships?.find((r: any) => r.type === "manga");
  const urls = pageUrls(at, quality);
  return {
    id: chapterId,
    volume: meta.data?.attributes?.volume || null,
    chapter: meta.data?.attributes?.chapter || null,
    title: meta.data?.attributes?.title || null,
    lang: meta.data?.attributes?.translatedLanguage || "",
    mangaId: mangaRel?.id || null,
    mangaTitle: mangaRel?.attributes?.title?.en || null,
    pages: urls.map((_, i) => `/api/img/page/${chapterId}/${i}?q=${quality === "data" ? "hq" : "saver"}`),
  };
}

export async function getChapterImage(
  chapterId: string,
  index: number,
  quality: "data" | "data-saver",
): Promise<{ url: string; fileName: string }> {
  const at = await getAtHome(chapterId);
  const urls = pageUrls(at, quality);
  if (index < 0 || index >= urls.length) throw new Error("Page out of range");
  const url = urls[index];
  return { url, fileName: url.split("/").pop() || `${index + 1}.jpg` };
}

export async function getChapterImages(chapterId: string): Promise<{ url: string; fileName: string }[]> {
  const at = await getAtHome(chapterId);
  const files = at.chapter.data;
  return files.map((f) => ({ url: `${at.baseUrl}/data/${at.chapter.hash}/${f}`, fileName: f }));
}

export function coverUrl(mangaId: string, fileName: string, size: "256" | "512"): string {
  if (!isUuid(mangaId) || !/^[a-zA-Z0-9._-]+$/.test(fileName)) throw new Error("Invalid cover");
  return `${UPLOADS}/covers/${mangaId}/${fileName}.${size}.jpg`;
}

export const MANGA_CREDIT = "Manga data provided by MangaDex.";
