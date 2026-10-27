package com.animanga.app;

/** Normalizes + validates the self-hosted server domain. No Android deps (unit-tested on JVM). */
public final class ServerConfig {
    private ServerConfig() {}

    // ponytail: one normalizer used by app + tests, not per-screen copies.
    public static String normalize(String raw) {
        if (raw == null) throw new IllegalArgumentException("Server domain required");
        String s = raw.trim().replaceAll("/+$", "");
        if (s.isEmpty()) throw new IllegalArgumentException("Server domain required");
        if (!s.startsWith("http://") && !s.startsWith("https://")) s = "https://" + s;
        try {
            java.net.URI u = new java.net.URI(s);
            if (u.getHost() == null) throw new IllegalArgumentException("Invalid server URL");
            if (u.getPath() != null && u.getPath().length() > 1)
                throw new IllegalArgumentException("Enter only the server origin (no /path)");
        } catch (java.net.URISyntaxException e) {
            throw new IllegalArgumentException("Invalid server URL");
        }
        return s;
    }

    public static String api(String base, String path) {
        String b = normalize(base);
        return b + (path.startsWith("/") ? path : "/" + path);
    }

    public static String healthUrl(String base) {
        return api(base, "/api/health");
    }
}
