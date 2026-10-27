package com.animanga.app;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/**
 * Minimal HTTP client for the AniManga Hono API (matches src/server/api.ts + better-auth).
 * No third-party deps: HttpURLConnection + CookieJar, so it runs on Android and plain JVM tests.
 */
public final class AnimangaApi {
    static {
        // ponytail: stock HttpURLConnection strips the Origin header (restricted list) and
        // better-auth 403s cookie POSTs without one. Android's stack allows Origin anyway.
        try {
            System.setProperty("sun.net.http.allowRestrictedHeaders", "true");
        } catch (Exception ignored) {}
    }

    private final String base;
    private final CookieJar jar = new CookieJar();

    public AnimangaApi(String base) {
        this.base = ServerConfig.normalize(base);
    }

    public String base() { return base; }
    public CookieJar cookies() { return jar; }
    public boolean hasSession() { return jar.has("better-auth.session_token"); }
    public void clearSession() { jar.clear(); }

    // ---- URL builders (offline-testable, mirror webapp routes) ----
    public String url(String path) { return ServerConfig.api(base, path); }
    public static String mangaChapters(String id, String lang) { return "/api/manga/" + encode(id) + "/chapters?lang=" + encode(lang); }
    public static String mangaChapter(String chapterId) { return "/api/manga/chapter/" + encode(chapterId); }
    public static String mangaChapterFile(String chapterId) { return "/api/manga/chapter/" + encode(chapterId) + "/file"; }
    public static String animeStreamDownload(String episodeId, String lang) {
        return "/api/anime/stream/" + encode(episodeId) + "?lang=" + encode(lang) + "&download=1";
    }
    public static String downloadFile(int id, boolean asAttachment) {
        return "/api/downloads/" + id + "/file" + (asAttachment ? "?dl=1" : "");
    }

    public static String encode(String s) {
        try { return URLEncoder.encode(s == null ? "" : s, "UTF-8"); } catch (Exception e) { return s; }
    }

    public static String mangaSearch(String q, String lang, int page) {
        return "/api/manga/search?q=" + encode(q) + "&lang=" + encode(lang) + "&page=" + page;
    }

    public static String animeSearch(String q, int page) {
        return "/api/anime/search?q=" + encode(q) + "&page=" + page;
    }

    public static String animeEpisodes(String seriesId) { return "/api/anime/" + encode(seriesId) + "/episodes"; }
    public static String animeStream(String episodeId, String lang) {
        return "/api/anime/stream/" + encode(episodeId) + "?lang=" + encode(lang);
    }
    public static String animeSubtitle(String episodeId, String lang) {
        return "/api/anime/subtitle/" + encode(episodeId) + "?lang=" + encode(lang);
    }

    // ---- favourites (mirrors web Favourites.tsx) ----
    public Resp getFavourites() throws Exception { return get("/api/favourites"); }

    public Resp addFavourite(String kind, String sourceId, String title, String cover) throws Exception {
        String c = cover == null || !cover.startsWith("/api/img/") ? "null" : "\"" + ApiModels.esc(cover) + "\"";
        return postJson("/api/favourites",
                "{\"kind\":\"" + ApiModels.esc(kind) + "\",\"sourceId\":\"" + ApiModels.esc(sourceId)
                        + "\",\"title\":\"" + ApiModels.esc(title) + "\",\"cover\":" + c + "}");
    }

    public Resp removeFavourite(String kind, String sourceId) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url("/api/favourites/" + encode(kind) + "/" + encode(sourceId))).openConnection();
        c.setConnectTimeout(15000); c.setReadTimeout(30000);
        c.setRequestMethod("DELETE");
        c.setRequestProperty("Accept", "application/json");
        String cookie = jar.header();
        if (!cookie.isEmpty()) c.setRequestProperty("Cookie", cookie);
        int code = c.getResponseCode();
        jar.storeFromHeaders(c.getHeaderFields());
        InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
        String body = in == null ? "" : readAll(in);
        c.disconnect();
        return new Resp(code, body);
    }

    // ---- auth (native email/password — mirrors web Accounts.tsx, no WebView) ----
    public Resp getProviders() throws Exception { return get("/api/providers"); }
    public Resp getMe() throws Exception { return get("/api/me"); }

    public Resp signUpEmail(String email, String password, String name) throws Exception {
        return postJson("/api/auth/sign-up/email",
                "{\"email\":\"" + ApiModels.esc(email.trim()) + "\",\"password\":\"" + ApiModels.esc(password)
                        + "\",\"name\":\"" + ApiModels.esc(name.trim().isEmpty() ? email.trim().split("@")[0] : name.trim()) + "\"}");
    }

    public Resp signInEmail(String email, String password) throws Exception {
        return postJson("/api/auth/sign-in/email",
                "{\"email\":\"" + ApiModels.esc(email.trim()) + "\",\"password\":\"" + ApiModels.esc(password) + "\"}");
    }

    public Resp signOut() throws Exception {
        try {
            return postJson("/api/auth/sign-out", "{}");
        } finally {
            jar.clear();
        }
    }

    // ---- live calls ----
    public static final class Resp {
        public final int code; public final String body;
        Resp(int c, String b) { code = c; body = b; }
    }

    public Resp get(String path) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url(path)).openConnection();
        c.setConnectTimeout(15000); c.setReadTimeout(30000);
        String cookie = jar.header();
        if (!cookie.isEmpty()) c.setRequestProperty("Cookie", cookie);
        c.setRequestProperty("Accept", "application/json");
        int code = c.getResponseCode();
        jar.storeFromHeaders(c.getHeaderFields());
        InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
        String body = in == null ? "" : readAll(in);
        c.disconnect();
        return new Resp(code, body);
    }

    public Resp postJson(String path, String json) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url(path)).openConnection();
        c.setConnectTimeout(15000); c.setReadTimeout(30000);
        c.setRequestMethod("POST"); c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json");
        c.setRequestProperty("Accept", "application/json");
        // ponytail: better-auth rejects cookie POSTs without Origin — the app always has one.
        c.setRequestProperty("Origin", base);
        String cookie = jar.header();
        if (!cookie.isEmpty()) c.setRequestProperty("Cookie", cookie);
        try (OutputStream os = c.getOutputStream()) {
            os.write(json.getBytes(StandardCharsets.UTF_8));
        }
        int code = c.getResponseCode();
        jar.storeFromHeaders(c.getHeaderFields());
        InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
        String body = in == null ? "" : readAll(in);
        c.disconnect();
        return new Resp(code, body);
    }

    private static String readAll(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192]; int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }

    /** Download a remote path to a local file with progress callback (0..100, -1 unknown). */
    public void downloadToFile(String path, java.io.File dest, Progress cb) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url(path)).openConnection();
        c.setConnectTimeout(15000); c.setReadTimeout(60000);
        String cookie = jar.header();
        if (!cookie.isEmpty()) c.setRequestProperty("Cookie", cookie);
        int code = c.getResponseCode();
        if (code != 200) throw new IllegalStateException("Download failed (" + code + ")");
        long total = c.getContentLengthLong();
        try (InputStream in = c.getInputStream();
             java.io.FileOutputStream fos = new java.io.FileOutputStream(dest)) {
            byte[] buf = new byte[32768]; long done = 0; int n;
            while ((n = in.read(buf)) > 0) {
                fos.write(buf, 0, n); done += n;
                if (cb != null) cb.onProgress(total > 0 ? (int) (done * 100 / total) : -1);
            }
        } finally {
            c.disconnect();
        }
        if (cb != null) cb.onProgress(100);
    }

    public interface Progress { void onProgress(int percent); }

    /** Tiny JSON helpers without a parser dep (server responses are well-formed). */
    public static boolean looksOk(String body) {
        return body != null && (body.contains("\"ok\"") || body.contains("\"items\"") || body.contains("\"id\""));
    }
}
