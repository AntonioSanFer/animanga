# AniMangaBrowser — Backlog (persists across compaction)

## Phase 1 — Providers (main + fallback, seamless)
- [x] Provider abstraction: `MangaProvider` / `AnimeProvider` interface + registry; current ones (MangaDex, HiAnime) stay default/main.
- [x] Fallback chain: try main provider, auto-fall back to others on failure; surface which provider served the result.
- [x] Manual provider selector on search + watch/read screens; compact `<details>`-style dropdown (must NOT take much screen space).
- [x] "Watch latest" on manga/anime detail screen (jump to latest chapter/episode).
- [x] Season/volume (tome) selector wherever the provider exposes it. (Manga: volume `<select>` from chapter `volume` field. Anime: skipped — HiAnime episode data has no season field.)

## Phase 2 — Downloads, progress, home sections
- [x] "Download all" button for series / season / volume / tome (manga chapters + anime episodes).
- [x] Prev/next chapter-episode buttons on Reader + Watch screens.
- [x] Remember last chapter/episode per series + "Continue reading/watching" resume button. (localStorage, no DB.)
- [x] "New chapter available" badge on series card/main screen when new content lands after completion.
- [x] "Continue watching/reading" section (unfinished + series with new chapters).
- [x] "Recent activity" section on main tab.
- [x] Back nav button on main manga/anime screens.

## Ops
- [x] `bun run typecheck` + `bun test` + `bun run build` green.
- [ ] Commit + push (new version upload).
- [x] Intensive security review (after implementation).

## Security follow-ups (from 2026-10-19 review, deferred as pre-existing/bigger scope)
- [ ] Scope `downloads` table per user (`email` column + `WHERE email = ?` on list/file/lookup) + per-user quota — any logged-in user can currently list/fetch others' downloads; "download all" amplifies queue/disk abuse.
- [ ] Re-enforce img-proxy host allowlist on every redirect hop; `assertPublicHttpsUrl` in `fetchBytes` (downloads.ts); base-dir check in `serveFile` (files.ts).
- [ ] Generic 500 handler (don't leak `err.message`); `Cover` src allowlist; provider-id allowlist in `useProvider`; skip-cache or cap for search cache keys.
