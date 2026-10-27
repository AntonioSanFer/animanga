import { existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { zipSync } from "fflate";
import {
  DOWNLOAD_DIR,
  FFMPEG,
  MAX_ACTIVE_JOBS,
  MAX_CONCURRENT_DOWNLOADS,
  UA,
  YTDLP,
} from "./config";
import { db, getDownload, getOwnDownload, getSetting, setSetting, toDownload, type DownloadRow } from "./db";
import { getChapterImages, getChapterMeta } from "./sources/mangadex";
import { chapterDownloadName as weebChapterDownloadName, getChapterImages as weebChapterImages } from "./sources/weebcentral";
import { chapterDownloadName as pillChapterDownloadName, getChapterImages as pillChapterImages } from "./sources/mangapill";
import { chapterDownloadName as fireChapterDownloadName, getChapterImages as fireChapterImages } from "./sources/mangafire";
import { getStream } from "./sources/hianime";
import { isMangaFireId, isMangaPillId, isWeebCentralId, sanitizeFilename } from "./util";
import type { DownloadJob, Kind } from "../shared/types";

const queue: number[] = [];
const active = new Set<number>();
const procs = new Map<number, Bun.Subprocess>();
const cancels = new Map<number, AbortController>();

function patchJob(
  id: number,
  fields: { status?: DownloadJob["status"]; progress?: number; filePath?: string | null; size?: number | null; error?: string | null },
): void {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  if (fields.status !== undefined) {
    sets.push("status = ?");
    values.push(fields.status);
  }
  if (fields.progress !== undefined) {
    sets.push("progress = ?");
    values.push(Math.max(0, Math.min(100, Math.round(fields.progress))));
  }
  if (fields.filePath !== undefined) {
    sets.push("file_path = ?");
    values.push(fields.filePath);
  }
  if (fields.size !== undefined) {
    sets.push("size = ?");
    values.push(fields.size);
  }
  if (fields.error !== undefined) {
    sets.push("error = ?");
    values.push(fields.error);
  }
  sets.push("updated_at = ?");
  values.push(Date.now());
  values.push(id);
  db.query(`UPDATE downloads SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

function filePathOf(id: number): string | null {
  const row = db.query("SELECT file_path FROM downloads WHERE id = ?").get(id) as { file_path: string | null } | null;
  return row?.file_path ?? null;
}

function setProgress(id: number, progress: number): void {
  db.query("UPDATE downloads SET progress = ?, updated_at = ? WHERE id = ? AND status = 'downloading'").run(
    Math.max(0, Math.min(99, Math.round(progress))),
    Date.now(),
    id,
  );
}

export function createDownload(input: {
  kind: Kind;
  sourceId: string;
  itemId: string;
  title: string;
  label: string;
  cover: string | null;
  lang: string | null;
  email: string;
}): DownloadJob {
  const email = input.email.trim().toLowerCase();
  const own = getOwnDownload(input.kind, input.sourceId, input.itemId, input.lang, email);
  if (own) {
    const path = filePathOf(own.id);
    if (own.status === "done" && path && existsSync(path)) return own;
    if (own.status === "queued" || own.status === "downloading") return own;
    patchJob(own.id, { status: "queued", progress: 0, error: null, filePath: null, size: null });
    enqueue(own.id);
    return getDownload(own.id)!;
  }

  // ponytail: files are shared — a done copy from anyone completes your row instantly, no re-download.
  const shared = db
    .query(
      "SELECT file_path, size FROM downloads WHERE kind = ? AND item_id = ? AND lang IS ? AND status = 'done' ORDER BY id DESC LIMIT 1",
    )
    .get(input.kind, input.itemId, input.lang) as { file_path: string | null; size: number | null } | null;
  if (shared?.file_path && existsSync(shared.file_path)) {
    const now = Date.now();
    const result = db
      .query(
        `INSERT INTO downloads (kind, source_id, item_id, title, label, cover, lang, email, status, progress, file_path, size, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'done', 100, ?, ?, ?, ?)`,
      )
      .run(
        input.kind,
        input.sourceId,
        input.itemId,
        input.title,
        input.label,
        input.cover,
        input.lang,
        email,
        shared.file_path,
        shared.size,
        now,
        now,
      );
    return getDownload(Number(result.lastInsertRowid))!;
  }

  const activeCount = (db.query("SELECT COUNT(*) AS n FROM downloads WHERE status IN ('queued','downloading')").get() as { n: number }).n;
  if (activeCount >= MAX_ACTIVE_JOBS) throw new Error("The download queue is full. Try again later.");

  const now = Date.now();
  const result = db
    .query(
      `INSERT INTO downloads (kind, source_id, item_id, title, label, cover, lang, email, status, progress, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?)`,
    )
    .run(input.kind, input.sourceId, input.itemId, input.title, input.label, input.cover, input.lang, email, now, now);
  const id = Number(result.lastInsertRowid);
  enqueue(id);
  return getDownload(id)!;
}

export function enqueue(id: number): void {
  if (!queue.includes(id) && !active.has(id)) queue.push(id);
  pump();
}

export function concurrency(): number {
  const n = Number(getSetting("concurrent_downloads") ?? MAX_CONCURRENT_DOWNLOADS);
  return Number.isFinite(n) ? Math.max(1, Math.min(10, Math.floor(n))) : MAX_CONCURRENT_DOWNLOADS;
}

export function setConcurrency(n: number): number {
  const v = Number.isFinite(n) ? Math.max(1, Math.min(10, Math.floor(n))) : MAX_CONCURRENT_DOWNLOADS;
  setSetting("concurrent_downloads", String(v));
  pump();
  return v;
}

function pump(): void {
  while (active.size < concurrency() && queue.length > 0) {
    const id = queue.shift()!;
    active.add(id);
    runJob(id)
      .catch((err) => console.error(`[download ${id}]`, err))
      .finally(() => {
        active.delete(id);
        cancels.delete(id);
        pump();
      });
  }
}

async function runJob(id: number): Promise<void> {
  const job = getDownload(id);
  if (!job || job.status !== "queued") return;
  // ponytail: files are shared — adopt a done copy or wait for a sibling download instead of writing the same file twice.
  const shared = db
    .query(
      "SELECT file_path, size FROM downloads WHERE kind = ? AND item_id = ? AND lang IS ? AND status = 'done' AND id != ? ORDER BY id DESC LIMIT 1",
    )
    .get(job.kind, job.itemId, job.lang, id) as { file_path: string | null; size: number | null } | null;
  if (shared?.file_path && existsSync(shared.file_path)) {
    patchJob(id, { status: "done", progress: 100, filePath: shared.file_path, size: shared.size, error: null });
    return;
  }
  const sibling = db
    .query(
      "SELECT id FROM downloads WHERE kind = ? AND item_id = ? AND lang IS ? AND status = 'downloading' AND id != ? LIMIT 1",
    )
    .get(job.kind, job.itemId, job.lang, id) as { id: number } | null;
  if (sibling) {
    queue.push(id);
    return;
  }
  const cancel = new AbortController();
  cancels.set(id, cancel);
  patchJob(id, { status: "downloading", progress: 0, error: null });
  try {
    if (job.kind === "manga") await downloadManga(job, cancel.signal);
    else await downloadAnime(job, cancel.signal);
  } catch (err: any) {
    if (cancel.signal.aborted) return;
    const message = String(err?.message || err || "Download failed").slice(0, 500);
    patchJob(id, { status: "error", error: message });
  }
}

function extOf(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() || "jpg";
  return ["jpg", "jpeg", "png", "webp", "gif", "avif"].includes(ext) ? ext : "jpg";
}

async function fetchBytes(url: string, signal: AbortSignal, tries = 3): Promise<Uint8Array> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "AniManga/1.0" },
        signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]),
      });
      if (!res.ok) throw new Error(`Image fetch failed (${res.status})`);
      return new Uint8Array(await res.arrayBuffer());
    } catch (err) {
      lastErr = err;
      if (signal.aborted) throw err;
      await Bun.sleep(400 * (i + 1));
    }
  }
  throw lastErr;
}

function mangaChapterImages(chapterId: string): Promise<{ url: string; fileName: string }[]> {
  if (isWeebCentralId(chapterId)) return weebChapterImages(chapterId);
  if (isMangaPillId(chapterId)) return pillChapterImages(chapterId);
  if (isMangaFireId(chapterId)) return fireChapterImages(chapterId);
  return getChapterImages(chapterId);
}

export async function buildMangaZip(chapterId: string, signal = new AbortController().signal): Promise<Uint8Array> {
  const images = await mangaChapterImages(chapterId);
  if (images.length === 0) throw new Error("Chapter has no pages");
  const files: Record<string, Uint8Array> = {};
  let cursor = 0;

  async function worker() {
    while (cursor < images.length) {
      const index = cursor++;
      if (signal.aborted) throw new Error("Aborted");
      const image = images[index];
      files[`${String(index + 1).padStart(3, "0")}.${extOf(image.fileName)}`] = await fetchBytes(image.url, signal);
    }
  }

  await Promise.all(Array.from({ length: Math.min(4, images.length) }, worker));
  return zipSync(files, { level: 0 });
}

async function downloadManga(job: DownloadJob, signal: AbortSignal): Promise<void> {
  const images = await mangaChapterImages(job.itemId);
  if (images.length === 0) throw new Error("Chapter has no pages");
  const dir = join(DOWNLOAD_DIR, "manga", job.sourceId);
  mkdirSync(dir, { recursive: true });
  const finalPath = join(dir, `${job.itemId}.cbz`);
  const tmpPath = `${finalPath}.${job.id}.part`;

  const files: Record<string, Uint8Array> = {};
  let done = 0;
  let cursor = 0;
  async function worker() {
    while (cursor < images.length) {
      const index = cursor++;
      if (signal.aborted) throw new Error("Aborted");
      const image = images[index];
      files[`${String(index + 1).padStart(3, "0")}.${extOf(image.fileName)}`] = await fetchBytes(image.url, signal);
      done++;
      setProgress(job.id, (done / images.length) * 95);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, images.length) }, worker));

  await Bun.write(tmpPath, zipSync(files, { level: 0 }));
  renameSync(tmpPath, finalPath);
  patchJob(job.id, { status: "done", progress: 100, filePath: finalPath, size: statSync(finalPath).size, error: null });
}

function drainLines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  return (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        for (const line of lines) onLine(line);
      }
      if (buffer) onLine(buffer);
    } catch {}
  })();
}

async function runCommand(
  jobId: number,
  cmd: string[],
  opts: { onProgress?: (percent: number) => void; signal: AbortSignal },
): Promise<{ code: number; stderr: string }> {
  const proc = Bun.spawn(cmd, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  procs.set(jobId, proc);
  const stop = () => {
    try {
      proc.kill();
    } catch {}
  };
  opts.signal.addEventListener("abort", stop, { once: true });

  let stderr = "";
  const onLine = (line: string) => {
    if (opts.onProgress) {
      const pct = line.match(/(\d{1,3}(?:\.\d+)?)%/);
      if (pct) opts.onProgress(Number(pct[1]));
    }
  };
  await Promise.all([
    drainLines(proc.stdout as ReadableStream<Uint8Array>, onLine),
    drainLines(proc.stderr as ReadableStream<Uint8Array>, (line) => {
      stderr = `${stderr}${line}\n`.slice(-4000);
      onLine(line);
    }),
  ]);
  const code = await proc.exited;
  opts.signal.removeEventListener("abort", stop);
  if (procs.get(jobId) === proc) procs.delete(jobId);
  return { code, stderr };
}

function findOutput(dir: string, itemId: string, lang: string): string | null {
  try {
    const files = readdirSync(dir)
      .filter((f) => f.startsWith(`${itemId}.${lang}.`) && !f.endsWith(".part") && !f.endsWith(".vtt"))
      .map((f) => join(dir, f))
      .filter((f) => {
        try {
          return statSync(f).size > 0;
        } catch {
          return false;
        }
      })
      .sort((a, b) => statSync(b).size - statSync(a).size);
    return files[0] || null;
  } catch {
    return null;
  }
}

async function downloadAnime(job: DownloadJob, signal: AbortSignal): Promise<void> {
  const lang = job.lang === "dub" ? "dub" : "sub";
  const stream = await getStream(job.itemId, lang);
  if (!stream.url.startsWith("https://") || stream.url.startsWith("-")) throw new Error("Could not resolve stream");
  const dir = join(DOWNLOAD_DIR, "anime", job.sourceId);
  mkdirSync(dir, { recursive: true });
  const template = join(dir, `${job.itemId}.${lang}.%(ext)s`);
  let lastProgressAt = 0;
  const onProgress = (pct: number) => {
    const now = Date.now();
    if (now - lastProgressAt < 800) return;
    lastProgressAt = now;
    setProgress(job.id, pct);
  };

  const args = [
    "--no-playlist",
    "--no-warnings",
    "--newline",
    "--no-part",
    "--referer",
    stream.referer,
    "--user-agent",
    UA,
    "--add-header",
    `Origin: ${stream.referer.replace(/\/$/, "")}`,
    "--merge-output-format",
    "mp4",
    "-o",
    template,
    stream.url,
  ];

  let result: { code: number; stderr: string };
  try {
    result = await runCommand(job.id, [YTDLP, ...args], { onProgress, signal });
  } catch {
    const finalPath = join(dir, `${job.itemId}.${lang}.mp4`);
    setProgress(job.id, 40);
    const ff = await runCommand(
      job.id,
      [
        FFMPEG,
        "-y",
        "-loglevel",
        "error",
        "-user_agent",
        UA,
        "-referer",
        stream.referer,
        "-allowed_extensions",
        "ALL",
        "-allowed_segment_extensions",
        "ALL",
        "-extension_picky",
        "0",
        "-protocol_whitelist",
        "http,https,tcp,tls,crypto",
        "-i",
        stream.url,
        "-c",
        "copy",
        // ponytail: HLS AAC is ADTS-framed; MP4 needs ASC (same stall as the watch path without this).
        "-bsf:a",
        "aac_adtstoasc",
        "-movflags",
        "+faststart",
        finalPath,
      ],
      { signal },
    );
    if (ff.code !== 0) throw new Error(`Media download failed: ${ff.stderr.slice(-300)}`);
    patchJob(job.id, { status: "done", progress: 100, filePath: finalPath, size: statSync(finalPath).size, error: null });
    return;
  }

  if (result.code !== 0) throw new Error(`Download failed: ${result.stderr.slice(-300)}`);
  const output = findOutput(dir, job.itemId, lang);
  if (!output) throw new Error("Download finished but no output file was found");

  const subtitle = stream.subtitles.find((s) => s.lang === "en") || stream.subtitles[0];
  if (subtitle) {
    const subLang = subtitle.lang.replace(/[^a-z0-9-]/gi, "").slice(0, 10) || "und";
    try {
      const res = await fetch(subtitle.url, {
        headers: { Referer: stream.referer, "User-Agent": UA },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) await Bun.write(join(dir, `${job.itemId}.${lang}.${subLang}.vtt`), await res.text());
    } catch {}
  }

  patchJob(job.id, { status: "done", progress: 100, filePath: output, size: statSync(output).size, error: null });
}

export function cancelDownload(id: number): void {
  const index = queue.indexOf(id);
  if (index >= 0) queue.splice(index, 1);
  cancels.get(id)?.abort();
  const proc = procs.get(id);
  if (proc) {
    try {
      proc.kill();
    } catch {}
  }
}

function cleanupPartial(job: DownloadJob): void {
  // ponytail: never wipe a shared final — if siblings remain, drop only your own manga tmp.
  const siblings = (
    db
      .query("SELECT COUNT(*) AS n FROM downloads WHERE kind = ? AND source_id = ? AND item_id = ? AND lang IS ? AND id != ?")
      .get(job.kind, job.sourceId, job.itemId, job.lang, job.id) as { n: number }
  ).n;
  const dir = join(DOWNLOAD_DIR, job.kind, job.sourceId);
  try {
    if (siblings > 0) {
      if (job.kind === "manga") {
        try {
          unlinkSync(join(dir, `${job.itemId}.cbz.${job.id}.part`));
        } catch {}
      }
      return;
    }
    const prefix =
      job.kind === "anime" ? `${job.itemId}.${job.lang === "dub" ? "dub" : "sub"}.` : `${job.itemId}.`;
    for (const file of readdirSync(dir)) {
      if (file.startsWith(prefix)) {
        try {
          unlinkSync(join(dir, file));
        } catch {}
      }
    }
  } catch {}
}

export function deleteDownload(id: number): void {
  const job = getDownload(id);
  if (!job) return;
  cancelDownload(id);
  const path = filePathOf(id);
  // ponytail: file is shared — only unlink when no other row still references it.
  const shared = path
    ? (db.query("SELECT COUNT(*) AS n FROM downloads WHERE file_path = ? AND id != ?").get(path, id) as { n: number }).n
    : 0;
  if (path && shared === 0 && existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {}
  }
  if (job.status === "downloading" || job.status === "queued") {
    setTimeout(() => cleanupPartial(job), 1200);
  } else if (shared === 0) {
    cleanupPartial(job);
  }
  db.query("DELETE FROM downloads WHERE id = ?").run(id);
}

export function recoverDownloads(): void {
  db.query(
    "UPDATE downloads SET status = 'error', error = 'Interrupted by server restart', updated_at = ? WHERE status IN ('queued','downloading')",
  ).run(Date.now());
}

export function downloadName(job: DownloadJob, extension: string): string {
  return `${sanitizeFilename(`${job.title} - ${job.label}`, job.itemId)}.${extension}`;
}

export async function chapterDownloadName(chapterId: string): Promise<string> {
  if (isWeebCentralId(chapterId)) return weebChapterDownloadName(chapterId);
  if (isMangaPillId(chapterId)) return pillChapterDownloadName(chapterId);
  if (isMangaFireId(chapterId)) return fireChapterDownloadName(chapterId);
  const meta = await getChapterMeta(chapterId);
  const manga = meta.data?.relationships?.find((r: any) => r.type === "manga")?.attributes?.title?.en || "manga";
  const attrs = meta.data?.attributes || {};
  const label = `${attrs.volume ? `Vol.${attrs.volume} ` : ""}${attrs.chapter ? `Ch.${attrs.chapter}` : "Chapter"}`;
  return `${sanitizeFilename(`${manga} - ${label}`, chapterId)}.cbz`;
}
