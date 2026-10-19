import { useEffect, type ReactNode } from "react";
import type { UserStatus } from "../shared/types";
import { ApiError, isRecord, useMe } from "./api";
import { AdminPage } from "./Admin";
import { AnimeDetailPage } from "./AnimeDetail";
import { Login, Pending } from "./Accounts";
import { signOutAndReload } from "./auth";
import { BrowseAnimePage, BrowseMangaPage } from "./Browse";
import { DownloadsPage } from "./Downloads";
import { FavouritesPage } from "./Favourites";
import { MangaDetailPage } from "./MangaDetail";
import { ReaderPage } from "./Reader";
import { Link, navigate, useLocation } from "./router";
import { ErrorView, Loading } from "./ui";
import { WatchPage } from "./Watch";

type Route =
  | { name: "redirect" }
  | { name: "browse-manga" }
  | { name: "browse-anime" }
  | { name: "manga"; id: string }
  | { name: "reader"; id: string }
  | { name: "anime"; id: string }
  | { name: "watch"; id: string }
  | { name: "favourites" }
  | { name: "downloads" }
  | { name: "admin" }
  | { name: "notfound" };

function matchRoute(pathname: string): Route {
  const parts = pathname.split("/").filter(Boolean);
  const [first, second, third] = parts;

  if (parts.length === 0) return { name: "redirect" };

  if (first === "manga") {
    if (parts.length === 1) return { name: "browse-manga" };
    if (second === "chapter") {
      return third && parts.length === 3 ? { name: "reader", id: third } : { name: "notfound" };
    }
    if (second && parts.length === 2) return { name: "manga", id: second };
  }

  if (first === "anime") {
    if (parts.length === 1) return { name: "browse-anime" };
    if (second === "watch") {
      return third && parts.length === 3 ? { name: "watch", id: third } : { name: "notfound" };
    }
    if (second && parts.length === 2) return { name: "anime", id: second };
  }

  if (parts.length === 1) {
    if (first === "favourites") return { name: "favourites" };
    if (first === "downloads") return { name: "downloads" };
    if (first === "admin") return { name: "admin" };
  }

  return { name: "notfound" };
}

function pendingStatus(error: ApiError): UserStatus {
  if (isRecord(error.data)) {
    const status = error.data.status;
    if (status === "pending" || status === "blocked") return status;
  }
  return "pending";
}

function Redirect() {
  useEffect(() => {
    navigate("/manga", true);
  }, []);
  return <Loading fullPage label="Redirecting…" />;
}

function NotFound() {
  return (
    <div className="state">
      <h2>Page not found</h2>
      <p>
        <Link to="/manga">Go to manga</Link> or <Link to="/anime">anime</Link>.
      </p>
    </div>
  );
}

function renderPage(route: Route): ReactNode {
  switch (route.name) {
    case "browse-manga":
      return <BrowseMangaPage />;
    case "browse-anime":
      return <BrowseAnimePage />;
    case "manga":
      return <MangaDetailPage id={route.id} />;
    case "anime":
      return <AnimeDetailPage id={route.id} />;
    case "favourites":
      return <FavouritesPage />;
    case "downloads":
      return <DownloadsPage />;
    case "admin":
      return <AdminPage />;
    case "notfound":
      return <NotFound />;
    default:
      return null;
  }
}

function Shell({
  email,
  isAdmin,
  pathname,
  children,
}: {
  email: string;
  isAdmin: boolean;
  pathname: string;
  children: ReactNode;
}) {
  const mangaActive = pathname === "/manga" || pathname.startsWith("/manga/");
  const animeActive = pathname === "/anime" || pathname.startsWith("/anime/");

  return (
    <>
      <header className="site-header">
        <div className="container header-inner">
          <Link to="/manga" className="brand">
            AniManga
          </Link>
          <nav className="nav" aria-label="Main">
            <Link to="/manga" aria-current={mangaActive ? "page" : undefined}>
              Manga
            </Link>
            <Link to="/anime" aria-current={animeActive ? "page" : undefined}>
              Anime
            </Link>
            <Link to="/favourites" aria-current={pathname === "/favourites" ? "page" : undefined}>
              Favourites
            </Link>
            <Link to="/downloads" aria-current={pathname === "/downloads" ? "page" : undefined}>
              Downloads
            </Link>
            {isAdmin && (
              <Link to="/admin" aria-current={pathname === "/admin" ? "page" : undefined}>
                Admin
              </Link>
            )}
          </nav>
          <div className="user-box">
            <span className="user-email" title={email}>
              {email}
            </span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                void signOutAndReload();
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="main">
        <div className="container">{children}</div>
      </main>
      <footer className="site-footer">
        <div className="container">Manga data provided by MangaDex.</div>
      </footer>
    </>
  );
}

export default function App() {
  const location = useLocation();
  const me = useMe();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);

  if (me.isPending) return <Loading fullPage label="Loading AniManga…" />;

  if (me.isError) {
    const error = me.error;
    if (error instanceof ApiError && error.status === 401) return <Login />;
    if (error instanceof ApiError && error.status === 403) {
      return <Pending status={pendingStatus(error)} reason={error.message} />;
    }
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="brand">AniManga</div>
          <h1>Could not load</h1>
          <ErrorView error={error} onRetry={() => me.refetch()} />
          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={() => {
              void signOutAndReload();
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  const { appUser, user } = me.data;
  if (appUser.status !== "active") return <Pending email={user.email} status={appUser.status} />;

  const queryIndex = location.indexOf("?");
  const pathname = queryIndex === -1 ? location : location.slice(0, queryIndex);
  const search = queryIndex === -1 ? "" : location.slice(queryIndex + 1);
  const route = matchRoute(pathname);

  if (route.name === "redirect") return <Redirect />;
  if (route.name === "reader") return <ReaderPage chapterId={route.id} />;
  if (route.name === "watch") return <WatchPage episodeId={route.id} search={search} />;

  return (
    <Shell email={user.email} isAdmin={appUser.role === "admin"} pathname={pathname}>
      {renderPage(route)}
    </Shell>
  );
}
