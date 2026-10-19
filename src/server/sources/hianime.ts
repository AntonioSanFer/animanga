import { cached } from "../cache";
import { UA } from "../config";
import { absoluteUrl, assertPublicHttpsUrl, assertResolvesPublic, decodeEntities, stripTags } from "../util";
import type { AnimeSummary, Episode } from "../../shared/types";

const BASE = "https://hianime.at";
const EMBED_KEY = Buffer.from("otaku-embed-v1");

const HEADERS = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

async function getText(path: string, ttl = 300, cacheKey = `hi:${path}`): Promise<string> {
  return cached<string>(cacheKey, ttl, async () => {
    const res = await fetch(`${BASE}${path}`, { headers: HEADERS, signal: AbortSignal.timeout(25_000) });
    if (!res.ok) throw new Error(`HiAnime request failed (${res.status})`);
    const text = await res.text();
    if (/<title>\s*Just a moment/i.test(text)) throw new Error("Anime source is blocking this server (Cloudflare)");
    return text;
  });
}

async function getJson<T>(path: string, ttl = 300): Promise<T> {
  const text = await getText(path, ttl);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("Anime source returned an unexpected response");
  }
}

function cover(url: string | undefined): string | null {
  if (!url) return null;
  if (!/^https:\/\//i.test(url)) return null;
  return `/api/img/anime?u=${encodeURIComponent(url)}`;
}

function parseCards(html: string): AnimeSummary[] {
  const scope = html.split('id="main-sidebar"')[0];
  const seen = new Set<string>();
  const out: AnimeSummary[] = [];

  for (const block of scope.split('<div class="flw-item').slice(1)) {
    const slug = block.match(/\/watch\/([a-z0-9-]+)/i)?.[1];
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);

    const title =
      block.match(/<h3 class="film-name">[\s\S]*?title="([^"]*)"/)?.[1] ||
      block.match(/<h3 class="film-name">[\s\S]*?>\s*([^<]+?)\s*<\/a>/)?.[1] ||
      slug;
    const img = block.match(/<img[^>]+(?:data-src|src)="([^"]+)"/)?.[1];
    const desc = block.match(/<div class="description">([\s\S]*?)<\/div>/)?.[1] || "";
    const type = block.match(/<span class="fdi-item">([^<]+)<\/span>/)?.[1] || null;
    const duration = block.match(/fdi-duration">([^<]+)<\/span>/)?.[1] || null;
    const sub = Number(block.match(/tick-sub[^>]*>[\s\S]*?(\d+)\s*<\/div>/)?.[1] || 0);
    const dub = Number(block.match(/tick-dub[^>]*>[\s\S]*?(\d+)\s*<\/div>/)?.[1] || 0);

    out.push({
      id: slug,
      title: decodeEntities(title),
      cover: cover(img),
      description: stripTags(desc),
      type,
      duration,
      rating: null,
      sub,
      dub,
    });
  }
  return out;
}

export async function searchAnime(query: string, page = 1): Promise<AnimeSummary[]> {
  const q = query.trim();
  if (!q) return [];
  const html = await getText(`/search?keyword=${encodeURIComponent(q)}&page=${Math.max(1, page)}`, 180);
  return parseCards(html);
}

export async function popularAnime(): Promise<AnimeSummary[]> {
  const html = await getText("/most-popular", 900);
  return parseCards(html);
}

export async function getAnime(id: string): Promise<AnimeSummary> {
  const html = await getText(`/watch/${encodeURIComponent(id)}`, 900);
  const title = html.match(/<h2 class="film-name">[\s\S]*?title="([^"]+)"/)?.[1] || id;
  const img = html.match(/<div class="anisc-poster">[\s\S]*?<img[^>]+src="([^"]+)"/)?.[1];
  const desc = html.match(/<div class="film-description[^"]*">[\s\S]*?<div class="text">([\s\S]*?)<\/div>/)?.[1] || "";
  const stats = html.match(/<div class="film-stats">([\s\S]*?)<div class="clearfix">/)?.[1] || "";
  const items = [...stats.matchAll(/<span class="item">([^<]+)<\/span>/g)].map((m) => m[1]);
  const rating = stats.match(/tick-pg">([^<]+)<\/div>/)?.[1] || null;
  const sub = Number(stats.match(/tick-sub"><i[^>]*><\/i>\s*(\d+)/)?.[1] || 0);
  const dub = Number(stats.match(/tick-dub"><i[^>]*><\/i>\s*(\d+)/)?.[1] || 0);

  return {
    id,
    title: decodeEntities(title),
    cover: cover(img),
    description: stripTags(desc),
    type: items[0] || null,
    duration: items[1] || null,
    rating,
    sub,
    dub,
  };
}

export async function getEpisodes(id: string): Promise<Episode[]> {
  const numeric = id.split("-").pop() || "";
  if (!/^\d+$/.test(numeric)) throw new Error("Invalid anime id");
  return cached(`hi:episodes:${id}`, 1800, async () => {
    const data = await getJson<{ status: boolean; html: string }>(`/api/theme/episode/list/${numeric}`, 1800);
    if (!data.html) return [];
    const seen = new Set<string>();
    const out: Episode[] = [];
    for (const tag of data.html.match(/<a\b[^>]*class="[^"]*ep-item[^"]*"[^>]*>/g) || []) {
      const number = tag.match(/data-number="([^"]+)"/)?.[1];
      const epId = tag.match(/data-id="(\d+)"/)?.[1];
      if (!number || !epId || seen.has(epId)) continue;
      seen.add(epId);
      out.push({ id: epId, number, title: `Episode ${number}` });
    }
    out.sort((a, b) => (parseFloat(a.number) || 0) - (parseFloat(b.number) || 0));
    return out;
  });
}

function decodeEmbed(blob: string): any {
  const raw = Buffer.from(blob, "base64");
  for (let i = 0; i < raw.length; i++) raw[i] ^= EMBED_KEY[i % EMBED_KEY.length];
  return JSON.parse(raw.toString("utf8"));
}

export type AnimeStream = {
  url: string;
  referer: string;
  subtitles: { lang: string; label: string; url: string }[];
};

export async function getStream(episodeId: string, lang: "sub" | "dub"): Promise<AnimeStream> {
  if (!/^\d+$/.test(episodeId)) throw new Error("Invalid episode id");
  return cached(`hi:stream:${episodeId}:${lang}`, 240, async () => {
    const servers = await getJson<{ html: string }>(`/api/theme/episode/servers?episodeId=${episodeId}`, 600);
    let hash: string | undefined;
    for (const block of (servers.html || "").split("server-item").slice(1)) {
      const type = block.match(/data-type="([^"]+)"/)?.[1];
      const name = block.match(/data-server-name="([^"]+)"/)?.[1];
      if (type === lang && name === "ZokoAnime") {
        hash = block.match(/data-hash="([^"]+)"/)?.[1];
        break;
      }
    }
    if (!hash) throw new Error(`No playable ${lang} source found for this episode`);

    const embedUrl = assertPublicHttpsUrl(Buffer.from(hash, "base64").toString("utf8"));
    await assertResolvesPublic(embedUrl);
    const embedRes = await fetch(embedUrl, {
      headers: { ...HEADERS, Referer: `${BASE}/` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!embedRes.ok) throw new Error(`Source embed failed (${embedRes.status})`);
    const embedHtml = await embedRes.text();
    const blob = embedHtml.match(/window\.__P="([^"]*)"/)?.[1];
    if (!blob) throw new Error("Could not read the embedded player config");
    const config = decodeEmbed(blob);
    const master = assertPublicHttpsUrl(String(config.src || ""));
    await assertResolvesPublic(master);

    const referer = `${embedUrl.protocol}//${embedUrl.host}/`;
    const masterRes = await fetch(master, {
      headers: { ...HEADERS, Referer: referer },
      signal: AbortSignal.timeout(20_000),
    });
    if (!masterRes.ok) throw new Error(`Stream playlist failed (${masterRes.status})`);
    const playlist = await masterRes.text();

    let best = master.toString();
    const lines = playlist.split(/\r?\n/);
    let bestHeight = -1;
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith("#EXT-X-STREAM-INF")) continue;
      const next = lines.slice(i + 1).find((l) => l.trim() && !l.startsWith("#"));
      if (!next) continue;
      const height = Number(lines[i].match(/RESOLUTION=\d+x(\d+)/)?.[1] || 0);
      if (height > bestHeight) {
        bestHeight = height;
        best = absoluteUrl(next.trim(), master.toString());
      }
    }

    const subtitles = (
      await Promise.all(
        (config.subtitles || [])
          .filter((s: any) => s?.src && s?.lang)
          .map(async (s: any) => {
            try {
              const url = assertPublicHttpsUrl(String(s.src));
              await assertResolvesPublic(url);
              return { lang: String(s.lang), label: String(s.label || s.lang), url: url.toString() };
            } catch {
              return null;
            }
          }),
      )
    ).filter(Boolean) as AnimeStream["subtitles"];

    return { url: best, referer, subtitles };
  });
}

export async function getSubtitle(episodeId: string, lang: "sub" | "dub"): Promise<{ body: string; lang: string } | null> {
  const stream = await getStream(episodeId, lang);
  const sub = stream.subtitles.find((s) => s.lang === "en") || stream.subtitles[0];
  if (!sub) return null;
  const res = await fetch(sub.url, {
    headers: { ...HEADERS, Referer: stream.referer },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return null;
  return { body: await res.text(), lang: sub.lang };
}
