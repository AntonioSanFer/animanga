package com.animanga.app;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Minimal cookie jar: keeps name=value pairs from every Set-Cookie, drops expired ones. */
public final class CookieJar {
    private final Map<String, String> cookies = new LinkedHashMap<>();

    public synchronized void storeFromHeaders(Map<String, List<String>> headerFields) {
        if (headerFields == null) return;
        for (Map.Entry<String, List<String>> e : headerFields.entrySet()) {
            if (e.getKey() == null || !e.getKey().equalsIgnoreCase("Set-Cookie")) continue;
            if (e.getValue() == null) continue;
            for (String raw : e.getValue()) storeOne(raw);
        }
    }

    private void storeOne(String raw) {
        if (raw == null) return;
        String[] parts = raw.split(";", 2);
        String nv = parts[0].trim();
        int eq = nv.indexOf('=');
        if (eq <= 0) return;
        String name = nv.substring(0, eq).trim();
        String value = nv.substring(eq + 1).trim();
        String rest = parts.length > 1 ? parts[1].toLowerCase() : "";
        // ponytail: expired/deleted cookies evict the entry — same rule a browser uses.
        if (value.isEmpty() || rest.contains("max-age=0") || rest.contains("expires=thu, 01 jan 1970")) {
            cookies.remove(name);
            return;
        }
        cookies.put(name, value);
    }

    public synchronized String header() {
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, String> e : cookies.entrySet()) {
            if (sb.length() > 0) sb.append("; ");
            sb.append(e.getKey()).append('=').append(e.getValue());
        }
        return sb.toString();
    }

    public synchronized boolean isEmpty() { return cookies.isEmpty(); }
    public synchronized void clear() { cookies.clear(); }
    public synchronized boolean has(String name) { return cookies.containsKey(name); }
}
