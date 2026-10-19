import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { AnimeSummary, Episode } from "../shared/types";
import { request, withProvider, type ItemsResponse } from "./api";
import { ProviderPicker, saveProgress, setSeenTotal } from "./bits";
import { navigate } from "./router";
import { IconArrowLeft } from "./ui";

export function WatchPage({ episodeId, search }: { episodeId: string; search: string }) {
  const params = new URLSearchParams(search);
  const lang = params.get("lang") === "dub" ? "dub" : "sub";
  const provider = params.get("provider") ?? "";
  const title = params.get("title")?.trim() || "Episode";
  const animeId = params.get("animeId") ?? "";
  const series = params.get("series")?.trim() || "Anime";
  const [failed, setFailed] = useState(false);

  const episodes = useQuery({
    queryKey: ["watch", "siblings", animeId, provider],
    queryFn: () =>
      request<ItemsResponse<Episode>>(withProvider(`/api/anime/${encodeURIComponent(animeId)}/episodes`, provider)),
    enabled: animeId !== "",
    staleTime: 300_000,
  });
  const list = episodes.data?.items ?? [];
  const index = list.findIndex((episode) => episode.id === episodeId);
  const prev = index > 0 ? list[index - 1] : null;
  const next = index !== -1 && index < list.length - 1 ? list[index + 1] : null;

  const stream = withProvider(`/api/anime/stream/${episodeId}?lang=${lang}`, provider);

  // ponytail: one extra cached (600s) request so Continue rail cards have covers.
  const anime = useQuery({
    queryKey: ["watch", "cover", animeId, provider],
    queryFn: () => request<AnimeSummary>(withProvider(`/api/anime/${encodeURIComponent(animeId)}`, provider)),
    enabled: animeId !== "",
    staleTime: 600_000,
  });

  useEffect(() => {
    if (!animeId) return;
    const base = `/anime/watch/${episodeId}?lang=${lang}&title=${encodeURIComponent(title)}&animeId=${encodeURIComponent(animeId)}&series=${encodeURIComponent(series)}`;
    saveProgress({
      kind: "anime",
      seriesId: animeId,
      seriesTitle: series,
      cover: anime.data?.cover ?? null,
      itemId: episodeId,
      label: title,
      lang,
      url: withProvider(base, provider),
    });
    if (list.length > 0) setSeenTotal("anime", animeId, list.length);
  }, [animeId, episodeId, lang, list.length, provider, series, title, anime.data?.cover]);

  function watch(id: string, epTitle: string) {
    const base = `/anime/watch/${id}?lang=${lang}&title=${encodeURIComponent(epTitle)}&animeId=${encodeURIComponent(animeId)}&series=${encodeURIComponent(series)}`;
    navigate(withProvider(base, provider));
  }

  function back() {
    const state: unknown = window.history.state;
    if (typeof state === "object" && state !== null && "animanga" in state) window.history.back();
    else navigate(animeId ? `/anime/${animeId}` : "/anime");
  }

  return (
    <div className="watch-page">
      <div className="watch-bar">
        <button type="button" className="btn btn-sm btn-ghost" onClick={back}>
          <IconArrowLeft />
          Back
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          disabled={!prev}
          onClick={() => prev && watch(prev.id, `Episode ${prev.number}`)}
        >
          ← Prev
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          disabled={!next}
          onClick={() => next && watch(next.id, `Episode ${next.number}`)}
        >
          Next →
        </button>
        <span className="title">{title}</span>
        <span className="badge">{lang === "dub" ? "Dub" : "Sub"}</span>
        <ProviderPicker
          kind="anime"
          value={provider}
          onChange={(nextProvider) => {
            const base = `/anime/watch/${episodeId}?lang=${lang}&title=${encodeURIComponent(title)}&animeId=${encodeURIComponent(animeId)}&series=${encodeURIComponent(series)}`;
            navigate(withProvider(base, nextProvider));
          }}
        />
        <a
          className="btn btn-sm"
          href={`${stream}&download=1&name=${encodeURIComponent(title)}`}
        >
          Save to device
        </a>
      </div>

      <div className="watch-body">
        <video key={`${episodeId}-${lang}-${provider}`} controls playsInline preload="metadata" onError={() => setFailed(true)}>
          <source src={stream} />
          {lang === "sub" && (
            <track
              kind="subtitles"
              label="English"
              srcLang="en"
              src={withProvider(`/api/anime/subtitle/${episodeId}?lang=${lang}`, provider)}
              default
            />
          )}
        </video>
        {failed && (
          <p className="form-error" role="alert">
            The stream could not be loaded. It may be unavailable or still being prepared.
          </p>
        )}
      </div>
    </div>
  );
}
