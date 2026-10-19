import type { Context } from "hono";
import { statSync } from "node:fs";

export function mimeFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "mp4":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "mkv":
      return "video/x-matroska";
    case "cbz":
      return "application/vnd.comicbook+zip";
    case "zip":
      return "application/zip";
    case "vtt":
      return "text/vtt; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

export function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export function serveFile(c: Context, path: string, opts: { downloadName?: string; type?: string } = {}): Response {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return c.json({ error: "File missing" }, 404);
  }

  const headers: Record<string, string> = {
    "Content-Type": opts.type || mimeFor(path),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  };
  if (opts.downloadName) headers["Content-Disposition"] = contentDisposition(opts.downloadName);

  const range = c.req.header("range");
  if (range) {
    const match = range.match(/^bytes=(\d*)-(\d*)$/);
    if (match) {
      let start = match[1] ? Number(match[1]) : 0;
      let end = match[2] ? Number(match[2]) : size - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
        return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
      }
      if (!match[1] && match[2]) {
        start = Math.max(0, size - Number(match[2]));
        end = size - 1;
      }
      end = Math.min(end, size - 1);
      headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
      headers["Content-Length"] = String(end - start + 1);
      return new Response(Bun.file(path).slice(start, end + 1), { status: 206, headers });
    }
  }

  headers["Content-Length"] = String(size);
  return new Response(Bun.file(path), { status: 200, headers });
}
