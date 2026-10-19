import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Chapter, DownloadJob } from "../shared/types";
import {
  MANGA_LANGS,
  chapterLabel,
  del,
  errorMessage,
  post,
  request,
  useDownloads,
  useFavourites,
  useMangaLang,
  type ChaptersResponse,
  type MangaDetailResponse,
} from "./api";
import { Link } from "./router";
import { Cover, Empty, ErrorView, IconDownload, IconHeart, Loading } from "./ui";

export function MangaDetailPage({ id }: { id: string }) {
  const [lang, setLang] = useMangaLang();
  const [limit, setLimit] = useState(100);
  const queryClient = useQueryClient();

  const mangaQuery = useQuery({
    queryKey: ["manga", id, lang],
    queryFn: () => request<MangaDetailResponse>(`/api/manga/${encodeURIComponent(id)}?lang=${encodeURIComponent(lang)}`),
  });
  const chaptersQuery = useQuery({
    queryKey: ["manga", id, "chapters", lang],
    queryFn: () =>
      request<ChaptersResponse>(`/api/manga/${encodeURIComponent(id)}/chapters?lang=${encodeURIComponent(lang)}`),
  });
  const favourites = useFavourites();
  const downloads = useDownloads();

  const manga = mangaQuery.data;
  const favourite = favourites.data?.items.some((item) => item.kind === "manga" && item.sourceId === id) ?? false;
  const downloaded = new Set(
    (downloads.data?.items ?? [])
      .filter((job) => job.kind === "manga" && job.status === "done")
      .map((job) => job.itemId),
  );

  const toggleFavourite = useMutation({
    mutationFn: async () => {
      if (favourite) {
        await del<{ ok: boolean }>(`/api/favourites/manga/${encodeURIComponent(id)}`);
        return;
      }
      if (!manga) return;
      await post<{ ok: boolean }>("/api/favourites", {
        kind: "manga",
        sourceId: id,
        title: manga.title,
        cover: manga.cover,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["favourites"] }),
  });

  const download = useMutation({
    mutationFn: (chapter: Chapter) => {
      if (!manga) throw new Error("Manga is not loaded");
      return post<DownloadJob>("/api/downloads", {
        kind: "manga",
        sourceId: id,
        itemId: chapter.id,
        title: manga.title,
        label: chapterLabel(chapter),
        cover: manga.cover,
        lang,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["downloads"] }),
  });

  if (mangaQuery.isPending) return <Loading label="Loading manga…" />;
  if (mangaQuery.isError) return <ErrorView error={mangaQuery.error} onRetry={() => mangaQuery.refetch()} />;
  if (!manga) return <Empty>Manga not found.</Empty>;

  const chapters = chaptersQuery.data?.items ?? [];

  return (
    <>
      <div className="hero">
        <Cover src={manga.cover} alt={`Cover of ${manga.title}`} className="hero-cover" eager />
        <div className="hero-info">
          <h1>{manga.title}</h1>
          {manga.authors.length > 0 && <p className="meta-line">{manga.authors.join(", ")}</p>}
          <div className="meta-line">
            {manga.year && <span>{manga.year}</span>}
            {manga.status && <span className="capitalize">{manga.status.replace(/_/g, " ")}</span>}
            {chaptersQuery.data && <span>{chapters.length} chapters</span>}
          </div>
          {manga.tags.length > 0 && (
            <div className="tags">
              {manga.tags.map((tag) => (
                <span key={tag} className="tag">
                  {tag}
                </span>
              ))}
            </div>
          )}
          <p className="description">{manga.description || "No description available."}</p>
          <div className="hero-actions">
            <label className="lang-select">
              <span className="muted">Language</span>
              <select
                className="select"
                value={lang}
                onChange={(event) => {
                  setLang(event.target.value);
                  setLimit(100);
                }}
              >
                {MANGA_LANGS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={`btn ${favourite ? "btn-primary" : "btn-ghost"}`}
              aria-pressed={favourite}
              disabled={toggleFavourite.isPending}
              onClick={() => toggleFavourite.mutate()}
            >
              <IconHeart />
              {favourite ? "Favourited" : "Favourite"}
            </button>
          </div>
          {toggleFavourite.isError && (
            <p className="form-error" role="alert">
              {errorMessage(toggleFavourite.error)}
            </p>
          )}
        </div>
      </div>

      <section className="section">
        <div className="section-head">
          <h2>Chapters</h2>
          {chaptersQuery.data && <span className="muted">{chapters.length} available</span>}
        </div>

        {chaptersQuery.isPending && <Loading label="Loading chapters…" />}
        {chaptersQuery.isError && <ErrorView error={chaptersQuery.error} onRetry={() => chaptersQuery.refetch()} />}
        {chaptersQuery.isSuccess && chapters.length === 0 && (
          <Empty>No chapters in this language.</Empty>
        )}

        {download.isError && (
          <p className="form-error" role="alert">
            {errorMessage(download.error)}
          </p>
        )}

        {chapters.length > 0 && (
          <div className="list">
            {chapters.slice(0, limit).map((chapter) => {
              const label = chapterLabel(chapter);
              const isDownloaded = downloaded.has(chapter.id);
              const isDownloading = download.isPending && download.variables?.id === chapter.id;
              return (
                <div className="row" key={chapter.id}>
                  <div className="row-main">
                    <div className="row-title">
                      {label}
                      {chapter.title ? ` — ${chapter.title}` : ""}
                    </div>
                    <div className="row-sub">
                      {[chapter.group, chapter.pages ? `${chapter.pages} pages` : null, chapter.publishedAt ? new Date(chapter.publishedAt).toLocaleDateString() : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <div className="row-actions">
                    {isDownloaded && <span className="badge badge-done">Downloaded</span>}
                    <Link className="btn btn-sm" to={`/manga/chapter/${chapter.id}`}>
                      Read
                    </Link>
                    <a
                      className="btn btn-sm btn-ghost"
                      href={`/api/manga/chapter/${chapter.id}/file`}
                      title="Download to device"
                    >
                      Download to device
                    </a>
                    {!isDownloaded && (
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        disabled={isDownloading}
                        onClick={() => download.mutate(chapter)}
                      >
                        <IconDownload />
                        {isDownloading ? "Saving…" : "Download"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {chapters.length > limit && (
          <div className="section-more">
            <button type="button" className="btn" onClick={() => setLimit((value) => value + 100)}>
              Show more ({chapters.length - limit} remaining)
            </button>
          </div>
        )}
      </section>
    </>
  );
}
