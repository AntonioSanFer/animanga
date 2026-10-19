import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
  useProvider,
  withProvider,
  type ChaptersResponse,
  type MangaDetailResponse,
} from "./api";
import { BackButton, ProviderPicker, getProgress, safeEntryUrl, setSeenTotal } from "./bits";
import { Link } from "./router";
import { Cover, Empty, ErrorView, IconDownload, IconHeart, Loading } from "./ui";

export function MangaDetailPage({ id }: { id: string }) {
  const [lang, setLang] = useMangaLang();
  const [provider, setProvider] = useProvider("manga");
  const [limit, setLimit] = useState(100);
  const [volume, setVolume] = useState("all");
  const queryClient = useQueryClient();

  const mangaQuery = useQuery({
    queryKey: ["manga", id, lang, provider],
    queryFn: () =>
      request<MangaDetailResponse>(withProvider(`/api/manga/${encodeURIComponent(id)}?lang=${encodeURIComponent(lang)}`, provider)),
  });
  const chaptersQuery = useQuery({
    queryKey: ["manga", id, "chapters", lang, provider],
    queryFn: () =>
      request<ChaptersResponse>(
        withProvider(`/api/manga/${encodeURIComponent(id)}/chapters?lang=${encodeURIComponent(lang)}`, provider),
      ),
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

  const downloadAll = useMutation({
    mutationFn: async (items: Chapter[]) => {
      if (!manga) throw new Error("Manga is not loaded");
      for (const chapter of items) {
        await post("/api/downloads", {
          kind: "manga",
          sourceId: id,
          itemId: chapter.id,
          title: manga.title,
          label: chapterLabel(chapter),
          cover: manga.cover,
          lang,
        });
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["downloads"] }),
  });

  const chapters = chaptersQuery.data?.items ?? [];
  useEffect(() => {
    if (chapters.length > 0) setSeenTotal("manga", id, chapters.length);
  }, [id, chapters.length]);

  if (mangaQuery.isPending) return <Loading label="Loading manga…" />;
  if (mangaQuery.isError) return <ErrorView error={mangaQuery.error} onRetry={() => mangaQuery.refetch()} />;
  if (!manga) return <Empty>Manga not found.</Empty>;

  const volumes = [...new Set(chapters.map((chapter) => chapter.volume ?? ""))];
  const visible = volume === "all" ? chapters : chapters.filter((chapter) => (chapter.volume ?? "") === volume);
  const latest = chapters[chapters.length - 1];
  const saved = getProgress("manga", id);
  const savedIndex = saved ? chapters.findIndex((chapter) => chapter.id === saved.itemId) : -1;

  return (
    <>
      <div className="back-row">
        <BackButton to="/manga" />
      </div>
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
            <ProviderPicker kind="manga" value={provider} onChange={setProvider} />
            {latest && (
              <Link className="btn btn-sm" to={withProvider(`/manga/chapter/${latest.id}`, provider)}>
                Latest: {chapterLabel(latest)}
              </Link>
            )}
            {saved && (
              <Link className="btn btn-sm btn-primary" to={safeEntryUrl(saved.url)}>
                Continue: {saved.label}
              </Link>
            )}
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
        <div className="toolbar">
          {volumes.length > 1 && (
            <label className="lang-select">
              <span className="muted">Volume</span>
              <select className="select" value={volume} onChange={(event) => setVolume(event.target.value)}>
                <option value="all">All ({chapters.length})</option>
                {volumes.map((item) => (
                  <option key={item} value={item}>
                    {item || "No volume"} ({chapters.filter((c) => (c.volume ?? "") === item).length})
                  </option>
                ))}
              </select>
            </label>
          )}
          {visible.length > 0 && (
            <button
              type="button"
              className="btn btn-sm"
              disabled={downloadAll.isPending}
              onClick={() => downloadAll.mutate(visible)}
            >
              <IconDownload />
              {downloadAll.isPending ? "Queuing…" : `Download all (${visible.length})`}
            </button>
          )}
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

        {(download.isError || downloadAll.isError) && (
          <p className="form-error" role="alert">
            {errorMessage(download.error ?? downloadAll.error)}
          </p>
        )}

        {visible.length > 0 && (
          <div className="list">
            {visible.slice(0, limit).map((chapter) => {
              const label = chapterLabel(chapter);
              const isDownloaded = downloaded.has(chapter.id);
              const isDownloading = download.isPending && download.variables?.id === chapter.id;
              const isNew = saved !== null && savedIndex !== -1 && chapters.indexOf(chapter) > savedIndex;
              return (
                <div className="row" key={chapter.id}>
                  <div className="row-main">
                    <div className="row-title">
                      {label}
                      {chapter.title ? ` — ${chapter.title}` : ""} {isNew && <span className="badge badge-accent">New</span>}
                    </div>
                    <div className="row-sub">
                      {[chapter.group, chapter.pages ? `${chapter.pages} pages` : null, chapter.publishedAt ? new Date(chapter.publishedAt).toLocaleDateString() : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <div className="row-actions">
                    {isDownloaded && <span className="badge badge-done">Downloaded</span>}
                    <Link className="btn btn-sm" to={withProvider(`/manga/chapter/${chapter.id}`, provider)}>
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

        {visible.length > limit && (
          <div className="section-more">
            <button type="button" className="btn" onClick={() => setLimit((value) => value + 100)}>
              Show more ({visible.length - limit} remaining)
            </button>
          </div>
        )}
      </section>
    </>
  );
}
