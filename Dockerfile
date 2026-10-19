# syntax=docker/dockerfile:1

FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY index.html tsconfig.json ./
COPY src ./src
RUN bun run build

FROM oven/bun:1 AS runtime
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# yt-dlp ships separate standalone binaries; pick the one matching the image arch.
ARG TARGETARCH=amd64
RUN case "${TARGETARCH}" in \
      arm64) YTDLP_ASSET=yt-dlp_linux_aarch64 ;; \
      *) YTDLP_ASSET=yt-dlp_linux ;; \
    esac \
 && curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/latest/download/${YTDLP_ASSET}" -o /usr/local/bin/yt-dlp \
 && chmod +x /usr/local/bin/yt-dlp \
 && yt-dlp --version

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY --from=build /app/dist ./dist
COPY src/server ./src/server
COPY src/shared ./src/shared

RUN mkdir -p /app/data && chown -R bun:bun /app/data

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data

USER bun
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

CMD ["bun", "src/server/index.ts"]
