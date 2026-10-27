package com.animanga.app;

import java.util.ArrayList;
import java.util.List;

/**
 * Dependency-free JSON row parsing for the AniManga API shapes
 * (mirrors src/shared/types.ts). Moved out of the Activity so it is JVM-testable.
 */
public final class ApiModels {
    private ApiModels() {}

    public static final class Row {
        public String kind = "";      // manga | anime (list rows) — chapter | episode for detail rows
        public String sourceId = "";  // series id (for detail rows: parent series id)
        public String itemId = "";    // row id (series id for lists, chapter/episode id for details)
        public String title = "";
        public String label = "";
        public String cover = "";
    }

    /** Parse browse lists (manga/anime) and detail lists (chapter/episode) into rows. */
    public static List<Row> parseRows(String body, String kind) {
        List<Row> out = new ArrayList<>();
        if (body == null) return out;
        // ponytail: flat brace-scan — server lists contain no nested objects at item level.
        int depth = 0, start = -1;
        for (int i = 0; i < body.length(); i++) {
            char c = body.charAt(i);
            if (c == '{') {
                if (depth == 1) start = i;
                depth++;
            } else if (c == '}') {
                depth--;
                if (depth == 1 && start >= 0) {
                    Row r = rowOf(body.substring(start, i + 1), kind);
                    if (r != null && !r.itemId.isEmpty()) out.add(r);
                    if (out.size() >= 100) break;
                    start = -1;
                }
            } else if (c == '[' && depth == 0) {
                depth = 1;
            } else if (c == ']' && depth == 1) {
                depth = 0;
            }
        }
        return out;
    }

    private static Row rowOf(String obj, String kind) {
        Row r = new Row();
        if (kind.equals("episode")) {
            r.kind = "anime";
            r.itemId = field(obj, "id", "");
            r.sourceId = field(obj, "id", "");
            r.title = field(obj, "title", r.itemId);
            String num = field(obj, "number", "");
            r.label = num.isEmpty() ? r.title : "EP " + num;
            return r;
        }
        if (kind.equals("chapter")) {
            r.kind = "manga";
            r.itemId = field(obj, "id", "");
            r.sourceId = r.itemId; // caller replaces with the series id
            r.title = field(obj, "title", r.itemId);
            String ch = field(obj, "chapter", "");
            String vol = field(obj, "volume", "");
            r.label = ("Ch." + ch + (vol.isEmpty() ? "" : " (Vol." + vol + ")")).replace("Ch. ", "Chapter");
            if (ch.isEmpty()) r.label = r.title;
            return r;
        }
        r.kind = kind;
        r.itemId = field(obj, "id", "");
        r.sourceId = r.itemId;
        r.title = field(obj, "title", r.itemId);
        r.cover = field(obj, "cover", "");
        String meta = field(obj, "status", field(obj, "type", field(obj, "duration", "")));
        String year = field(obj, "year", "");
        r.label = !year.isEmpty() && !meta.isEmpty() ? year + " · " + meta : (!meta.isEmpty() ? meta : kind);
        return r;
    }

    /** Extract a top-level string/number/bool/null field from a flat JSON object. */
    public static String field(String obj, String key, String fb) {
        String k = "\"" + key + "\":";
        int i = obj.indexOf(k);
        if (i < 0) return fb;
        i += k.length();
        while (i < obj.length() && obj.charAt(i) == ' ') i++;
        if (i < obj.length() && obj.charAt(i) == '"') {
            i++;
            StringBuilder sb = new StringBuilder();
            for (; i < obj.length(); i++) {
                char c = obj.charAt(i);
                if (c == '\\' && i + 1 < obj.length()) { sb.append(obj.charAt(i + 1)); i++; continue; }
                if (c == '"') break;
                sb.append(c);
            }
            return sb.toString();
        }
        StringBuilder sb = new StringBuilder();
        for (; i < obj.length() && obj.charAt(i) != ',' && obj.charAt(i) != '}' && obj.charAt(i) != ']'; i++) {
            sb.append(obj.charAt(i));
        }
        String v = sb.toString().trim();
        return v.isEmpty() || v.equals("null") ? fb : v;
    }

    public static int extractId(String body) {
        int i = body == null ? -1 : body.indexOf("\"id\":");
        if (i < 0) return -1;
        int j = i + 5;
        StringBuilder sb = new StringBuilder();
        while (j < body.length() && (Character.isDigit(body.charAt(j)) || body.charAt(j) == '-')) {
            sb.append(body.charAt(j++));
        }
        try { return Integer.parseInt(sb.toString()); } catch (Exception e) { return -1; }
    }

    /** Server error shape: {"message"|"error": ...} — mirrors web errorMessage(). */
    public static String apiError(String body, String fallback) {
        if (body == null || body.isEmpty()) return fallback;
        String m = field(body, "message", "");
        if (!m.isEmpty()) return m;
        m = field(body, "error", "");
        return m.isEmpty() ? fallback : m;
    }

    /** appUser status from /api/me: {"appUser": {"status": ...}}. Empty when absent. */
    public static String appUserStatus(String meBody) {
        if (meBody == null) return "";
        int i = meBody.indexOf("\"appUser\"");
        if (i < 0) return "";
        return field(meBody.substring(i), "status", "");
    }

    public static String esc(String s) {
        return s == null ? "" : s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    public static String safeFile(String s) {
        return s.replaceAll("[^a-zA-Z0-9._-]+", "_").replaceAll("_+", "_");
    }
}
