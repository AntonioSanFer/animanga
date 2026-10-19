import { cached } from "../cache";
import { UA } from "../config";
import { absoluteUrl, assertPublicHttpsUrl, assertResolvesPublic, decodeEntities, isMangaFireId, stripTags } from "../util";
import type { Chapter, ChapterPage, MangaSummary } from "../../shared/types";
import type { MangaFilters } from "./registry";

// ponytail: overridable so a domain change doesn't kill the provider (Suwayomi getBaseUrl pattern).
export const MANGAFIRE_BASE = (process.env.MANGAFIRE_BASE_URL || "https://mangafire.to").replace(/\/$/, "");

// ponytail: port of Keiyoushi MangaFire VrfSigner.kt (pure table-XOR crypto, no browser needed).
// Every /api/ call requires ?vrf= over the sorted query string; without it the API answers 403.
const VRF_TABLE_1 = "yINlmUNho8VYJT+ibTIP+9ESiULpVEtMOoD6U6lRE0R/xwXo/Xp9NrUgC4cw/Lmo33vUyjUE40kUoEWIr/fxfNNcq2s79ShQ5NhNrFnJ4hXPwOu/SuXzIbuTQKGFvfm08E9jvCfqAtoDqvQq3dVWPQFmJjgvkISBeXY3BgANR+yVnjGbcxZ47d6kLNfZPIayTq3/YGySb1KuVZodWp/WGNAO5pfMcpaK53Hhs0allBszaMaxuouOwdxbwgxIw6YunSsXjI05Yi0j9j4eHKfSXR8Ifo/Od+8iamRfCXTyvm7NGRGYdcQ0ywcK/u6RXhrbcCm4t2eCtrDgQVecJGkQ+A==";
const VRF_KEY_1 = "0Ec58JOY3uBzJK9m3zqIOpdlF7UFiax9DmA=";
const VRF_TABLE_2 = "IUFltCxD3Oc2cwCgkJffthaOg9cgPUb0LgW6H/VtfcF0kc5F25t+aWj6JH9VOhOaY0rAFdUxlDnl5BLNvwEJvQtP5qcw7vdb/K+chnbwnspSHT8mz5lqwz41TezG0hkO06FTjJZhsyNuFLDpD2ZZxQj/QIRcF90zpmQ7Byu483WsQqUE0C342HL+JXngRB6fRzxRyVTaKu83h7UYTJ0QMt6ixFh6S3F8gqkKwrGTL3jHNBsD45UnifK8+RGtishQV2K3rujLKEkiZxpr2dYcudFW4oFsDKhad3CLBvuyTqsCo4B7mL5IKQ1vXo/MOOvq1I1d8ar9X6Ttu5KF4fZgiA==";
const VRF_KEY_2 = "AAdjb1iPY8CiDmq9H34tKTBF8a3oDQ==";
const VRF_TABLE_3 = "NQHlu1/wVO5EmkwQymF810qqY2xG1k2obcas4Z9mCsPEIFl9pRIjFxbJ7ybMHbBckT5Ton85E0FOeHezbh/mjlEYpmpnlXOS8dgrqeq2KfxImTh1YK9y0PeMNhzA1OQzSY9brYOJq/l2QnE/hwOeZIhPixVSKIUlDb5vLcH6RWKxkIEMuP0bDwIqQ71AJJaEaMJL7A6YtyIwoRT+L5v4aZzodN/0+3nOGsfblFjgxSfPzVDjNFeNl5P26+kEC/8AHgdrpAbt3hHz3HrRN1Y6e+JHgF7ncFWnoF0y3THL1S71WgWGCa6KtSzTCCG58n68nTyj2T3Sshk7utqCtMi/ZQ==";
const VRF_KEY_3 = "DELOJgPsVaCcblDtTGMdHzM=";
const VRF_STAGES: [Buffer, Buffer, number][] = [
  [Buffer.from(VRF_TABLE_1, "base64"), Buffer.from(VRF_KEY_1, "base64"), 0x5a],
  [Buffer.from(VRF_TABLE_2, "base64"), Buffer.from(VRF_KEY_2, "base64"), 0x35],
  [Buffer.from(VRF_TABLE_3, "base64"), Buffer.from(VRF_KEY_3, "base64"), 0xba],
];

export function signVrf(canonicalPath: string): string {
  let data = Buffer.from(canonicalPath, "utf8");
  for (const [table, key, iv] of VRF_STAGES) {
    const out = Buffer.alloc(data.length);
    let prev = iv;
    for (let i = 0; i < data.length; i++) {
      prev = table[(data[i] ^ key[i % key.length] ^ prev) & 0xff];
      out[i] = prev;
    }
    data = out;
  }
  return data.toString("base64url");
}

type Param = [string, string];

function signedQuery(path: string, params: Param[]): string {
  // ponytail: stable sort by key like Kotlin sortedBy; [] keys indexed ([0],[1]…) in the signed string.
  const order = params.map((_, i) => i).sort((a, b) => (params[a][0] < params[b][0] ? -1 : params[a][0] > params[b][0] ? 1 : a - b));
  let lastKey = "";
  let index = 0;
  const canonical = order
    .map((i) => {
      const [k, v] = params[i];
      let nk = k;
      if (k.endsWith("[]")) {
        if (lastKey !== k) index = 0;
        lastKey = k;
        nk = k.replace("[]", `[${index++}]`);
      }
      return `${nk}=${v}`;
    })
    .join("&");
  const apiPath = path.replace(/^\/api/, "");
  const vrf = signVrf(canonical ? `${apiPath}?${canonical}` : apiPath);
  const qs = new URLSearchParams();
  for (const [k, v] of params) qs.append(k, v);
  qs.append("vrf", vrf);
  return `${path}?${qs}`;
}

async function mfGet<T>(path: string, params: Param[], ttl = 300): Promise<T> {
  const query = signedQuery(path, params);
  return cached<T>(`mf:${MANGAFIRE_BASE}${query}`, ttl, async () => {
    const res = await fetch(`${MANGAFIRE_BASE}${query}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(25_000),
    });
    const text = await res.text();
    if (!res.ok) {
      if (text.includes("captcha_required")) throw new Error("Manga source is asking for CAPTCHA (try again later)");
      throw new Error(`MangaFire request failed (${res.status})`);
    }
    if (/^\s*</.test(text)) throw new Error("Manga source is blocking this server (Cloudflare)");
    return JSON.parse(text) as T;
  });
}

function rawHid(id: string): string {
  const m = id.match(/^mf-([A-Za-z0-9]{1,16})$/);
  if (!m || !isMangaFireId(id)) throw new Error("Invalid manga id");
  return m[1];
}

function rawChapterIds(id: string): { hid: string; chapter: string } {
  const m = id.match(/^mf-([A-Za-z0-9]{1,16})-(\d{1,12})$/);
  if (!m || !isMangaFireId(id)) throw new Error("Invalid manga id");
  return { hid: m[1], chapter: m[2] };
}

// ponytail: allowlists only — unknown values ignored, never forwarded.
const STATUS_TO_MF: Record<string, string> = { ongoing: "releasing", completed: "finished", hiatus: "on_hiatus", cancelled: "discontinued" };
const STATUS_FROM_MF: Record<string, string> = { releasing: "ongoing", finished: "completed", on_hiatus: "hiatus", discontinued: "cancelled" };
const SORT_TO_MF: Record<string, string> = {
  relevance: "relevance:desc",
  followedCount: "follows_total:desc",
  latestUploadedChapter: "chapter_updated_at:desc",
  rating: "score:desc",
};
// ponytail: site has no demographic field — closest equivalent is these genre ids (verified in extension Filters.kt).
const DEMOGRAPHIC_TO_GENRE: Record<string, string> = { shounen: "31", shoujo: "30", josei: "15", seinen: "537" };
// ponytail: genre ids from the Keiyoushi extension Filters.kt (tri-state genres_in[]/genres_ex[], verified live).
export const MANGAFIRE_GENRES: { id: string; label: string }[] = [
  { id: "1", label: "Action" }, { id: "268929", label: "Adult" }, { id: "78", label: "Adventure" },
  { id: "3", label: "Avant Garde" }, { id: "4", label: "Boys Love" }, { id: "5", label: "Comedy" },
  { id: "268921", label: "Crime" }, { id: "77", label: "Demons" }, { id: "6", label: "Drama" },
  { id: "7", label: "Ecchi" }, { id: "79", label: "Fantasy" }, { id: "9", label: "Girls Love" },
  { id: "10", label: "Gourmet" }, { id: "11", label: "Harem" }, { id: "268930", label: "Hentai" },
  { id: "268922", label: "Historical" }, { id: "530", label: "Horror" }, { id: "13", label: "Isekai" },
  { id: "531", label: "Iyashikei" }, { id: "15", label: "Josei" }, { id: "532", label: "Kids" },
  { id: "539", label: "Magic" }, { id: "268923", label: "Magical Girls" }, { id: "533", label: "Mahou Shoujo" },
  { id: "534", label: "Martial Arts" }, { id: "268931", label: "Mature" }, { id: "19", label: "Mecha" },
  { id: "268924", label: "Medical" }, { id: "535", label: "Military" }, { id: "21", label: "Music" },
  { id: "22", label: "Mystery" }, { id: "23", label: "Parody" }, { id: "268925", label: "Philosophical" },
  { id: "536", label: "Psychological" }, { id: "25", label: "Reverse Harem" }, { id: "26", label: "Romance" },
  { id: "73", label: "School" }, { id: "28", label: "Sci-Fi" }, { id: "537", label: "Seinen" },
  { id: "30", label: "Shoujo" }, { id: "31", label: "Shounen" }, { id: "538", label: "Slice of Life" },
  { id: "268932", label: "Smut" }, { id: "33", label: "Space" }, { id: "34", label: "Sports" },
  { id: "75", label: "Super Power" }, { id: "268926", label: "Superhero" }, { id: "76", label: "Supernatural" },
  { id: "37", label: "Suspense" }, { id: "38", label: "Thriller" }, { id: "268927", label: "Tragedy" },
  { id: "39", label: "Vampire" }, { id: "268928", label: "Wuxia" },
];

export async function mangaTags(): Promise<{ id: string; label: string }[]> {
  return MANGAFIRE_GENRES;
}

const GENRE_IDS = new Set(MANGAFIRE_GENRES.map((g) => g.id));

const LANGS = ["en", "es", "es-la", "fr", "ja", "pt", "pt-br"];

function mfLang(lang: string): string {
  const norm = lang === "es-419" ? "es-la" : lang.toLowerCase();
  return LANGS.includes(norm) ? norm : "en";
}

const PAGE_SIZE = 50;

function orderParam(sort: string | undefined, fallback: string): Param {
  const [field, dir] = (SORT_TO_MF[sort ?? ""] ?? fallback).split(":");
  return [`order[${field}]`, dir];
}

function listQuery(query: string, page: number, filters: MangaFilters, fallbackSort: string): Param[] {
  const params: Param[] = [];
  if (query.trim()) params.push(["keyword", query.trim()]);
  params.push(["page", String(Math.max(1, page))], ["limit", String(PAGE_SIZE)]);
  params.push(orderParam(filters.sort, fallbackSort));
  const status = STATUS_TO_MF[filters.status ?? ""];
  if (status) params.push(["statuses[]", status]);
  const genre = DEMOGRAPHIC_TO_GENRE[filters.demographic ?? ""];
  if (genre) params.push(["genres_in[]", genre]);
  // ponytail: explicit tags stack with the demographic shortcut (both feed genres_in[], API ANDs them).
  for (const tag of new Set((filters.tags || []).map((t) => t.trim()))) {
    if (GENRE_IDS.has(tag)) params.push(["genres_in[]", tag]);
  }
  // ponytail: site needs no language param on title lists — lang only scopes chapters.
  return params;
}

type TitleItem = {
  hid: string;
  slug?: string | null;
  title: string;
  type?: string | null;
  status?: string | null;
  year?: number | null;
  poster?: { small?: string | null; medium?: string | null; large?: string | null } | null;
};

function toSummary(item: TitleItem): MangaSummary {
  const statusRaw = item.status?.toLowerCase() || null;
  return {
    id: `mf-${item.hid}`,
    title: decodeEntities(item.title),
    cover: `/api/img/manga/mf-${item.hid}/cover`,
    description: "",
    year: Number.isFinite(item.year) ? (item.year as number) : null,
    status: statusRaw && STATUS_FROM_MF[statusRaw] ? STATUS_FROM_MF[statusRaw] : null,
    tags: item.type ? [item.type.replace(/^\w/, (c) => c.toUpperCase())] : [],
  };
}

async function listData(query: string, page: number, filters: MangaFilters, fallbackSort: string): Promise<{ items: MangaSummary[]; total: number }> {
  const data = await mfGet<{ items: TitleItem[]; meta?: { hasNext?: boolean } | null }>(
    "/api/titles",
    listQuery(query, page, filters, fallbackSort),
    120,
  );
  const items = (data.items || []).map(toSummary);
  const offset = Math.max(0, (page - 1) * PAGE_SIZE);
  // ponytail: meta.hasNext is the only pagination signal — +1 keeps infinite scroll going.
  const total = offset + items.length + (data.meta?.hasNext ? 1 : 0);
  return { items, total };
}

export async function searchManga(query: string, _lang: string, page = 1, filters: MangaFilters = {}): Promise<{ items: MangaSummary[]; total: number }> {
  return listData(query, page, filters, "relevance:desc");
}

export async function popularManga(_lang: string, page = 1, filters: MangaFilters = {}): Promise<{ items: MangaSummary[]; total: number }> {
  return listData("", page, filters, "views_30d:desc");
}

type TitleDetails = TitleItem & {
  synopsisHtml?: string | null;
  authors?: { title: string }[] | null;
  artists?: { title: string }[] | null;
  genres?: { title: string }[] | null;
  themes?: { title: string }[] | null;
};

export async function getManga(id: string): Promise<MangaSummary & { authors: string[] }> {
  const hid = rawHid(id);
  const data = await mfGet<{ data: TitleDetails }>(`/api/titles/${hid}`, [], 900);
  const d = data.data;
  const statusRaw = d.status?.toLowerCase() || null;
  const tags = [
    ...(d.type ? [d.type.replace(/^\w/, (c) => c.toUpperCase())] : []),
    ...(d.genres || []).map((g) => g.title),
    ...(d.themes || []).map((t) => t.title),
  ].filter(Boolean).slice(0, 12);
  return {
    id,
    title: decodeEntities(d.title),
    cover: `/api/img/manga/${id}/cover`,
    description: stripTags(d.synopsisHtml || ""),
    year: Number.isFinite(d.year) ? (d.year as number) : null,
    status: statusRaw && STATUS_FROM_MF[statusRaw] ? STATUS_FROM_MF[statusRaw] : null,
    tags,
    authors: [...new Set([...(d.authors || []), ...(d.artists || [])].map((a) => decodeEntities(a.title)).filter(Boolean))],
  };
}

type ChapterItem = { id: number; number: number; name?: string | null; createdAt?: number | null; type?: string | null };

export async function getChapters(mangaId: string, lang: string): Promise<Chapter[]> {
  const hid = rawHid(mangaId);
  const language = mfLang(lang);
  const first = await mfGet<{ items: ChapterItem[]; meta?: { lastPage?: number } | null }>(
    `/api/titles/${hid}/chapters`,
    [["language", language], ["sort", "number"], ["order", "desc"], ["page", "1"], ["limit", "200"]],
    300,
  );
  const items = [...(first.items || [])];
  const lastPage = first.meta?.lastPage || 1;
  // ponytail: page 1 tells us lastPage; fetch the rest uncached-parallel like the Kotlin extension.
  if (lastPage > 1) {
    const rest = await Promise.all(
      Array.from({ length: lastPage - 1 }, (_, i) =>
        mfGet<{ items: ChapterItem[] }>(`/api/titles/${hid}/chapters`, [
          ["language", language], ["sort", "number"], ["order", "desc"], ["page", String(i + 2)], ["limit", "200"],
        ], 300).then((d) => d.items || []),
      ),
    );
    for (const chunk of rest) items.push(...chunk);
  }
  const seen = new Set<number>();
  const out: Chapter[] = [];
  for (const c of items) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push({
      id: `mf-${hid}-${c.id}`,
      volume: null,
      chapter: String(c.number),
      title: c.name?.trim() ? decodeEntities(c.name.trim()) : null,
      lang: language,
      // ponytail: page count unknown until the pages endpoint is fetched — client tolerates 0.
      pages: 0,
      group: c.type || null,
      publishedAt: c.createdAt ? new Date(c.createdAt * 1000).toISOString() : null,
    });
  }
  out.sort((a, b) => (parseFloat(a.chapter || "") || 0) - (parseFloat(b.chapter || "") || 0));
  return out;
}

type PagesData = {
  data: {
    id: number;
    number: number;
    name?: string | null;
    title?: { hid: string; name: string } | null;
    pages: { url: string }[];
  };
};

async function chapterPageUrls(numericId: string): Promise<string[]> {
  const data = await mfGet<PagesData>(`/api/chapters/${numericId}`, [], 480);
  const urls = (data.data.pages || []).map((p) => p.url).filter((u) => u.startsWith("https://"));
  if (urls.length === 0) throw new Error("Chapter has no pages");
  // ponytail: one DNS check per host (usually a single mfcdn host).
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

export async function getChapter(chapterId: string, quality: "data" | "data-saver" = "data-saver"): Promise<ChapterPage> {
  const { hid, chapter } = rawChapterIds(chapterId);
  const [meta, urls] = await Promise.all([
    mfGet<PagesData>(`/api/chapters/${chapter}`, [], 900),
    chapterPageUrls(chapter),
  ]);
  const d = meta.data;
  return {
    id: chapterId,
    volume: null,
    chapter: String(d.number),
    title: d.name?.trim() ? decodeEntities(d.name.trim()) : null,
    lang: "en",
    mangaId: d.title?.hid ? `mf-${d.title.hid}` : `mf-${hid}`,
    mangaTitle: d.title?.name ? decodeEntities(d.title.name) : null,
    pages: urls.map((_, i) => `/api/img/page/${chapterId}/${i}?q=${quality === "data" ? "hq" : "saver"}`),
  };
}

export async function getChapterImage(chapterId: string, index: number, _quality: "data" | "data-saver"): Promise<{ url: string; fileName: string }> {
  const urls = await chapterPageUrls(rawChapterIds(chapterId).chapter);
  if (index < 0 || index >= urls.length) throw new Error("Page out of range");
  const url = urls[index];
  const fileName = url.split("?")[0].split("/").pop() || `${index + 1}.jpg`;
  return { url, fileName };
}

export async function getChapterImages(chapterId: string): Promise<{ url: string; fileName: string }[]> {
  const urls = await chapterPageUrls(rawChapterIds(chapterId).chapter);
  return urls.map((url, i) => ({ url, fileName: url.split("?")[0].split("/").pop() || `${i + 1}.jpg` }));
}

export async function coverUrl(id: string): Promise<string> {
  const hid = rawHid(id);
  const data = await mfGet<{ data: TitleDetails }>(`/api/titles/${hid}`, [], 900);
  const src = data.data.poster?.large || data.data.poster?.medium || data.data.poster?.small;
  if (!src) throw new Error("Cover not found");
  const url = assertPublicHttpsUrl(absoluteUrl(src, MANGAFIRE_BASE));
  await assertResolvesPublic(url);
  return url.toString();
}

export async function chapterDownloadName(chapterId: string): Promise<string> {
  const { chapter } = rawChapterIds(chapterId);
  const data = await mfGet<PagesData>(`/api/chapters/${chapter}`, [], 900);
  const d = data.data;
  const label = `Ch.${d.number ?? "?"}`;
  const title = `${d.title?.name || "manga"} - ${label}`;
  return `${title.replace(/[<>:\"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || chapterId}.cbz`;
}

export const MANGAFIRE_CREDIT = "Manga data provided by MangaFire.";
