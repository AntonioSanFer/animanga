import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./config";

const DIR = join(DATA_DIR, "cache", "images");
const MAX_TOTAL_BYTES = Math.max(16, Number(process.env.MAX_IMAGE_CACHE_MB || 1024)) * 1024 * 1024;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export const IMAGE_ITEM_LIMIT = 25 * 1024 * 1024;

mkdirSync(DIR, { recursive: true });

function keyFor(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

export function findCachedImage(url: string): { path: string; type: string } | null {
  const path = join(DIR, keyFor(url));
  const metaPath = `${path}.json`;
  try {
    if (!existsSync(path) || !existsSync(metaPath)) return null;
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as { type?: unknown };
    if (typeof meta.type !== "string" || !meta.type.startsWith("image/")) return null;
    if (statSync(path).size === 0) return null;
    return { path, type: meta.type };
  } catch {
    return null;
  }
}

export async function saveCachedImage(url: string, bytes: Uint8Array, type: string): Promise<void> {
  if (bytes.length === 0 || bytes.length > IMAGE_ITEM_LIMIT) return;
  const path = join(DIR, keyFor(url));
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    await Bun.write(tmp, bytes);
    renameSync(tmp, path);
    writeFileSync(`${path}.json`, JSON.stringify({ type, savedAt: Date.now() }));
  } catch {
    try {
      unlinkSync(tmp);
    } catch {}
  }
}

function remove(path: string): void {
  for (const target of [path, `${path}.json`]) {
    try {
      unlinkSync(target);
    } catch {}
  }
}

export function pruneImageCache(): void {
  try {
    const entries: { path: string; size: number; mtime: number }[] = [];
    let total = 0;
    const now = Date.now();
    for (const name of readdirSync(DIR)) {
      if (name.endsWith(".json")) continue;
      if (name.endsWith(".tmp")) {
        const path = join(DIR, name);
        try {
          if (now - statSync(path).mtimeMs > 60 * 60 * 1000) unlinkSync(path);
        } catch {}
        continue;
      }
      const path = join(DIR, name);
      try {
        const stat = statSync(path);
        if (now - stat.mtimeMs > MAX_AGE_MS) {
          remove(path);
          continue;
        }
        entries.push({ path, size: stat.size, mtime: stat.mtimeMs });
        total += stat.size;
      } catch {}
    }
    if (total <= MAX_TOTAL_BYTES) return;
    for (const entry of entries.sort((a, b) => a.mtime - b.mtime)) {
      if (total <= MAX_TOTAL_BYTES) break;
      remove(entry.path);
      total -= entry.size;
    }
  } catch {}
}
