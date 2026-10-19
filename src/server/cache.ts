import { db } from "./db";

export function cacheGet<T>(key: string): T | null {
  const row = db.query("SELECT value, expires FROM cache WHERE key = ?").get(key) as { value: string; expires: number } | null;
  if (!row) return null;
  if (row.expires < Date.now()) {
    db.query("DELETE FROM cache WHERE key = ?").run(key);
    return null;
  }
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

export function cacheSet(key: string, value: unknown, ttlSeconds: number): void {
  db.query("INSERT OR REPLACE INTO cache (key, value, expires) VALUES (?, ?, ?)").run(
    key,
    JSON.stringify(value),
    Date.now() + ttlSeconds * 1000,
  );
}

export async function cached<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== null) return hit;
  const value = await fn();
  cacheSet(key, value, ttlSeconds);
  return value;
}

export function pruneCache(): void {
  db.query("DELETE FROM cache WHERE expires < ?").run(Date.now());
}
