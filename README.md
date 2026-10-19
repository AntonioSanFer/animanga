# AniManga

Self-hosted manga and anime browser. One Bun process serves the React frontend and the Hono API, stores users/favourites/downloads in SQLite, and proxies third-party sources.

## Features

- Manga search, details and chapter reader (MangaDex, no account required)
- Anime search, details and streaming (hianime.at)
- Per-user favourites; the server download library is shared across approved users
- Download queue: manga chapters as CBZ, anime episodes as MP4 with optional English subtitles
- Auth via generic OIDC, GitHub, Google, or email/password (local setup only)
- Admin approval flow for new users

## Quick start (Docker Compose)

```bash
cp .env.example .env
# Edit .env:
#   BETTER_AUTH_URL=http://localhost:3000 (or your public https URL)
#   BETTER_AUTH_SECRET=...              (openssl rand -hex 32)
#   OIDC_* or GITHUB_* / GOOGLE_*       (recommended)
#   or AUTH_PASSWORD_ENABLED=1 for the first run only
docker compose up -d --build
```

Open http://localhost:3000.

The container runs as uid/gid 1000 (`bun`). If Docker creates `./data` as root and the app cannot write, run:

```bash
mkdir -p data && sudo chown -R 1000:1000 data
```

On Windows and Docker Desktop, bind-mount permissions are handled automatically.

## CasaOS

Apps → `+` → Custom App / Import Compose. Use the prebuilt image (no local build needed):

```yaml
name: animanga
services:
  animanga:
    image: ghcr.io/antoniosanfer/animanga:latest
    container_name: animanga
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - BETTER_AUTH_URL=http://192.168.1.100:3000
      - AUTH_PASSWORD_ENABLED=1
    volumes:
      - /DATA/AppData/animanga:/app/data
    security_opt:
      - no-new-privileges:true
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://127.0.0.1:3000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s

x-casaos:
  architectures:
    - amd64
    - arm64
  main: animanga
  title:
    en_us: AniManga
  category: Media
  port_map: "3000"
  scheme: http
  description:
    en_us: Self-hosted manga and anime browser with favourites, offline downloads and per-user access control.
```

- Replace `BETTER_AUTH_URL` with the URL you actually open (LAN IP or reverse-proxied https URL).
- Set `AUTH_PASSWORD_ENABLED=1` for the first login, then back to `0` if you configure SSO.
- The container runs as uid 1000. If it cannot write to the volume, run:
  `sudo chown -R 1000:1000 /DATA/AppData/animanga`
- To use another host port, change both `"3000:3000"` and `port_map`, and update `BETTER_AUTH_URL`.

The repo's `docker-compose.yml` builds locally and is intended for development; CasaOS should use the image above.

If CasaOS does not create a `.env` file next to the compose file, set the variables from `.env.example` in the app's environment settings before starting.

## Authentication and first login

- The **first email that signs in becomes an active admin**.
- Every later email is created as `pending` and sees an access-pending screen until an admin approves it under **Admin → Users**.
- `AUTH_PASSWORD_ENABLED=0` disables email/password; configure SSO before first launch unless you intentionally want local password setup. Set it back to `0` afterwards.

### SSO callback URLs

Replace `BASE` with `BETTER_AUTH_URL` (no trailing slash):

| Provider | Callback URL |
| --- | --- |
| GitHub | `BASE/api/auth/callback/github` |
| Google | `BASE/api/auth/callback/google` |
| Generic OIDC | `BASE/api/auth/callback/oidc` |

## Data layout

Everything lives under `DATA_DIR` (default `./data`, `/app/data` in Docker):

| Path | Contents |
| --- | --- |
| `app.db` | SQLite database: users, favourites, download jobs, HTTP cache |
| `downloads/` | Downloaded manga CBZ and anime video/subtitle files (shared by all users) |
| `cache/images/` | Disk cache for proxied covers and reader pages (`MAX_IMAGE_CACHE_MB`) |
| `secret` | Auto-generated auth secret when `BETTER_AUTH_SECRET` is blank |

Back up the whole directory. Deleting the `secret` file invalidates existing sessions.

## Security notes

- Sign in immediately after the first launch: the first email to complete a login becomes admin.
- Keep `AUTH_PASSWORD_ENABLED=0` after initial setup and use SSO.
- Terminate TLS in front of the app (reverse proxy) and set `BETTER_AUTH_URL` to the https URL, otherwise session cookies are sent unencrypted.
- The download library is intentionally shared between approved household users; favourites and accounts are per-user.

## Local development

```bash
bun install
AUTH_PASSWORD_ENABLED=1 bun run dev
```

Open http://localhost:3000. `bun run dev` builds the frontend once, then runs the server with watch mode.

ffmpeg and yt-dlp are required locally for anime streaming and downloads (`FFMPEG_PATH`, `YTDLP_PATH`). Both are included in the Docker image.

## Notes

Manga and anime data come from third-party sources (MangaDex, hianime.at). Availability, quality and site behavior can change or break without notice. Use only for content you are allowed to access.
