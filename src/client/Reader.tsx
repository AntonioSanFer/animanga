import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Chapter } from "../shared/types";
import { errorMessage, fetchReaderData, request, withProvider, type ChaptersResponse } from "./api";
import { ProviderPicker, saveProgress, setSeenTotal } from "./bits";
import { navigate } from "./router";
import { IconArrowLeft, Loading } from "./ui";

function provOf(search: string): string {
  return new URLSearchParams(search).get("provider") ?? "";
}

export function ReaderPage({ chapterId, search }: { chapterId: string; search: string }) {
  const provider = provOf(search);
  const query = useQuery({
    queryKey: ["reader", chapterId, provider],
    queryFn: () => fetchReaderData(chapterId, provider),
  });
  const data = query.data;
  const mangaId = data?.chapter.mangaId ?? null;
  const [urls, setUrls] = useState<string[]>([]);

  const siblings = useQuery({
    queryKey: ["reader", "siblings", mangaId, data?.chapter.lang, provider],
    queryFn: () =>
      request<ChaptersResponse>(
        withProvider(
          `/api/manga/${encodeURIComponent(mangaId!)}/chapters?lang=${encodeURIComponent(data!.chapter.lang)}`,
          provider,
        ),
      ),
    enabled: mangaId !== null && data !== undefined,
    staleTime: 300_000,
  });
  const list: Chapter[] = siblings.data?.items ?? [];
  const index = data ? list.findIndex((chapter) => chapter.id === data.chapter.id) : -1;
  const prev = index > 0 ? list[index - 1] : null;
  const next = index !== -1 && index < list.length - 1 ? list[index + 1] : null;

  useEffect(() => {
    if (!data || !mangaId) return;
    const chapter = data.chapter;
    const url = withProvider(`/manga/chapter/${chapter.id}`, provider);
    saveProgress({
      kind: "manga",
      seriesId: mangaId,
      seriesTitle: chapter.mangaTitle ?? "Manga",
      cover: null,
      itemId: chapter.id,
      label: `${chapter.volume ? `Vol.${chapter.volume} ` : ""}${chapter.chapter ? `Ch.${chapter.chapter}` : "Chapter"}`,
      lang: chapter.lang,
      url,
    });
    if (list.length > 0) setSeenTotal("manga", mangaId, list.length);
  }, [data, mangaId, list.length, provider]);

  function back() {
    navigate(mangaId ? `/manga/${mangaId}` : "/downloads");
  }

  function goChapter(id: string) {
    navigate(withProvider(`/manga/chapter/${id}`, provider));
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        navigate(mangaId ? `/manga/${mangaId}` : "/downloads");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mangaId]);

  useEffect(() => {
    if (!data) {
      setUrls([]);
      return;
    }
    if (!data.blobs) {
      setUrls(data.chapter.pages);
      return;
    }
    const created = data.blobs.map((blob) => URL.createObjectURL(new Blob([blob as unknown as BlobPart])));
    setUrls(created);
    return () => {
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, [data]);

  const chapter = data?.chapter;
  const label = chapter
    ? `${chapter.volume ? `Vol.${chapter.volume} ` : ""}${chapter.chapter ? `Ch.${chapter.chapter}` : "Chapter"}${
        chapter.title ? ` — ${chapter.title}` : ""
      }`
    : "Chapter";

  return (
    <div className="reader">
      <div className="reader-bar">
        <button type="button" className="btn btn-sm btn-ghost" onClick={back}>
          <IconArrowLeft />
          Back
        </button>
        <button type="button" className="btn btn-sm btn-ghost" disabled={!prev} onClick={() => prev && goChapter(prev.id)}>
          ← Prev
        </button>
        <button type="button" className="btn btn-sm btn-ghost" disabled={!next} onClick={() => next && goChapter(next.id)}>
          Next →
        </button>
        <span className="title">
          {chapter?.mangaTitle ? `${chapter.mangaTitle} · ` : ""}
          {label}
        </span>
        <ProviderPicker
          kind="manga"
          value={provider}
          onChange={(nextProvider) =>
            navigate(withProvider(`/manga/chapter/${chapterId}`, nextProvider))
          }
        />
        {chapter && (
          <span className="muted">
            {chapter.pages.length} pages{data?.blobs ? " · saved copy" : ""}
          </span>
        )}
      </div>

      {query.isPending && (
        <div className="reader-pages">
          <Loading label="Loading chapter…" />
        </div>
      )}

      {query.isError && (
        <div className="reader-pages">
          <div className="state error" role="alert">
            <p>{errorMessage(query.error)}</p>
            <button type="button" className="btn btn-sm" onClick={() => query.refetch()}>
              Try again
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={back}>
              Back
            </button>
          </div>
        </div>
      )}

      {query.isSuccess && (
        <div className="reader-pages">
          {urls.map((src, idx) => (
            <img
              key={src}
              src={src}
              alt={`Page ${idx + 1}`}
              loading={idx < 3 ? "eager" : "lazy"}
              onError={(event) => {
                const fallback = data?.chapter.pages[idx];
                const image = event.currentTarget;
                if (!fallback || image.dataset.fallback) return;
                image.dataset.fallback = "1";
                image.src = fallback;
              }}
            />
          ))}
          {urls.length === 0 && <p className="state">This chapter has no pages.</p>}
        </div>
      )}
    </div>
  );
}
