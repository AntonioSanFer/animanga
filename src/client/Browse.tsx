import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import type { AnimeSummary, MangaSummary } from "../shared/types";
import {
  MANGA_LANGS,
  formatDate,
  request,
  useMangaLang,
  useProvider,
  withProvider,
  type ItemsResponse,
  type SearchResponse,
} from "./api";
import { BackButton, ProviderPicker, getActivity, getAllProgress, hasProgress, isNewCount, safeEntryUrl } from "./bits";
import { Link } from "./router";
import { Cover, Empty, ErrorView, IconSearch, Loading } from "./ui";

export function MangaCard({ manga }: { manga: MangaSummary }) {
  const meta = [manga.year, manga.status].filter(Boolean).join(" · ");
  return (
    <Link to={`/manga/${manga.id}`} className="card">
      <Cover src={manga.cover} alt={`Cover of ${manga.title}`} />
      <span className="card-title">{manga.title}</span>
      <span className="card-meta">{meta || "Manga"}</span>
      {hasProgress("manga", manga.id) && <span className="badge badge-accent">Continue</span>}
    </Link>
  );
}

export function AnimeCard({ anime }: { anime: AnimeSummary }) {
  const meta = [anime.type, anime.duration].filter(Boolean).join(" · ");
  return (
    <Link to={`/anime/${anime.id}`} className="card">
      <Cover src={anime.cover} alt={`Cover of ${anime.title}`} />
      <span className="card-title">{anime.title}</span>
      <span className="card-meta">{meta || "Anime"}</span>
      {hasProgress("anime", anime.id) && <span className="badge badge-accent">Continue</span>}
    </Link>
  );
}

export function BrowseMangaPage() {
  const [lang, setLang] = useMangaLang();
  const [provider, setProvider] = useProvider("manga");
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const search = query.trim();

  const result = useQuery({
    queryKey: ["manga", "browse", lang, search, page, provider],
    queryFn: () =>
      search
        ? request<SearchResponse>(
            withProvider(
              `/api/manga/search?${new URLSearchParams({ q: search, lang, page: String(page) }).toString()}`,
              provider,
            ),
          )
        : request<ItemsResponse<MangaSummary>>(`/api/manga/popular?lang=${encodeURIComponent(lang)}`),
  });

  const items = result.data?.items ?? [];
  const total =
    result.data && "total" in result.data && typeof result.data.total === "number" ? result.data.total : null;
  const pages = total === null ? 1 : Math.max(1, Math.ceil(total / 30));

  function submit(event: FormEvent) {
    event.preventDefault();
    setQuery(input);
    setPage(1);
  }

  return (
    <>
      <div className="back-row">
        <BackButton to="/" />
      </div>
      <h1>Manga</h1>
      <form className="toolbar" role="search" onSubmit={submit}>
        <label className="search-box">
          <IconSearch />
          <span className="sr-only">Search manga</span>
          <input
            className="input"
            type="search"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Search manga…"
          />
        </label>
        <button type="submit" className="btn btn-primary">
          Search
        </button>
        <ProviderPicker
          kind="manga"
          value={provider}
          onChange={(next) => {
            setProvider(next);
            setPage(1);
          }}
        />
        <label className="lang-select">
          <span className="muted">Language</span>
          <select
            className="select"
            value={lang}
            onChange={(event) => {
              setLang(event.target.value);
              setPage(1);
            }}
          >
            {MANGA_LANGS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </form>

      {result.isPending && <Loading />}
      {result.isError && <ErrorView error={result.error} onRetry={() => result.refetch()} />}
      {result.isSuccess && items.length === 0 && (
        <Empty>No manga found{search ? ` for “${search}”` : ""}. Try another search or language.</Empty>
      )}
      {items.length > 0 && (
        <>
          <div className="grid">
            {items.map((manga) => (
              <MangaCard key={manga.id} manga={manga} />
            ))}
          </div>
          {search && total !== null && (
            <div className="pager">
              <button
                type="button"
                className="btn btn-sm"
                disabled={page <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                Previous
              </button>
              <span className="muted">
                Page {page} of {pages}
              </span>
              <button
                type="button"
                className="btn btn-sm"
                disabled={page >= pages}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}

export function BrowseAnimePage() {
  const [provider, setProvider] = useProvider("anime");
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const search = query.trim();

  const result = useQuery({
    queryKey: ["anime", "browse", search, provider],
    queryFn: () =>
      search
        ? request<ItemsResponse<AnimeSummary>>(
            withProvider(`/api/anime/search?q=${encodeURIComponent(search)}&page=1`, provider),
          )
        : request<ItemsResponse<AnimeSummary>>("/api/anime/popular"),
  });

  const items = result.data?.items ?? [];

  function submit(event: FormEvent) {
    event.preventDefault();
    setQuery(input);
  }

  return (
    <>
      <div className="back-row">
        <BackButton to="/" />
      </div>
      <h1>Anime</h1>
      <form className="toolbar" role="search" onSubmit={submit}>
        <label className="search-box">
          <IconSearch />
          <span className="sr-only">Search anime</span>
          <input
            className="input"
            type="search"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Search anime…"
          />
        </label>
        <button type="submit" className="btn btn-primary">
          Search
        </button>
        <ProviderPicker kind="anime" value={provider} onChange={setProvider} />
      </form>

      {result.isPending && <Loading />}
      {result.isError && <ErrorView error={result.error} onRetry={() => result.refetch()} />}
      {result.isSuccess && items.length === 0 && (
        <Empty>No anime found{search ? ` for “${search}”` : ""}.</Empty>
      )}
      {items.length > 0 && (
        <div className="grid">
          {items.map((anime) => (
            <AnimeCard key={anime.id} anime={anime} />
          ))}
        </div>
      )}
    </>
  );
}

export function HomePage() {
  const [lang] = useMangaLang();
  const [mangaProvider] = useProvider("manga");
  const [animeProvider] = useProvider("anime");
  // ponytail: remounts on each visit, so a plain memo read is fresh enough.
  const progress = useMemo(() => getAllProgress().slice(0, 12), []);
  const activity = useMemo(() => getActivity().slice(0, 10), []);

  const totals = useQuery({
    queryKey: ["home-new", lang, progress.map((entry) => `${entry.kind}:${entry.seriesId}`).join(",")],
    queryFn: async () => {
      const out: Record<string, number> = {};
      await Promise.all(
        progress.map(async (entry) => {
          try {
            if (entry.kind === "manga") {
              const res = await request<ItemsResponse<{ id: string }>>(
                withProvider(
                  `/api/manga/${encodeURIComponent(entry.seriesId)}/chapters?lang=${encodeURIComponent(lang)}`,
                  mangaProvider,
                ),
              );
              out[`${entry.kind}:${entry.seriesId}`] = res.items.length;
            } else {
              const res = await request<ItemsResponse<{ id: string }>>(
                withProvider(`/api/anime/${encodeURIComponent(entry.seriesId)}/episodes`, animeProvider),
              );
              out[`${entry.kind}:${entry.seriesId}`] = res.items.length;
            }
          } catch {
            // offline item — no NEW badge
          }
        }),
      );
      return out;
    },
  });

  return (
    <>
      <h1>Home</h1>
      <section className="section">
        <div className="section-head">
          <h2>Continue watching / reading</h2>
        </div>
        {progress.length === 0 && <Empty>Nothing in progress yet. Open a chapter or episode to resume it here.</Empty>}
        {progress.length > 0 && (
          <div className="list">
            {progress.map((entry) => (
              <div className="row" key={`${entry.kind}:${entry.seriesId}`}>
                <div className="row-main">
                  <div className="row-title">
                    {entry.seriesTitle}{" "}
                    {isNewCount(
                      entry.kind,
                      entry.seriesId,
                      totals.data?.[`${entry.kind}:${entry.seriesId}`],
                    ) && <span className="badge badge-accent">New</span>}
                  </div>
                  <div className="row-sub">
                    {entry.label} · {formatDate(entry.time)}
                  </div>
                </div>
                <div className="row-actions">
                  <Link className="btn btn-sm" to={safeEntryUrl(entry.url)}>
                    Resume
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="section">
        <div className="section-head">
          <h2>Recent activity</h2>
        </div>
        {activity.length === 0 && <Empty>No recent activity.</Empty>}
        {activity.length > 0 && (
          <div className="list">
            {activity.map((item, index) => (
              <div className="row" key={`${item.kind}:${item.itemId}:${index}`}>
                <div className="row-main">
                  <div className="row-title">{item.seriesTitle}</div>
                  <div className="row-sub">
                    {item.label} · {formatDate(item.time)}
                  </div>
                </div>
                <div className="row-actions">
                  <Link className="btn btn-sm btn-ghost" to={safeEntryUrl(item.url)}>
                    Open
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
