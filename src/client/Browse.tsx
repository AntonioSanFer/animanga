import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { AnimeSummary, MangaSummary } from "../shared/types";
import {
  MANGA_LANGS,
  request,
  useMangaLang,
  useProvider,
  withProvider,
  type ItemsResponse,
  type SearchResponse,
} from "./api";
import { BackButton, FiltersButton, ProviderPicker, getActivity, getAllProgress, hasProgress, isNewCount, safeEntryUrl } from "./bits";
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
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("");
  const [demographic, setDemographic] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  // ponytail: tag ids are provider-specific — Auto falls back to the main provider's list; switching provider resets tags.
  const tagProvider = provider || "mangadex";
  const tagList = useQuery({
    queryKey: ["manga-tags", tagProvider],
    queryFn: () =>
      request<{ items: { id: string; label: string }[] }>(
        `/api/manga/tags?provider=${encodeURIComponent(tagProvider)}`,
      ),
    staleTime: 24 * 3600 * 1000,
  });
  const search = query.trim();
  const activeFilters = [status, sort, demographic].filter(Boolean).length + tags.length;

  const result = useInfiniteQuery({
    queryKey: ["manga", "browse", lang, search, provider, status, sort, demographic, tags.join(",")],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ lang, page: String(pageParam) });
      if (search) params.set("q", search);
      if (status) params.set("status", status);
      if (sort) params.set("sort", sort);
      if (demographic) params.set("demographic", demographic);
      if (tags.length > 0) params.set("tags", tags.join(","));
      return request<SearchResponse>(
        withProvider(`/api/manga/${search ? "search" : "popular"}?${params}`, provider),
      );
    },
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
        <FiltersButton active={activeFilters}>
          <label className="filter-field">
            <span className="muted">Language</span>
            <select className="select" value={lang} onChange={(event) => setLang(event.target.value)}>
              {MANGA_LANGS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span className="muted">Status</span>
            <select className="select" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">All</option>
              <option value="ongoing">Ongoing</option>
              <option value="completed">Completed</option>
              <option value="hiatus">Hiatus</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
          <label className="filter-field">
            <span className="muted">Sort</span>
            <select className="select" value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="">Default</option>
              <option value="relevance">Relevance</option>
              <option value="followedCount">Most followed</option>
              <option value="latestUploadedChapter">Latest chapter</option>
              <option value="rating">Rating</option>
            </select>
          </label>
          <label className="filter-field">
            <span className="muted">Demographic</span>
            <select className="select" value={demographic} onChange={(event) => setDemographic(event.target.value)}>
              <option value="">All</option>
              <option value="shounen">Shounen</option>
              <option value="shoujo">Shoujo</option>
              <option value="josei">Josei</option>
              <option value="seinen">Seinen</option>
            </select>
          </label>
          {tagList.data && tagList.data.items.length > 0 && (
            <div className="filter-field">
              <span className="muted">
                Tags{tags.length > 0 ? ` (${tags.length})` : ""}
              </span>
              <div className="tag-chips" role="group" aria-label="Tags">
                {tagList.data.items.map((tag) => {
                  const on = tags.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      aria-pressed={on}
                      className={on ? "tag-chip active" : "tag-chip"}
                      onClick={() =>
                        setTags((prev) => (on ? prev.filter((id) => id !== tag.id) : [...prev, tag.id]))
                      }
                    >
                      {tag.label}
                    </button>
                  );
                })}
              </div>
              {tags.length > 0 && (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setTags([])}>
                  Clear tags
                </button>
              )}
            </div>
          )}
        </FiltersButton>
        <ProviderPicker
          kind="manga"
          value={provider}
          onChange={(next) => {
            setProvider(next);
            setTags([]);
          }}
        />
      </form>
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
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("");
  const search = query.trim();
  const activeFilters = [type, status, sort].filter(Boolean).length;

  const result = useInfiniteQuery({
    queryKey: ["anime", "browse", search, provider, type, status, sort],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ page: String(pageParam) });
      if (search) params.set("q", search);
      if (type) params.set("type", type);
      if (status) params.set("status", status);
      if (sort) params.set("sort", sort);
      return request<ItemsResponse<AnimeSummary>>(
        withProvider(`/api/anime/${search || activeFilters > 0 ? "search" : "popular"}?${params}`, provider),
      );
    },
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
        <FiltersButton active={activeFilters}>
          <label className="filter-field">
            <span className="muted">Type</span>
            <select className="select" value={type} onChange={(event) => setType(event.target.value)}>
              <option value="">All</option>
              <option value="tv">TV</option>
              <option value="movie">Movie</option>
              <option value="ova">OVA</option>
              <option value="ona">ONA</option>
              <option value="special">Special</option>
              <option value="music">Music</option>
            </select>
          </label>
          <label className="filter-field">
            <span className="muted">Status</span>
            <select className="select" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">All</option>
              <option value="completed">Finished airing</option>
              <option value="releasing">Currently airing</option>
              <option value="not_yet_aired">Not yet aired</option>
            </select>
          </label>
          <label className="filter-field">
            <span className="muted">Sort</span>
            <select className="select" value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="">Default</option>
              <option value="trending">Trending</option>
              <option value="most_viewed">Most watched</option>
              <option value="most_followed">Most followed</option>
              <option value="avg_score">Score</option>
              <option value="mal_score">MAL score</option>
              <option value="release_date">Release date</option>
              <option value="updated_date">Recently updated</option>
              <option value="added_date">Recently added</option>
              <option value="title_az">Name A-Z</option>
              <option value="episode_count">Episodes</option>
            </select>
          </label>
        </FiltersButton>
        <ProviderPicker kind="anime" value={provider} onChange={setProvider} />
      </form>
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

function ShelfCard({ url, cover, title, isNew }: { url: string; cover: string | null; title: string; isNew: boolean }) {
  return (
    <div className="rail-card">
      <Link to={url} className="card" title={title}>
        <Cover src={cover} alt={`Cover of ${title}`} />
        {isNew && <span className="badge badge-accent">New</span>}
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
                isNew={isNewCount(kind, entry.seriesId, totals.data?.[entry.seriesId])}
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
                isNew={false}
              />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
