import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import type { AnimeSummary, MangaSummary } from "../shared/types";
import {
  MANGA_LANGS,
  request,
  useMangaLang,
  type ItemsResponse,
  type SearchResponse,
} from "./api";
import { Link } from "./router";
import { Cover, Empty, ErrorView, IconSearch, Loading } from "./ui";

export function MangaCard({ manga }: { manga: MangaSummary }) {
  const meta = [manga.year, manga.status].filter(Boolean).join(" · ");
  return (
    <Link to={`/manga/${manga.id}`} className="card">
      <Cover src={manga.cover} alt={`Cover of ${manga.title}`} />
      <span className="card-title">{manga.title}</span>
      <span className="card-meta">{meta || "Manga"}</span>
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
    </Link>
  );
}

export function BrowseMangaPage() {
  const [lang, setLang] = useMangaLang();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const search = query.trim();

  const result = useQuery({
    queryKey: ["manga", "browse", lang, search, page],
    queryFn: () =>
      search
        ? request<SearchResponse>(
            `/api/manga/search?${new URLSearchParams({ q: search, lang, page: String(page) }).toString()}`,
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
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const search = query.trim();

  const result = useQuery({
    queryKey: ["anime", "browse", search],
    queryFn: () =>
      search
        ? request<ItemsResponse<AnimeSummary>>(`/api/anime/search?q=${encodeURIComponent(search)}&page=1`)
        : request<ItemsResponse<AnimeSummary>>("/api/anime/popular"),
  });

  const items = result.data?.items ?? [];

  function submit(event: FormEvent) {
    event.preventDefault();
    setQuery(input);
  }

  return (
    <>
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
