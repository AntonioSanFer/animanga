import type { AnimeSummary, Chapter, ChapterPage, Episode, MangaSummary } from "../../shared/types";
import * as mangadex from "./mangadex";
import * as weebcentral from "./weebcentral";
import * as mangapill from "./mangapill";
import * as hianime from "./hianime";

export interface MangaFilters {
  status?: string;
  sort?: string;
  demographic?: string;
}

export interface AnimeFilters {
  type?: string;
  status?: string;
  sort?: string;
}

export interface MangaProvider {
  id: string;
  label: string;
  search: (query: string, lang: string, page: number, filters?: MangaFilters) => Promise<{ items: MangaSummary[]; total: number }>;
  popular: (lang: string, page?: number, filters?: MangaFilters) => Promise<{ items: MangaSummary[]; total: number }>;
  get: (id: string) => Promise<MangaSummary & { authors: string[] }>;
  chapters: (id: string, lang: string) => Promise<Chapter[]>;
  chapter: (chapterId: string, quality: "data" | "data-saver") => Promise<ChapterPage>;
}

export interface AnimeProvider {
  id: string;
  label: string;
  search: (query: string, page: number, filters?: AnimeFilters) => Promise<AnimeSummary[]>;
  popular: (page?: number, filters?: AnimeFilters) => Promise<AnimeSummary[]>;
  get: (id: string) => Promise<AnimeSummary>;
  episodes: (id: string) => Promise<Episode[]>;
  stream: (episodeId: string, lang: "sub" | "dub") => Promise<hianime.AnimeStream>;
  subtitle: (episodeId: string, lang: "sub" | "dub") => Promise<{ body: string; lang: string } | null>;
}

// ponytail: array order = main first; push future fallback providers after.
export const mangaProviders: MangaProvider[] = [
  {
    id: "mangadex",
    label: "MangaDex",
    search: mangadex.searchManga,
    popular: mangadex.popularManga,
    get: mangadex.getManga,
    chapters: mangadex.getChapters,
    chapter: mangadex.getChapter,
  },
  {
    id: "weebcentral",
    label: "WeebCentral",
    search: weebcentral.searchManga,
    popular: weebcentral.popularManga,
    get: weebcentral.getManga,
    chapters: weebcentral.getChapters,
    chapter: weebcentral.getChapter,
  },
  {
    id: "mangapill",
    label: "MangaPill",
    search: mangapill.searchManga,
    popular: mangapill.popularManga,
    get: mangapill.getManga,
    chapters: mangapill.getChapters,
    chapter: mangapill.getChapter,
  },
];

export const animeProviders: AnimeProvider[] = [
  {
    id: "hianime",
    label: "HiAnime",
    search: hianime.searchAnime,
    popular: hianime.popularAnime,
    get: hianime.getAnime,
    episodes: hianime.getEpisodes,
    stream: hianime.getStream,
    subtitle: hianime.getSubtitle,
  },
];

export function contentProviders(): { id: string; label: string; kind: "manga" | "anime" }[] {
  return [
    ...mangaProviders.map((p) => ({ id: p.id, label: p.label, kind: "manga" as const })),
    ...animeProviders.map((p) => ({ id: p.id, label: p.label, kind: "anime" as const })),
  ];
}

function ordered<T extends { id: string }>(providers: T[], requested?: string): T[] {
  if (!requested) return providers;
  const match = providers.find((p) => p.id === requested);
  return match ? [match, ...providers.filter((p) => p.id !== requested)] : providers;
}

export function mangaOrdered(requested?: string): MangaProvider[] {
  return ordered(mangaProviders, requested);
}

export function animeOrdered(requested?: string): AnimeProvider[] {
  return ordered(animeProviders, requested);
}

export function knownProvider(kind: "manga" | "anime", id: string): boolean {
  const list = kind === "manga" ? mangaProviders : animeProviders;
  return list.some((p) => p.id === id);
}

// ponytail: sequential fallback; throws last error when every provider fails.
export async function tryProviders<T extends { id: string }, R>(
  providers: T[],
  fn: (p: T) => Promise<R>,
): Promise<{ result: R; providerId: string }> {
  let lastErr: unknown = new Error("No providers registered");
  for (const p of providers) {
    try {
      return { result: await fn(p), providerId: p.id };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}
