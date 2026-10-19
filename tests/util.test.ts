import { describe, expect, test } from "bun:test";
import {
  assertPublicHttpsUrl,
  assertResolvesPublic,
  decodeEntities,
  isAnimeId,
  isMangaId,
  isMangaPillId,
  isUuid,
  isWeebCentralId,
  sanitizeFilename,
  stripTags,
} from "../src/server/util";

describe("decodeEntities", () => {
  test("decodes named and numeric entities", () => {
    expect(decodeEntities("Tom &amp; Jerry")).toBe("Tom & Jerry");
    expect(decodeEntities("&lt;b&gt; &quot;x&quot; &apos;y&apos;")).toBe('<b> "x" \'y\'');
    expect(decodeEntities("it&#39;s")).toBe("it's");
    expect(decodeEntities("it&#x27;s")).toBe("it's");
    expect(decodeEntities("a&nbsp;b")).toBe("a b");
  });

  test("leaves unknown entities untouched", () => {
    expect(decodeEntities("&unknown; &amp;")).toBe("&unknown; &");
  });
});

describe("stripTags", () => {
  test("removes tags, decodes entities and collapses whitespace", () => {
    expect(stripTags("<p>Hello <b>world</b></p>")).toBe("Hello world");
    expect(stripTags("a<br>b")).toBe("a b");
    expect(stripTags("  A &amp; B  ")).toBe("A & B");
  });
});

describe("sanitizeFilename", () => {
  test("strips characters that are invalid in filenames", () => {
    expect(sanitizeFilename('a/b:c*d?e"f<g>h|i')).toBe("a b c d e f g h i");
    expect(sanitizeFilename("  spaced  out  ")).toBe("spaced out");
  });

  test("keeps unicode and truncates long names", () => {
    expect(sanitizeFilename("日本語 第1話")).toBe("日本語 第1話");
    expect(sanitizeFilename("a".repeat(150))).toHaveLength(120);
  });

  test("falls back when the result is empty", () => {
    expect(sanitizeFilename("   ", "fallback")).toBe("fallback");
    expect(sanitizeFilename("///")).toBe("file");
  });
});

describe("isUuid", () => {
  test("accepts canonical UUIDs in either case", () => {
    expect(isUuid("3f2b9c1e-8a4d-4e6f-9b2a-1c3d5e7f9a0b")).toBe(true);
    expect(isUuid("3F2B9C1E-8A4D-4E6F-9B2A-1C3D5E7F9A0B")).toBe(true);
  });

  test("rejects malformed ids", () => {
    expect(isUuid("3f2b9c1e8a4d4e6f9b2a1c3d5e7f9a0b")).toBe(false);
    expect(isUuid("3f2b9c1e-8a4d-4e6f-9b2a-1c3d5e7f9a0")).toBe(false);
    expect(isUuid("../../etc/passwd")).toBe(false);
    expect(isUuid("")).toBe(false);
  });
});

describe("isWeebCentralId", () => {
  test("accepts wc-namespaced ULIDs", () => {
    expect(isWeebCentralId("wc-01J76XY7E9FNDZ1DBBM6PBJPFK")).toBe(true);
    expect(isWeebCentralId("wc-01M52CHK8P0DVE505KQ6MA0H68")).toBe(true);
  });

  test("rejects UUIDs, bare ULIDs and traversal", () => {
    expect(isWeebCentralId("3f2b9c1e-8a4d-4e6f-9b2a-1c3d5e7f9a0b")).toBe(false);
    expect(isWeebCentralId("01J76XY7E9FNDZ1DBBM6PBJPFK")).toBe(false);
    expect(isWeebCentralId("wc-01J76XY7E9FNDZ1DBBM6PBJPF")).toBe(false);
    expect(isWeebCentralId("wc-../../etc/passwd.............")).toBe(false);
    expect(isWeebCentralId("")).toBe(false);
  });
});

describe("isMangaPillId", () => {
  test("accepts mp-namespaced series and chapter ids", () => {
    expect(isMangaPillId("mp-2")).toBe(true);
    expect(isMangaPillId("mp-2-11196000")).toBe(true);
  });

  test("rejects UUIDs, bare ids and traversal", () => {
    expect(isMangaPillId("3f2b9c1e-8a4d-4e6f-9b2a-1c3d5e7f9a0b")).toBe(false);
    expect(isMangaPillId("mp-../../etc/passwd")).toBe(false);
    expect(isMangaPillId("mp-")).toBe(false);
    expect(isMangaPillId("")).toBe(false);
  });
});

describe("isMangaId", () => {
  test("accepts MangaDex UUIDs, WeebCentral and MangaPill ids", () => {
    expect(isMangaId("3f2b9c1e-8a4d-4e6f-9b2a-1c3d5e7f9a0b")).toBe(true);
    expect(isMangaId("wc-01J76XY7E9FNDZ1DBBM6PBJPFK")).toBe(true);
    expect(isMangaId("mp-2")).toBe(true);
    expect(isMangaId("mp-2-11196000")).toBe(true);
    expect(isMangaId("not-an-id")).toBe(false);
  });
});

describe("isAnimeId", () => {
  test("accepts slugs and numeric ids", () => {
    expect(isAnimeId("one-piece-100")).toBe(true);
    expect(isAnimeId("12345")).toBe(true);
    expect(isAnimeId("A-B-c-9")).toBe(true);
  });

  test("rejects spaces, special characters and oversized ids", () => {
    expect(isAnimeId("one piece")).toBe(false);
    expect(isAnimeId("a/b")).toBe(false);
    expect(isAnimeId("")).toBe(false);
    expect(isAnimeId("a".repeat(201))).toBe(false);
  });
});

describe("assertPublicHttpsUrl", () => {
  test("accepts public https URLs", () => {
    expect(assertPublicHttpsUrl("https://example.com").hostname).toBe("example.com");
    expect(assertPublicHttpsUrl("https://cdn.example.co.uk/path?q=1").hostname).toBe("cdn.example.co.uk");
    expect(assertPublicHttpsUrl("https://172.15.0.1").hostname).toBe("172.15.0.1");
  });

  test("rejects non-https protocols", () => {
    expect(() => assertPublicHttpsUrl("http://example.com")).toThrow();
    expect(() => assertPublicHttpsUrl("ftp://example.com")).toThrow();
  });

  test("rejects local, private and link-local hosts", () => {
    for (const url of [
      "https://localhost",
      "https://localhost:3000",
      "https://127.0.0.1",
      "https://10.0.0.5",
      "https://192.168.1.20",
      "https://172.16.0.1",
      "https://172.31.255.255",
      "https://169.254.169.254",
      "https://[::1]/",
      "https://[::]/",
      "https://[::ffff:7f00:1]/",
      "https://[fc00::1]/",
      "https://[fe80::1]/",
      "https://localhost./",
      "https://nas.local",
      "https://metadata.internal",
    ]) {
      expect(() => assertPublicHttpsUrl(url), url).toThrow();
    }
  });
});

describe("assertResolvesPublic", () => {
  test("rejects private literals without DNS", async () => {
    await expect(assertResolvesPublic(new URL("https://127.0.0.1"))).rejects.toThrow();
    await expect(assertResolvesPublic(new URL("https://[::ffff:7f00:1]"))).rejects.toThrow();
    await expect(assertResolvesPublic(new URL("https://172.15.0.1"))).resolves.toBeUndefined();
  });
});
