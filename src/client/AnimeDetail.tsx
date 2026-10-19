import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { AnimeSummary, DownloadJob, Episode } from "../shared/types";
import {
  del,
  errorMessage,
  post,
  request,
  useDownloads,
  useFavourites,
  type ItemsResponse,
} from "./api";
import { Link } from "./router";
import { Cover, Empty, ErrorView, IconDownload, IconHeart, Loading } from "./ui";

export function AnimeDetailPage({ id }: { id: string }) {
  const [lang, setLang] = useState<"sub" | "dub">("sub");
  const [limit, setLimit] = useState(100);
  const queryClient = useQueryClient();

  const animeQuery = useQuery({
    queryKey: ["anime", id],
    queryFn: () => request<AnimeSummary>(`/api/anime/${encodeURIComponent(id)}`),
  });
  const episodesQuery = useQuery({
    queryKey: ["anime", id, "episodes"],
    queryFn: () => request<ItemsResponse<Episode>>(`/api/anime/${encodeURIComponent(id)}/episodes`),
  });
  const favourites = useFavourites();
  const downloads = useDownloads();

  const anime = animeQuery.data;
  const favourite = favourites.data?.items.some((item) => item.kind === "anime" && item.sourceId === id) ?? false;
  const downloaded = new Set(
    (downloads.data?.items ?? [])
      .filter((job) => job.kind === "anime" && job.status === "done" && job.lang === lang)
      .map((job) => job.itemId),
  );

  const toggleFavourite = useMutation({
    mutationFn: async () => {
      if (favourite) {
        await del<{ ok: boolean }>(`/api/favourites/anime/${encodeURIComponent(id)}`);
        return;
      }
      if (!anime) return;
      await post<{ ok: boolean }>("/api/favourites", {
        kind: "anime",
        sourceId: id,
        title: anime.title,
        cover: anime.cover,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["favourites"] }),
  });

  const download = useMutation({
    mutationFn: (episode: Episode) => {
      if (!anime) throw new Error("Anime is not loaded");
      return post<DownloadJob>("/api/downloads", {
        kind: "anime",
        sourceId: id,
        itemId: episode.id,
        title: anime.title,
        label: `Episode ${episode.number}`,
        cover: anime.cover,
        lang,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["downloads"] }),
  });

  if (animeQuery.isPending) return <Loading label="Loading anime…" />;
  if (animeQuery.isError) return <ErrorView error={animeQuery.error} onRetry={() => animeQuery.refetch()} />;
  if (!anime) return <Empty>Anime not found.</Empty>;

  const episodes = episodesQuery.data?.items ?? [];

  return (
    <>
      <div className="hero">
        <Cover src={anime.cover} alt={`Cover of ${anime.title}`} className="hero-cover" eager />
        <div className="hero-info">
          <h1>{anime.title}</h1>
          <div className="meta-line">
            {anime.type && <span>{anime.type}</span>}
            {anime.duration && <span>{anime.duration}</span>}
            {anime.rating && <span>{anime.rating}</span>}
            {episodesQuery.data && <span>{episodes.length} episodes</span>}
          </div>
          <p className="description">{anime.description || "No description available."}</p>
          <div className="hero-actions">
            <div className="segmented" role="group" aria-label="Audio language">
              <button
                type="button"
                className={lang === "sub" ? "active" : ""}
                aria-pressed={lang === "sub"}
                onClick={() => setLang("sub")}
              >
                Sub ({anime.sub})
              </button>
              <button
                type="button"
                className={lang === "dub" ? "active" : ""}
                aria-pressed={lang === "dub"}
                disabled={anime.dub === 0}
                onClick={() => setLang("dub")}
              >
                Dub ({anime.dub})
              </button>
            </div>
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
          <h2>Episodes</h2>
          {episodesQuery.data && <span className="muted">Downloads in {lang}</span>}
        </div>

        {episodesQuery.isPending && <Loading label="Loading episodes…" />}
        {episodesQuery.isError && <ErrorView error={episodesQuery.error} onRetry={() => episodesQuery.refetch()} />}
        {episodesQuery.isSuccess && episodes.length === 0 && <Empty>No episodes available.</Empty>}

        {download.isError && (
          <p className="form-error" role="alert">
            {errorMessage(download.error)}
          </p>
        )}

        {episodes.length > 0 && (
          <div className="list">
            {episodes.slice(0, limit).map((episode) => {
              const isDownloaded = downloaded.has(episode.id);
              const isDownloading = download.isPending && download.variables?.id === episode.id;
              const title = `Episode ${episode.number}`;
              return (
                <div className="row" key={episode.id}>
                  <div className="row-main">
                    <div className="row-title">{title}</div>
                    {episode.title !== title && <div className="row-sub">{episode.title}</div>}
                  </div>
                  <div className="row-actions">
                    {isDownloaded && <span className="badge badge-done">Downloaded</span>}
                    <Link
                      className="btn btn-sm"
                      to={`/anime/watch/${episode.id}?lang=${lang}&title=${encodeURIComponent(title)}`}
                    >
                      Watch
                    </Link>
                    {!isDownloaded && (
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        disabled={isDownloading}
                        onClick={() => download.mutate(episode)}
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

        {episodes.length > limit && (
          <div className="section-more">
            <button type="button" className="btn" onClick={() => setLimit((value) => value + 100)}>
              Show more ({episodes.length - limit} remaining)
            </button>
          </div>
        )}
      </section>
    </>
  );
}
