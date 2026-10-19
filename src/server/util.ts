import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#039": "'",
  "#39": "'",
};

export function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

export function stripTags(input: string): string {
  return decodeEntities(input.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

export function sanitizeFilename(input: string, fallback = "file"): string {
  const clean = input
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return clean || fallback;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

// ponytail: WeebCentral ULIDs namespaced as wc-<id>; same URL-safe alphabet as UUIDs.
export function isWeebCentralId(value: string): boolean {
  return /^wc-[A-Za-z0-9]{26}$/.test(value);
}

export function isMangaId(value: string): boolean {
  return isUuid(value) || isWeebCentralId(value);
}

export function isAnimeId(value: string): boolean {
  return /^[a-z0-9-]{1,200}$/i.test(value);
}

const PRIVATE_ADDRESSES = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  PRIVATE_ADDRESSES.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  PRIVATE_ADDRESSES.addSubnet(net, prefix, "ipv6");
}

function mappedV4(address: string): string | null {
  const m = address.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!m) return null;
  const hi = parseInt(m[1], 16);
  const lo = parseInt(m[2], 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

function isPrivateAddress(address: string): boolean {
  const v4 = mappedV4(address);
  if (v4) return PRIVATE_ADDRESSES.check(v4, "ipv4");
  const family = isIP(address);
  if (family === 4) return PRIVATE_ADDRESSES.check(address, "ipv4");
  if (family === 6) return PRIVATE_ADDRESSES.check(address, "ipv6");
  return true;
}

function bareHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

export function assertPublicHttpsUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("Only https URLs are allowed");
  const host = bareHost(url.hostname);
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error("URL host is not public");
    return url;
  }
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) {
    throw new Error("URL host is not public");
  }
  return url;
}

// ponytail: resolves once at fetch time; DNS rebinding between resolve and fetch is out of scope
export async function assertResolvesPublic(url: URL): Promise<void> {
  const host = bareHost(url.hostname);
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error("URL host is not public");
    return;
  }
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error("URL host cannot be resolved");
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new Error("URL host is not public");
  }
}

export function absoluteUrl(raw: string, base: string): string {
  return new URL(raw, base).toString();
}
