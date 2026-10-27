import { useQuery } from "@tanstack/react-query";
import { unzipSync } from "fflate";
import { useState } from "react";
import type {
  AiO,
  AppUser,
  Chapter,
  ChapterPage,
  DownloadJob,
  Favourite,
  MangaSummary,
  Me,
} from "../shared/types";

export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(status: number, message: string, data: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: "include", ...init });
  } catch {
    throw new ApiError(0, "Could not reach the server.");
  }

  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!res.ok) {
    const message = isRecord(body) && typeof body.error === "string" ? body.error : `Request failed (${res.status})`;
    throw new ApiError(res.status, message, body);
  }

  return body as T;
}

export function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function patch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function del<T>(path: string): Promise<T> {
  return request<T>(path, { method: "DELETE" });
}

export interface ProvidersResponse {
  providers: AiO[];
  password: boolean;
  callbacks: (AiO & { url: string })[];
}

export interface ItemsResponse<T> {
  items: T[];
}

export interface SearchResponse {
  items: MangaSummary[];
  total: number;
}

export interface MangaDetailResponse extends MangaSummary {
  authors: string[];
}

export interface ChaptersResponse {
  items: Chapter[];
  lang: string;
}

export interface AdminUser extends AppUser {
  favourites: number;
}

export interface ReaderData {
  chapter: ChapterPage;
  blobs: Uint8Array[] | null;
}

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => request<Me>("/api/me"),
    retry: (failureCount, error) =>
      !(error instanceof ApiError && (error.status === 401 || error.status === 403)) && failureCount < 1,
  });
}

export interface DownloadedKey {
  kind: string;
  itemId: string;
  lang: string | null;
}

export interface DownloadsResponse {
  items: DownloadJob[];
  downloaded?: DownloadedKey[];
}

export function useDownloads() {
  return useQuery({
    queryKey: ["downloads"],
    queryFn: () => request<DownloadsResponse>("/api/downloads"),
    refetchInterval: (query) => {
      const items = query.state.data?.items;
      return items?.some((job) => job.status === "queued" || job.status === "downloading") ? 2000 : false;
    },
  });
}

export function useFavourites() {
  return useQuery({
    queryKey: ["favourites"],
    queryFn: () => request<ItemsResponse<Favourite>>("/api/favourites"),
  });
}

async function savedCopyId(chapter: ChapterPage): Promise<number | null> {
  if (typeof chapter.downloadId === "number") return chapter.downloadId;
  const downloads = await request<DownloadsResponse>("/api/downloads").catch(() => null);
  return (
    downloads?.items.find((item) => item.kind === "manga" && item.itemId === chapter.id && item.status === "done")?.id ?? null
  );
}

export async function fetchReaderData(chapterId: string, provider = ""): Promise<ReaderData> {
  const chapter = await request<ChapterPage>(
    withProvider(`/api/manga/chapter/${encodeURIComponent(chapterId)}?q=hq`, provider),
  );

  const jobId = await savedCopyId(chapter);
  if (jobId === null) return { chapter, blobs: null };

  try {
    const res = await fetch(`/api/downloads/${jobId}/file`, { credentials: "include" });
    if (!res.ok) return { chapter, blobs: null };
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const blobs = Object.keys(files)
      .filter((name) => !name.endsWith("/") && files[name].length > 0)
      .sort()
      .map((name) => files[name]);
    return { chapter, blobs: blobs.length > 0 ? blobs : null };
  } catch {
    return { chapter, blobs: null };
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong.";
}

export function formatBytes(size: number | null): string {
  if (size === null || size < 0) return "—";
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

export function formatDate(timestamp: number | null | undefined): string {
  if (!timestamp) return "Never";
  return new Date(timestamp).toLocaleString();
}

export function chapterLabel(chapter: { volume: string | null; chapter: string | null }): string {
  const volume = chapter.volume ? `Vol.${chapter.volume}` : "";
  const number = chapter.chapter ? `Ch.${chapter.chapter}` : "";
  return [volume, number].filter(Boolean).join(" ") || "Chapter";
}

export const MANGA_LANG_KEY = "animanga:manga-lang";

export const MANGA_LANGS: { id: string; label: string }[] = [
  { id: "en", label: "English" },
  { id: "es", label: "Spanish" },
  { id: "es-la", label: "Spanish (LatAm)" },
  { id: "fr", label: "French" },
  { id: "de", label: "German" },
  { id: "pt-br", label: "Portuguese (BR)" },
  { id: "it", label: "Italian" },
  { id: "ru", label: "Russian" },
  { id: "pl", label: "Polish" },
  { id: "tr", label: "Turkish" },
  { id: "ar", label: "Arabic" },
  { id: "hi", label: "Hindi" },
  { id: "id", label: "Indonesian" },
  { id: "th", label: "Thai" },
  { id: "vi", label: "Vietnamese" },
  { id: "ja", label: "Japanese" },
  { id: "ko", label: "Korean" },
  { id: "zh", label: "Chinese" },
  { id: "zh-hk", label: "Chinese (HK)" },
];

function readMangaLang(): string {
  try {
    const stored = window.localStorage.getItem(MANGA_LANG_KEY);
    if (stored && MANGA_LANGS.some((lang) => lang.id === stored)) return stored;
  } catch {
    // ignore storage access failures
  }
  return "en";
}

export function useMangaLang(): [string, (lang: string) => void] {
  const [lang, setLang] = useState(readMangaLang);
  const update = (next: string) => {
    setLang(next);
    try {
      window.localStorage.setItem(MANGA_LANG_KEY, next);
    } catch {
      // ignore storage access failures
    }
  };
  return [lang, update];
}

export function withProvider(url: string, provider: string): string {
  return provider ? `${url}${url.includes("?") ? "&" : "?"}provider=${encodeURIComponent(provider)}` : url;
}

export function useProvider(kind: "manga" | "anime"): [string, (value: string) => void] {
  const key = `animanga:provider:${kind}`;
  const [value, setValue] = useState(() => {
    try {
      return window.localStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  });
  return [
    value,
    (next: string) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, next);
      } catch {
        // ignore storage access failures
      }
    },
  ];
}

export interface ContentProviderItem {
  id: string;
  label: string;
  kind: string;
}

export function useContentProviders(kind: "manga" | "anime") {
  return useQuery({
    queryKey: ["content-providers"],
    queryFn: () => request<{ items: ContentProviderItem[] }>("/api/content-providers"),
    staleTime: 300_000,
    select: (data) => data.items.filter((item) => item.kind === kind),
  });
}
