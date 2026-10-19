import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { errorMessage, fetchReaderData } from "./api";
import { navigate } from "./router";
import { IconArrowLeft, Loading } from "./ui";

export function ReaderPage({ chapterId }: { chapterId: string }) {
  const query = useQuery({
    queryKey: ["reader", chapterId],
    queryFn: () => fetchReaderData(chapterId),
  });
  const data = query.data;
  const mangaId = data?.chapter.mangaId ?? null;
  const [urls, setUrls] = useState<string[]>([]);

  function back() {
    navigate(mangaId ? `/manga/${mangaId}` : "/downloads");
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
        <span className="title">
          {chapter?.mangaTitle ? `${chapter.mangaTitle} · ` : ""}
          {label}
        </span>
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
          {urls.map((src, index) => (
            <img
              key={src}
              src={src}
              alt={`Page ${index + 1}`}
              loading={index < 3 ? "eager" : "lazy"}
              onError={(event) => {
                const fallback = data?.chapter.pages[index];
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
