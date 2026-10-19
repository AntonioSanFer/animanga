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
- [x] "Continue watching/reading" as horizontal scrollable + expandable rail on Manga/Anime screens (Home tab removed; `/` renders Manga).
- [x] "Recent activity" as second rail per screen.
- [x] Back nav button on main manga/anime screens.
- [x] Infinite scroll on Manga/Anime browse tabs (`useInfiniteQuery` + IntersectionObserver sentinel + "Load more" fallback; paged `/manga/popular`, `/anime/popular`).

## Phase 3 — Browse rails, covers, filters (2026-10-19)
- [x] Covers on Continue/Recent rails: Reader/Watch fetch series detail (cached 600s server-side) and save its cover in `saveProgress`; null covers keep placeholder.
- [x] Image-only rail cards: `ShelfCard` renders cover link only (title attr + alt kept); NEW badge overlays top-left; fixed 3/4 aspect.
- [x] Search bar above shelves on Manga/Anime pages (order: back-row, h1, toolbar, shelves, grid).
- [x] `FiltersButton` (`<details>` dropdown like `ProviderPicker`) right of Search; language moved inside manga panel.
  - Manga (MangaDex): status (ongoing/completed/hiatus/cancelled), sort (relevance/followedCount/latestUploadedChapter/rating), demographic (shounen/shoujo/josei/seinen) — allowlisted server-side, threaded through registry + source fns.
  - Anime (HiAnime `/filter`, verified via fetched form): type (tv/movie/ova/ona/special/music), status (completed/releasing/not_yet_aired), sort (10 verified values). Skipped: rating/season/language/dates/genre (params visible but mapping unverified).
- [x] `bun run typecheck` + `bun test` + `bun run build` green.

## Runtime download concurrency
- [x] Admin-configurable `concurrent_downloads` (settings table + `GET`/`PATCH /api/admin/settings`, clamp 1-10, `pump()` on update); env `MAX_CONCURRENT_DOWNLOADS` remains the default.

## Wave — MangaFire fourth manga provider (2026-10-19)
- [x] `src/server/sources/mangafire.ts`: JSON API `/api/titles` + `/api/titles/{hid}/chapters` + `/api/chapters/{id}` with ported Keiyoushi `VrfSigner` (pure table-XOR, no browser); filters mapped (status→`statuses[]`, sort→`order[]`, demographic→`genres_in[]` ids; lang allowlisted, scopes chapters).
- [x] IDs `mf-<hid>` / `mf-<hid>-<chapterId>`; `isMangaFireId`/`isMangaId` in `util.ts`; mirrored every `isMangaPillId` site (`api.ts` cover + page image, `downloads.ts` zip/download/name); `MANGAFIRE_BASE` const (env `MANGAFIRE_BASE_URL`); registry appends MangaFire LAST.
- [x] Live-verified: "one piece" search→One Piece (mf-dkw), get (1997/ongoing/Oda), 2443 chapters, Ch.1196 official (17 pages), cover + page-0 resolve 200; no CAPTCHA hit from server IP (plain fetch + VRF suffices, no Playwright); `bun run typecheck` + `bun test` (29 pass) green.

## Wave — MangaPill third manga provider (2026-10-19)
- [x] `src/server/sources/mangapill.ts`: search/popular via `/search` (q/status/genre/page, verified live, 50/page), series page (`/manga/<id>`, slug optional), chapter list on series page, chapter images (`img.js-page[data-src]`); filters mapped (status publishing/finished/on hiatus/discontinued, demographic→genre Shounen/Shoujo/Josei/Seinen; sort ignored — no site param; lang ignored — EN-only).
- [x] IDs `mp-<seriesId>` / `mp-<seriesId>-<chapterId>`; `isMangaPillId`/`isMangaId` in `util.ts`; mirrored every `isWeebCentralId` site (`api.ts` cover + page image, `downloads.ts` zip/download/name) so `isMangaId` guards cover it; `SAFE_URL` in `bits.tsx` already accepts `[A-Za-z0-9:_-]` (no change needed). Covers/pages resolve server-side with assertPublicHttpsUrl+assertResolvesPublic, no open proxy.
- [x] `MANGAPILL_BASE` const (env `MANGAPILL_BASE_URL`) at top of module; registry appends MangaPill after WeebCentral.
- [x] Live-verified: "one piece" search→One Piece (mp-2), get (1997/ongoing), 1212 chapters (Ch.1–1196), Ch.1196 (17 pages), cover + page-0 CDN URLs resolve; `bun run typecheck` + `bun test` (26 pass) green.

## Wave — WeebCentral second manga provider (2026-10-19)
- [x] `src/server/sources/weebcentral.ts`: search/popular via `/search/data` (limit/offset, verified live), series page, full-chapter-list, chapter images endpoint; filters mapped (status Ongoing/Complete/Hiatus/Canceled, sort Best Match/Subscribers/Latest Updates/Popularity; demographic ignored — no site equivalent; lang ignored — site is EN-only).
- [x] IDs `wc-<ULID>`; `isWeebCentralId`/`isMangaId` in `util.ts`; guards in `api.ts` (favourites/downloads/chapter/manga/img) + `SAFE_URL` in `bits.tsx` accept both; MangaDex UUID path unchanged. Covers/pages resolve server-side (`/api/img/manga/wc-…/cover`, `/api/img/page/wc-…/i`) with assertPublicHttpsUrl+assertResolvesPublic, no open proxy.
- [x] `WEEBCENTRAL_BASE` const (env `WEEBCENTRAL_BASE_URL`) at top of module; registry appends WeebCentral after MangaDex; `/manga/popular` now goes through provider fallback so `?provider=weebcentral` works on browse.
- [x] Live-verified: One Piece search/get/1196 chapters/ch.1196 (17 pages); `bun run typecheck` + `bun test` (24 pass) green.

## Wave — AllAnime second anime provider (2026-10-19): BLOCKED
- [ ] Search/episodes/details work via GraphQL (`api.mkissa.net`/`api.allanime.day`), but stream resolution returns `AA_CRYPTO_MISSING` — current protocol needs a browser-bound `aaReq` signer (AES-GCM, rotating epoch, lane binding) that can't be replicated with plain fetch. Unblocks if AllAnime ships a stable server-side path or a maintained self-hosted signer appears. Tree untouched.

## Wave — AnimePahe second anime provider (2026-10-19): BLOCKED
- [ ] No reachable site API: `animepahe.ru`/`.su` parked, `.li`/`.im` WordPress clones, `.pk` hijacked, official `.pw` behind edge Cloudflare challenge on every path; `kwik.si` parked, `kwik.cx` 403. Re-probe domains before any future attempt. Tree untouched.

## Wave — Anitaku/Gogoanime second anime provider (2026-10-19): BLOCKED
- [ ] 15 hosts probed with plain fetch from server (Bun runtime): only `gogoanime.me` serves search/category/episode HTML (One Piece → 1158 eps, movie_id 171), but its `/embed/` 302s to `animesource.me` which Bun cannot TLS-verify (`unable to verify the first certificate`) and whose JSON API returns `Invalid animeEpisodeId` even for its own player's URL format (`/watch/one-piece-100/1158.json`, `/watch/naruto-677/1.json`, `?ep=`/encoded/Referer variants all fail); classic `ajax.gogocdn.net`/`gogocdn.net` hang at TCP (curl 28 too); `anitaku.bz` fails Bun TLS (`unable to get local issuer certificate`, curl OK → Bun-chain incompatibility); rest parked/challenged/fake (`anitaku.so` JS shell, `anitaku.site` wrong site, `gogoanime.la` DNS dead, `gogoanime.fi` fake clone, `gogoanime.com.co` 403, `gogoanime.sk`/`gogoanime.io` parked, `anitaku.io` WP aggregator w/o working search, `anitaku.pe`/`gogoanime.gg/.vu` challenge/timeout). Two independent gates (TLS + broken stream API) — no code fix without disabling TLS verification. Re-probe mirrors before any future attempt. Tree untouched.

## Ops
- [x] `bun run typecheck` + `bun test` + `bun run build` green.
- [ ] Commit + push (new version upload).
- [x] Intensive security review (after implementation).

## Security follow-ups (from 2026-10-19 review, deferred as pre-existing/bigger scope)
- [ ] Scope `downloads` table per user (`email` column + `WHERE email = ?` on list/file/lookup) + per-user quota — any logged-in user can currently list/fetch others' downloads; "download all" amplifies queue/disk abuse.
- [ ] Re-enforce img-proxy host allowlist on every redirect hop; `assertPublicHttpsUrl` in `fetchBytes` (downloads.ts); base-dir check in `serveFile` (files.ts).
- [ ] Generic 500 handler (don't leak `err.message`); `Cover` src allowlist; provider-id allowlist in `useProvider`; skip-cache or cap for search cache keys.
