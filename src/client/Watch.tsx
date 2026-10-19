import { useState } from "react";
import { navigate } from "./router";
import { IconArrowLeft } from "./ui";

export function WatchPage({ episodeId, search }: { episodeId: string; search: string }) {
  const params = new URLSearchParams(search);
  const lang = params.get("lang") === "dub" ? "dub" : "sub";
  const title = params.get("title")?.trim() || "Episode";
  const [failed, setFailed] = useState(false);

  function back() {
    const state: unknown = window.history.state;
    if (typeof state === "object" && state !== null && "animanga" in state) window.history.back();
    else navigate("/anime");
  }

  return (
    <div className="watch-page">
      <div className="watch-bar">
        <button type="button" className="btn btn-sm btn-ghost" onClick={back}>
          <IconArrowLeft />
          Back
        </button>
        <span className="title">{title}</span>
        <span className="badge">{lang === "dub" ? "Dub" : "Sub"}</span>
        <a
          className="btn btn-sm"
          href={`/api/anime/stream/${episodeId}?lang=${lang}&download=1&name=${encodeURIComponent(title)}`}
        >
          Save to device
        </a>
      </div>

      <div className="watch-body">
        <video key={`${episodeId}-${lang}`} controls playsInline preload="metadata" onError={() => setFailed(true)}>
          <source src={`/api/anime/stream/${episodeId}?lang=${lang}`} />
          {lang === "sub" && (
            <track
              kind="subtitles"
              label="English"
              srcLang="en"
              src={`/api/anime/subtitle/${episodeId}?lang=${lang}`}
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
