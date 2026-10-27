package com.animanga.app;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/**
 * Minimal HTTP client for the AniManga Hono API (matches src/server/api.ts routes).
 * No third-party deps: HttpURLConnection + cookie string, so it runs on Android and plain JVM tests.
 */
public final class AnimangaApi {
    private final String base;
    private String cookie = "";

    public AnimangaApi(String base) {
        this.base = ServerConfig.normalize(base);
    }

    public String base() { return base; }

    public void setCookie(String c) { this.cookie = c == null ? "" : c; }
    public String cookie() { return cookie; }

    // ---- URL builders (offline-testable, mirror webapp paths) ----
    public String url(String path) { return ServerConfig.api(base, path); }
    public static String mangaChapters(String id, String lang) { return "/api/manga/" + id + "/chapters?lang=" + lang; }
    public static String mangaChapterFile(String chapterId) { return "/api/manga/chapter/" + chapterId + "/file"; }
    public static String animeStreamDownload(String episodeId, String lang) {
        return "/api/anime/stream/" + episodeId + "?lang=" + lang + "&download=1";
    }
    public static String downloadFile(int id, boolean asAttachment) {
        return "/api/downloads/" + id + "/file" + (asAttachment ? "?dl=1" : "");
    }

    public static String encode(String s) {
        try { return URLEncoder.encode(s, "UTF-8"); } catch (Exception e) { return s; }
    }

    public static String mangaSearch(String q, String lang, int page) {
        return "/api/manga/search?q=" + encode(q) + "&lang=" + encode(lang) + "&page=" + page;
    }

    public static String animeSearch(String q, int page) {
        return "/api/anime/search?q=" + encode(q) + "&page=" + page;
    }

    // ---- live calls ----
    public static final class Resp {
        public final int code; public final String body; public final String setCookie;
        Resp(int c, String b, String sc) { code = c; body = b; setCookie = sc; }
    }

    public Resp get(String path) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url(path)).openConnection();
        c.setConnectTimeout(15000); c.setReadTimeout(30000);
        if (!cookie.isEmpty()) c.setRequestProperty("Cookie", cookie);
        c.setRequestProperty("Accept", "application/json");
        int code = c.getResponseCode();
        String sc = c.getHeaderField("Set-Cookie");
        if (sc != null && !sc.isEmpty()) cookie = sc.split(";", 2)[0];
        InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
        String body = in == null ? "" : readAll(in);
        return new Resp(code, body, sc == null ? "" : sc);
    }

    public Resp postJson(String path, String json) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url(path)).openConnection();
        c.setConnectTimeout(15000); c.setReadTimeout(30000);
        c.setRequestMethod("POST"); c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json");
        if (!cookie.isEmpty()) c.setRequestProperty("Cookie", cookie);
        try (OutputStream os = c.getOutputStream()) {
            os.write(json.getBytes(StandardCharsets.UTF_8));
        }
        int code = c.getResponseCode();
        InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
        return new Resp(code, in == null ? "" : readAll(in), "");
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
        }
        if (cb != null) cb.onProgress(100);
    }

    public interface Progress { void onProgress(int percent); }

    /** Tiny JSON helpers without a parser dep (server responses are well-formed). */
    public static boolean looksOk(String body) {
        return body != null && (body.contains("\"ok\"") || body.contains("\"items\"") || body.contains("\"id\""));
    }
}
