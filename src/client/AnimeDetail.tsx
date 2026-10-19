import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { AnimeSummary, DownloadJob, Episode } from "../shared/types";
import {
  del,
  errorMessage,
  post,
  request,
  useDownloads,
  useFavourites,
  useProvider,
  withProvider,
  type ItemsResponse,
} from "./api";
import { BackButton, ProviderPicker, getProgress, safeEntryUrl, setSeenTotal } from "./bits";
import { Link } from "./router";
import { Cover, Empty, ErrorView, IconDownload, IconHeart, Loading } from "./ui";

export function AnimeDetailPage({ id }: { id: string }) {
  const [lang, setLang] = useState<"sub" | "dub">("sub");
  const [provider, setProvider] = useProvider("anime");
  const [limit, setLimit] = useState(100);
  const queryClient = useQueryClient();

  const animeQuery = useQuery({
    queryKey: ["anime", id, provider],
    queryFn: () => request<AnimeSummary>(withProvider(`/api/anime/${encodeURIComponent(id)}`, provider)),
  });
  const episodesQuery = useQuery({
    queryKey: ["anime", id, "episodes", provider],
    queryFn: () =>
      request<ItemsResponse<Episode>>(withProvider(`/api/anime/${encodeURIComponent(id)}/episodes`, provider)),
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

  const downloadAll = useMutation({
    mutationFn: async (items: Episode[]) => {
      if (!anime) throw new Error("Anime is not loaded");
      for (const episode of items) {
        await post("/api/downloads", {
          kind: "anime",
          sourceId: id,
          itemId: episode.id,
          title: anime.title,
          label: `Episode ${episode.number}`,
          cover: anime.cover,
          lang,
        });
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["downloads"] }),
  });

  const episodes = episodesQuery.data?.items ?? [];
  useEffect(() => {
    if (episodes.length > 0) setSeenTotal("anime", id, episodes.length);
  }, [id, episodes.length]);

  if (animeQuery.isPending) return <Loading label="Loading anime…" />;
  if (animeQuery.isError) return <ErrorView error={animeQuery.error} onRetry={() => animeQuery.refetch()} />;
  if (!anime) return <Empty>Anime not found.</Empty>;

  const latest = episodes[episodes.length - 1];
  const saved = getProgress("anime", id);
  const savedIndex = saved ? episodes.findIndex((episode) => episode.id === saved.itemId) : -1;

  return (
    <>
      <div className="back-row">
        <BackButton to="/anime" />
      </div>
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
            <ProviderPicker kind="anime" value={provider} onChange={setProvider} />
            {latest && (
              <Link
                className="btn btn-sm"
                to={withProvider(
                  `/anime/watch/${latest.id}?lang=${lang}&title=${encodeURIComponent(`Episode ${latest.number}`)}&animeId=${encodeURIComponent(id)}&series=${encodeURIComponent(anime.title)}`,
                  provider,
                )}
              >
                Latest: Episode {latest.number}
              </Link>
            )}
            {saved && (
              <Link className="btn btn-sm btn-primary" to={safeEntryUrl(saved.url)}>
                Continue: {saved.label}
              </Link>
            )}
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

        {(download.isError || downloadAll.isError) && (
          <p className="form-error" role="alert">
            {errorMessage(download.error ?? downloadAll.error)}
          </p>
        )}

        {episodes.length > 0 && (
          <div className="toolbar">
            <button
              type="button"
              className="btn btn-sm"
              disabled={downloadAll.isPending}
              onClick={() => downloadAll.mutate(episodes)}
            >
              <IconDownload />
              {downloadAll.isPending ? "Queuing…" : `Download all (${episodes.length})`}
            </button>
          </div>
        )}

        {episodes.length > 0 && (
          <div className="list">
            {episodes.slice(0, limit).map((episode, index) => {
              const isDownloaded = downloaded.has(episode.id);
              const isDownloading = download.isPending && download.variables?.id === episode.id;
              const title = `Episode ${episode.number}`;
              const isNew = saved !== null && savedIndex !== -1 && index > savedIndex;
              return (
                <div className="row" key={episode.id}>
                  <div className="row-main">
                    <div className="row-title">
                      {title} {isNew && <span className="badge badge-accent">New</span>}
                    </div>
                    {episode.title !== title && <div className="row-sub">{episode.title}</div>}
                  </div>
                  <div className="row-actions">
                    {isDownloaded && <span className="badge badge-done">Downloaded</span>}
                    <Link
                      className="btn btn-sm"
                      to={withProvider(
                        `/anime/watch/${episode.id}?lang=${lang}&title=${encodeURIComponent(title)}&animeId=${encodeURIComponent(id)}&series=${encodeURIComponent(anime.title)}`,
                        provider,
                      )}
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
