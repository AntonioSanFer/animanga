import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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

function useInfiniteSentinel(hasNext: boolean, fetching: boolean, next: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNext && !fetching) next();
      },
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNext, fetching, next]);
  return ref;
}

export function BrowseMangaPage() {
  const [lang, setLang] = useMangaLang();
  const [provider, setProvider] = useProvider("manga");
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const search = query.trim();

  const result = useInfiniteQuery({
    queryKey: ["manga", "browse", lang, search, provider],
    queryFn: ({ pageParam }) =>
      search
        ? request<SearchResponse>(
            withProvider(
              `/api/manga/search?${new URLSearchParams({ q: search, lang, page: String(pageParam) }).toString()}`,
              provider,
            ),
          )
        : request<SearchResponse>(`/api/manga/popular?lang=${encodeURIComponent(lang)}&page=${Number(pageParam)}`),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages, lastPageParam) => {
      const total = (lastPage as { total?: unknown }).total;
      if (typeof total === "number") {
        const loaded = allPages.reduce((n, p) => n + p.items.length, 0);
        return loaded < total ? (lastPageParam as number) + 1 : undefined;
      }
      return lastPage.items.length > 0 ? (lastPageParam as number) + 1 : undefined;
    },
  });

  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: MangaSummary[] = [];
    for (const page of result.data?.pages ?? []) {
      for (const manga of page.items) {
        if (seen.has(manga.id)) continue;
        seen.add(manga.id);
        out.push(manga);
      }
    }
    return out;
  }, [result.data]);
  const pages = result.data?.pages ?? [];
  const total = pages.length > 0 && typeof pages[pages.length - 1].total === "number" ? pages[pages.length - 1].total : null;
  const sentinelRef = useInfiniteSentinel(!!result.hasNextPage, result.isFetching, result.fetchNextPage);

  function submit(event: FormEvent) {
    event.preventDefault();
    setQuery(input);
  }

  return (
    <>
      <div className="back-row">
        <BackButton to="/" />
      </div>
      <h1>Manga</h1>
      <ContinueShelf
        kind="manga"
        getTotal={async (seriesId) =>
          (
            await request<ItemsResponse<{ id: string }>>(
              withProvider(
                `/api/manga/${encodeURIComponent(seriesId)}/chapters?lang=${encodeURIComponent(lang)}`,
                provider,
              ),
            )
          ).items.length
        }
      />
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
        <ProviderPicker kind="manga" value={provider} onChange={setProvider} />
        <label className="lang-select">
          <span className="muted">Language</span>
          <select
            className="select"
            value={lang}
            onChange={(event) => {
              setLang(event.target.value);
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
          <div ref={sentinelRef} aria-hidden="true" />
          {result.isFetchingNextPage && <Loading />}
          {result.hasNextPage ? (
            <div className="pager">
              <button
                type="button"
                className="btn btn-sm"
                disabled={result.isFetchingNextPage}
                onClick={() => result.fetchNextPage()}
              >
                Load more
              </button>
              {total !== null && (
                <span className="muted">
                  {items.length} of {total}
                </span>
              )}
            </div>
          ) : (
            total !== null && (
              <p className="muted">
                Showing {items.length} of {total}
              </p>
            )
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

  const result = useInfiniteQuery({
    queryKey: ["anime", "browse", search, provider],
    queryFn: ({ pageParam }) =>
      search
        ? request<ItemsResponse<AnimeSummary>>(
            withProvider(`/api/anime/search?q=${encodeURIComponent(search)}&page=${Number(pageParam)}`, provider),
          )
        : request<ItemsResponse<AnimeSummary>>(`/api/anime/popular?page=${Number(pageParam)}`),
    initialPageParam: 1,
    getNextPageParam: (lastPage, _allPages, lastPageParam) =>
      lastPage.items.length > 0 ? (lastPageParam as number) + 1 : undefined,
  });

  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: AnimeSummary[] = [];
    for (const page of result.data?.pages ?? []) {
      for (const anime of page.items) {
        if (seen.has(anime.id)) continue;
        seen.add(anime.id);
        out.push(anime);
      }
    }
    return out;
  }, [result.data]);
  const sentinelRef = useInfiniteSentinel(!!result.hasNextPage, result.isFetching, result.fetchNextPage);

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
      <ContinueShelf
        kind="anime"
        getTotal={async (seriesId) =>
          (
            await request<ItemsResponse<{ id: string }>>(
              withProvider(`/api/anime/${encodeURIComponent(seriesId)}/episodes`, provider),
            )
          ).items.length
        }
      />
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
        <>
          <div className="grid">
            {items.map((anime) => (
              <AnimeCard key={anime.id} anime={anime} />
            ))}
          </div>
          <div ref={sentinelRef} aria-hidden="true" />
          {result.isFetchingNextPage && <Loading />}
          {result.hasNextPage && (
            <div className="pager">
              <button
                type="button"
                className="btn btn-sm"
                disabled={result.isFetchingNextPage}
                onClick={() => result.fetchNextPage()}
              >
                Load more
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}

function ShelfCard({
  url,
  cover,
  title,
  sub,
  isNew,
  action,
}: {
  url: string;
  cover: string | null;
  title: string;
  sub: string;
  isNew: boolean;
  action: string;
}) {
  return (
    <div className="rail-card">
      <Link to={url} className="card">
        <Cover src={cover} alt={`Cover of ${title}`} />
        <span className="card-title">{title}</span>
        <span className="card-meta">{sub}</span>
        {isNew && <span className="badge badge-accent">New</span>}
        <span className="btn btn-sm">{action}</span>
      </Link>
    </div>
  );
}

function ContinueShelf({ kind, getTotal }: { kind: "manga" | "anime"; getTotal: (seriesId: string) => Promise<number> }) {
  const entries = useMemo(() => getAllProgress().filter((entry) => entry.kind === kind).slice(0, 12), [kind]);
  const recent = useMemo(() => getActivity().filter((entry) => entry.kind === kind).slice(0, 12), [kind]);
  const [expanded, setExpanded] = useState(false);
  const [expandedRecent, setExpandedRecent] = useState(false);

  const totals = useQuery({
    queryKey: ["shelf-new", kind, entries.map((entry) => entry.seriesId).join(",")],
    queryFn: async () => {
      const out: Record<string, number> = {};
      await Promise.all(
        entries.map(async (entry) => {
          try {
            out[entry.seriesId] = await getTotal(entry.seriesId);
          } catch {
            // offline item — no NEW badge
          }
        }),
      );
      return out;
    },
    enabled: entries.length > 0,
  });

  if (entries.length === 0 && recent.length === 0) return null;
  return (
    <>
      {entries.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Continue {kind === "manga" ? "reading" : "watching"}</h2>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setExpanded((v) => !v)}>
              {expanded ? "Collapse" : "Show all"}
            </button>
          </div>
          <div className={expanded ? "grid" : "rail"}>
            {entries.map((entry) => (
              <ShelfCard
                key={entry.seriesId}
                url={safeEntryUrl(entry.url, kind === "manga" ? "/manga" : "/anime")}
                cover={entry.cover}
                title={entry.seriesTitle}
                sub={`${entry.label} · ${formatDate(entry.time)}`}
                isNew={isNewCount(kind, entry.seriesId, totals.data?.[entry.seriesId])}
                action="Resume"
              />
            ))}
          </div>
        </section>
      )}
      {recent.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Recent activity</h2>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setExpandedRecent((v) => !v)}>
              {expandedRecent ? "Collapse" : "Show all"}
            </button>
          </div>
          <div className={expandedRecent ? "grid" : "rail"}>
            {recent.map((item, index) => (
              <ShelfCard
                key={`${item.itemId}:${index}`}
                url={safeEntryUrl(item.url, kind === "manga" ? "/manga" : "/anime")}
                cover={item.cover}
                title={item.seriesTitle}
                sub={`${item.label} · ${formatDate(item.time)}`}
                isNew={false}
                action="Open"
              />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
