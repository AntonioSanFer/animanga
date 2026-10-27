package com.animanga.app;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;

/**
 * On-device registry of files downloaded via the app (distinct from the server's
 * shared download library). Backed by one JSON-lines file; no Room/SQLite needed.
 * ponytail: flat file + filenames, Room would be scaffolding for one list.
 */
public final class DownloadStore {
    private final File dir;
    private final File index;

    public DownloadStore(File filesDir) {
        this.dir = new File(filesDir, "animanga");
        this.index = new File(dir, "index.jsonl");
        dir.mkdirs();
    }

    public static final class Entry {
        public String kind, itemId, title, label, fileName;
        public long size;
        Entry() {}
        public Entry(String k, String i, String t, String l, String f, long s) {
            kind = k; itemId = i; title = t; label = l; fileName = f; size = s;
        }
    }

    public synchronized void put(Entry e) throws Exception {
        List<Entry> all = list();
        all.removeIf(x -> x.kind.equals(e.kind) && x.itemId.equals(e.itemId));
        all.add(0, e);
        save(all);
    }

    public synchronized List<Entry> list() {
        List<Entry> out = new ArrayList<>();
        try {
            if (!index.exists()) return out;
            for (String line : Files.readAllLines(index.toPath(), StandardCharsets.UTF_8)) {
                line = line.trim();
                if (line.isEmpty()) continue;
                Entry e = new Entry();
                e.kind = str(line, "kind"); e.itemId = str(line, "itemId");
                e.title = str(line, "title"); e.label = str(line, "label");
                e.fileName = str(line, "fileName");
                try { e.size = Long.parseLong(num(line, "size")); } catch (Exception ex) { e.size = 0; }
                if (e.fileName != null) out.add(e);
            }
        } catch (Exception ignored) {}
        return out;
    }

    /** Deletes both the bytes and the registry row. Returns true if a file was removed. */
    public synchronized boolean delete(String kind, String itemId) {
        List<Entry> all = list();
        Entry found = null;
        for (Entry e : all) if (e.kind.equals(kind) && e.itemId.equals(itemId)) found = e;
        if (found == null) return false;
        try { new File(dir, found.fileName).delete(); } catch (Exception ignored) {}
        final Entry f = found;
        all.removeIf(x -> x.kind.equals(f.kind) && x.itemId.equals(f.itemId));
        try { save(all); } catch (Exception ignored) {}
        return true;
    }

    public synchronized long bytesUsed() {
        long n = 0;
        for (Entry e : list()) {
            try { n += new File(dir, e.fileName).length(); } catch (Exception ignored) {}
        }
        return n;
    }

    public File fileFor(String fileName) { return new File(dir, fileName); }

    private void save(List<Entry> all) throws Exception {
        StringBuilder sb = new StringBuilder();
        for (Entry e : all) {
            sb.append("{\"kind\":\"").append(esc(e.kind)).append("\",\"itemId\":\"").append(esc(e.itemId))
              .append("\",\"title\":\"").append(esc(e.title)).append("\",\"label\":\"").append(esc(e.label))
              .append("\",\"fileName\":\"").append(esc(e.fileName)).append("\",\"size\":").append(e.size).append("}\n");
        }
        Files.write(index.toPath(), sb.toString().getBytes(StandardCharsets.UTF_8));
    }

    private static String esc(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ");
    }

    private static String str(String json, String key) {
        String k = "\"" + key + "\":\"";
        int i = json.indexOf(k);
        if (i < 0) return "";
        i += k.length();
        StringBuilder sb = new StringBuilder();
        for (; i < json.length(); i++) {
            char c = json.charAt(i);
            if (c == '\\' && i + 1 < json.length()) { sb.append(json.charAt(i + 1)); i++; continue; }
            if (c == '"') break;
            sb.append(c);
        }
        return sb.toString();
    }

    private static String num(String json, String key) {
        String k = "\"" + key + "\":";
        int i = json.indexOf(k);
        if (i < 0) return "0";
        i += k.length();
        StringBuilder sb = new StringBuilder();
        for (; i < json.length() && (Character.isDigit(json.charAt(i)) || json.charAt(i) == '-'); i++) sb.append(json.charAt(i));
        return sb.length() == 0 ? "0" : sb.toString();
    }
}
