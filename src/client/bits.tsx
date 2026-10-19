import { useContentProviders } from "./api";
import { navigate } from "./router";
import { IconArrowLeft } from "./ui";

// ponytail: localStorage only, no DB — progress/activity survive without server changes.

export interface ProgressEntry {
  kind: "manga" | "anime";
  seriesId: string;
  seriesTitle: string;
  cover: string | null;
  itemId: string;
  label: string;
  lang: string;
  url: string;
  time: number;
}

export interface ActivityEntry {
  kind: "manga" | "anime";
  seriesId: string;
  seriesTitle: string;
  itemId: string;
  label: string;
  url: string;
  cover: string | null;
  time: number;
}

const PKEY = "animanga:progress:v1";
const AKEY = "animanga:activity:v1";
const SKEY = "animanga:seen:v1";

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage access failures
  }
}

function key(kind: string, seriesId: string): string {
  return `${kind}:${seriesId}`;
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

// ponytail: poisoned localStorage must not crash the app — mismatch falls back.
function asList<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

const SAFE_URL = /^\/(manga\/chapter\/[0-9a-f-]+|anime\/watch\/\d+)\/?([?#]|$)/i;

export function safeEntryUrl(url: unknown, fallback = "/"): string {
  return typeof url === "string" && SAFE_URL.test(url) ? url : fallback;
}

function cleanEntry<T extends { url: string }>(entry: unknown, fallback: string): T | null {
  if (!entry || typeof entry !== "object") return null;
  return { ...(entry as T), url: safeEntryUrl((entry as { url: unknown }).url, fallback) };
}

export function getProgress(kind: "manga" | "anime", seriesId: string): ProgressEntry | null {
  const hit = asRecord(readJSON<unknown>(PKEY, {}))[key(kind, seriesId)];
  return cleanEntry<ProgressEntry>(hit, "/");
}

export function hasProgress(kind: "manga" | "anime", seriesId: string): boolean {
  return getProgress(kind, seriesId) !== null;
}

export function getAllProgress(): ProgressEntry[] {
  return asList<unknown>(Object.values(asRecord(readJSON<unknown>(PKEY, {}))))
    .map((e) => cleanEntry<ProgressEntry>(e, "/"))
    .filter((e): e is ProgressEntry => e !== null)
    .sort((a, b) => b.time - a.time);
}

export function saveProgress(entry: Omit<ProgressEntry, "time">): void {
  const all = asRecord(readJSON<unknown>(PKEY, {}));
  all[key(entry.kind, entry.seriesId)] = { ...entry, time: Date.now() };
  writeJSON(PKEY, all);
  pushActivity({
    kind: entry.kind,
    seriesId: entry.seriesId,
    seriesTitle: entry.seriesTitle,
    itemId: entry.itemId,
    label: entry.label,
    url: entry.url,
    cover: entry.cover,
    time: Date.now(),
  });
}

export function getActivity(): ActivityEntry[] {
  return asList<unknown>(readJSON<unknown>(AKEY, []))
    .map((e) => cleanEntry<ActivityEntry>(e, "/"))
    .filter((e): e is ActivityEntry => e !== null)
    .sort((a, b) => b.time - a.time);
}

export function pushActivity(entry: ActivityEntry): void {
  const rest = asList<ActivityEntry>(readJSON<unknown>(AKEY, [])).filter(
    (item) => !(item.kind === entry.kind && item.itemId === entry.itemId),
  );
  writeJSON(AKEY, [entry, ...rest].slice(0, 30));
}

// ponytail: total item count known at last read; card shows NEW when live count exceeds it.
export function getSeenTotal(kind: "manga" | "anime", seriesId: string): number | null {
  const hit = asRecord(readJSON<unknown>(SKEY, {}))[key(kind, seriesId)];
  return typeof hit?.total === "number" ? hit.total : null;
}

export function setSeenTotal(kind: "manga" | "anime", seriesId: string, total: number): void {
  const all = asRecord(readJSON<unknown>(SKEY, {}));
  all[key(kind, seriesId)] = { total };
  writeJSON(SKEY, all);
}

export function isNewCount(kind: "manga" | "anime", seriesId: string, current: number | undefined): boolean {
  if (current === undefined) return false;
  const seen = getSeenTotal(kind, seriesId);
  return seen !== null && current > seen;
}

export function BackButton({ to }: { to: string }) {
  function go() {
    const state: unknown = window.history.state;
    if (typeof state === "object" && state !== null && "animanga" in state) window.history.back();
    else navigate(to);
  }
  return (
    <button type="button" className="btn btn-sm btn-ghost" onClick={go}>
      <IconArrowLeft />
      Back
    </button>
  );
}

function closeDetails(event: { currentTarget: HTMLElement }): void {
  const details = event.currentTarget.closest("details");
  if (details) details.open = false;
}

export function ProviderPicker({
  kind,
  value,
  onChange,
}: {
  kind: "manga" | "anime";
  value: string;
  onChange: (value: string) => void;
}) {
  const query = useContentProviders(kind);
  const items = query.data ?? [];
  const label = value ? (items.find((item) => item.id === value)?.label ?? value) : "Auto";
  function pick(next: string) {
    return (event: { currentTarget: HTMLElement }) => {
      onChange(next);
      closeDetails(event);
    };
  }
  return (
    <details className="prov" title="Content provider">
      <summary className="prov-btn">
        <span className="muted">Src:</span> {query.isPending ? "…" : label}
      </summary>
      <div className="prov-menu" role="menu">
        <button type="button" className={value === "" ? "active" : ""} onClick={pick("")}>
          Auto
        </button>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={value === item.id ? "active" : ""}
            onClick={pick(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </details>
  );
}
