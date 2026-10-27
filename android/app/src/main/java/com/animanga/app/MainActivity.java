package com.animanga.app;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

/**
 * Single-activity app: Server setup -> Browse -> Detail/download -> Downloaded -> Settings/offline.
 * Matches Pencil screens 01..05. Zero external deps.
 */
public class MainActivity extends Activity {
    private static final String PREFS = "animanga";
    private SharedPreferences prefs;
    private AnimangaApi api;
    private DownloadStore store;
    private final Handler main = new Handler(Looper.getMainLooper());

    private LinearLayout root;
    private LinearLayout screenSetup, screenBrowse, screenDownloaded, screenSettings;
    private TextView browseStatus, downloadedStatus, offlineBanner;
    private EditText serverInput, searchInput;
    private ListView browseList, downloadedList;
    private ArrayAdapter<String> browseAdapter, downloadedAdapter;
    private final List<String> browseTitles = new ArrayList<>();
    private final List<RowRef> browseRows = new ArrayList<>();
    private final List<DownloadStore.Entry> deviceRows = new ArrayList<>();
    private final List<String> deviceTitles = new ArrayList<>();
    private String mode = "manga";
    private Button mangaTab, animeTab;
    private boolean manualOffline = false;
    private boolean autoOnNoWifi = true;

    static final class RowRef {
        String kind, sourceId, itemId, title, label;
    }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        store = new DownloadStore(getFilesDir());
        manualOffline = prefs.getBoolean("offline", false);
        autoOnNoWifi = prefs.getBoolean("autoNoWifi", true);

        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(32, 32, 32, 32);

        offlineBanner = new TextView(this);
        offlineBanner.setText("OFFLINE — showing on-device downloads only");
        offlineBanner.setVisibility(View.GONE);
        root.addView(offlineBanner);

        buildSetup();
        buildBrowse();
        buildDownloaded();
        buildSettings();
        buildNav();

        setContentView(root);
        String saved = prefs.getString("server", "");
        if (saved.isEmpty()) show(screenSetup);
        else {
            serverInput.setText(saved);
            connect(false);
        }
        refreshOfflineBanner();
    }

    // ---------- screens ----------
    private void buildSetup() {
        screenSetup = section();
        title(screenSetup, "AniManga");
        text(screenSetup, "Connect to your self-hosted server");
        serverInput = new EditText(this);
        serverInput.setHint("https:// manga.home.local:3000");
        screenSetup.addView(serverInput);
        Button save = new Button(this);
        save.setText("Save & Connect");
        save.setOnClickListener(v -> connect(true));
        screenSetup.addView(save);
        Button login = new Button(this);
        login.setText("Open login in app (SSO / password)");
        login.setOnClickListener(v -> openLoginWebView());
        screenSetup.addView(login);
        text(screenSetup, "Domain stored on device. First email to sign in becomes admin.");
        root.addView(screenSetup);
    }

    private void buildBrowse() {
        screenBrowse = section();
        title(screenBrowse, "Browse");
        LinearLayout tabs = new LinearLayout(this);
        tabs.setOrientation(LinearLayout.HORIZONTAL);
        mangaTab = new Button(this); mangaTab.setText("Manga");
        mangaTab.setOnClickListener(v -> { mode = "manga"; styleTabs(); loadBrowse(); });
        animeTab = new Button(this); animeTab.setText("Anime");
        animeTab.setOnClickListener(v -> { mode = "anime"; styleTabs(); loadBrowse(); });
        LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
        tabs.addView(mangaTab, tp);
        tabs.addView(animeTab, tp);
        screenBrowse.addView(tabs, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        styleTabs();
        searchInput = new EditText(this);
        searchInput.setHint("Search…");
        searchInput.setOnEditorActionListener((v, actionId, e) -> { loadBrowse(); return true; });
        screenBrowse.addView(searchInput);
        browseStatus = text(screenBrowse, "");
        browseTitles.clear();
        browseAdapter = new ArrayAdapter<>(this, android.R.layout.simple_list_item_1, browseTitles);
        browseList = new ListView(this);
        browseList.setAdapter(browseAdapter);
        browseList.setOnItemClickListener((p, v, i, id) -> showDetail(browseRows.get(i)));
        screenBrowse.addView(browseList, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 900));
        root.addView(screenBrowse);
    }

    private void buildDownloaded() {
        screenDownloaded = section();
        title(screenDownloaded, "Downloaded");
        downloadedStatus = text(screenDownloaded, "On-device only. Delete frees phone storage.");
        downloadedAdapter = new ArrayAdapter<>(this, android.R.layout.simple_list_item_1, deviceTitles);
        downloadedList = new ListView(this);
        downloadedList.setAdapter(downloadedAdapter);
        downloadedList.setOnItemClickListener((p, v, i, id) -> confirmDelete(deviceRows.get(i)));
        screenDownloaded.addView(downloadedList, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 900));
        root.addView(screenDownloaded);
    }

    private void buildSettings() {
        screenSettings = section();
        title(screenSettings, "Settings & Offline");
        Switch off = new Switch(this);
        off.setText("Offline mode");
        off.setChecked(manualOffline);
        off.setOnCheckedChangeListener((v, c) -> {
            manualOffline = c;
            prefs.edit().putBoolean("offline", c).apply();
            refreshOfflineBanner();
        });
        screenSettings.addView(off);
        Switch auto = new Switch(this);
        auto.setText("Auto offline when no WiFi");
        auto.setChecked(autoOnNoWifi);
        auto.setOnCheckedChangeListener((v, c) -> {
            autoOnNoWifi = c;
            prefs.edit().putBoolean("autoNoWifi", c).apply();
            refreshOfflineBanner();
        });
        screenSettings.addView(auto);
        Button edit = new Button(this);
        edit.setText("Change server");
        edit.setOnClickListener(v -> show(screenSetup));
        screenSettings.addView(edit);
        text(screenSettings, "Server library is shared; deleting on phone keeps server files (admin delete only on web).");
        root.addView(screenSettings);
    }

    private void buildNav() {
        LinearLayout nav = new LinearLayout(this);
        nav.setOrientation(LinearLayout.HORIZONTAL);
        String[] names = {"Browse", "Downloaded", "Settings"};
        LinearLayout[] screens = {screenBrowse, screenDownloaded, screenSettings};
        for (int i = 0; i < names.length; i++) {
            Button btn = new Button(this);
            btn.setText(names[i]);
            final LinearLayout s = screens[i];
            btn.setOnClickListener(v -> {
                if (s == screenBrowse && isOffline()) {
                    toast("Offline — Downloaded only");
                    show(screenDownloaded);
                } else show(s);
                if (s == screenDownloaded) loadDevice();
            });
            nav.addView(btn, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        }
        root.addView(nav);
    }

    // ---------- logic ----------
    private void show(LinearLayout s) {
        screenSetup.setVisibility(s == screenSetup ? View.VISIBLE : View.GONE);
        screenBrowse.setVisibility(s == screenBrowse ? View.VISIBLE : View.GONE);
        screenDownloaded.setVisibility(s == screenDownloaded ? View.VISIBLE : View.GONE);
        screenSettings.setVisibility(s == screenSettings ? View.VISIBLE : View.GONE);
        if (s == screenDownloaded) loadDevice();
        if (s == screenBrowse) loadBrowse();
    }

    private boolean isWifi() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            NetworkCapabilities nc = cm.getNetworkCapabilities(cm.getActiveNetwork());
            return nc != null && nc.hasTransport(NetworkCapabilities.TRANSPORT_WIFI);
        } catch (Exception e) { return false; }
    }

    private boolean isOffline() {
        return OfflinePolicy.isOffline(manualOffline, autoOnNoWifi, isWifi());
    }

    private void refreshOfflineBanner() {
        boolean off = isOffline();
        offlineBanner.setVisibility(off ? View.VISIBLE : View.GONE);
    }

    private void connect(boolean toastOk) {
        String raw = serverInput.getText().toString();
        final String base;
        try { base = ServerConfig.normalize(raw); }
        catch (IllegalArgumentException e) { toast(e.getMessage()); return; }
        api = new AnimangaApi(base);
        syncCookieFromWebView();
        bg(() -> {
            try {
                AnimangaApi.Resp r = api.get("/api/health");
                if (r.code != 200) throw new IllegalStateException("Health check failed (" + r.code + ")");
                prefs.edit().putString("server", base).apply();
                main.post(() -> {
                    if (toastOk) toast("Connected: " + base);
                    show(screenBrowse);
                    refreshOfflineBanner();
                });
            } catch (Exception e) {
                main.post(() -> toast("Cannot reach server: " + e.getMessage()));
            }
        });
    }

    private void loadBrowse() {
        refreshOfflineBanner();
        if (api == null) { show(screenSetup); return; }
        if (isOffline()) { toast("Offline — Downloaded only"); show(screenDownloaded); return; }
        final String q = searchInput == null ? "" : searchInput.getText().toString().trim();
        browseStatus.setText("Loading…");
        bg(() -> {
            try {
                String path = mode.equals("manga")
                        ? (q.isEmpty() ? "/api/manga/popular?lang=en&page=1" : AnimangaApi.mangaSearch(q, "en", 1))
                        : (q.isEmpty() ? "/api/anime/popular?page=1" : AnimangaApi.animeSearch(q, 1));
                AnimangaApi.Resp r = api.get(path);
                if (r.code == 401 || r.code == 403) {
                    main.post(() -> { toast("Sign in required — open Setup → login"); show(screenSetup); });
                    return;
                }
                if (r.code != 200) throw new IllegalStateException("Browse failed (" + r.code + ")");
                final List<RowRef> rows = parseItems(r.body, mode);
                main.post(() -> {
                    browseRows.clear(); browseTitles.clear();
                    browseRows.addAll(rows);
                    for (RowRef row : rows) browseTitles.add(row.title + "\n" + row.label);
                    browseAdapter.notifyDataSetChanged();
                    browseStatus.setText(rows.size() + " results (same data as webapp)");
                });
            } catch (Exception e) {
                main.post(() -> browseStatus.setText("Could not load: " + e.getMessage()));
            }
        });
    }

    private void showDetail(RowRef row) {
        // ponytail: detail = chapters/episodes dialog with download, not a new Activity.
        bg(() -> {
            try {
                String path = row.kind.equals("manga")
                        ? "/api/manga/" + AnimangaApi.encode(row.sourceId) + "/chapters?lang=en"
                        : "/api/anime/" + AnimangaApi.encode(row.sourceId) + "/episodes";
                AnimangaApi.Resp r = api.get(path);
                if (r.code != 200) throw new IllegalStateException("Detail failed (" + r.code + ")");
                List<RowRef> items = parseItems(r.body, row.kind.equals("manga") ? "chapter" : "episode");
                if (items.isEmpty()) throw new IllegalStateException("No chapters/episodes");
                RowRef first = items.get(0);
                first.title = row.title;
                first.sourceId = row.sourceId;
                main.post(() -> queueServerDownload(first));
            } catch (Exception e) {
                main.post(() -> toast(e.getMessage()));
            }
        });
    }

    /** Uses the current webapp implementation: POST /api/downloads, wait for done, pull file to phone. */
    private void queueServerDownload(RowRef item) {
        toast("Queueing download: " + item.label);
        bg(() -> {
            try {
                String lang = item.kind.equals("anime") ? "\"sub\"" : "null";
                String json = "{\"kind\":\"" + item.kind + "\",\"sourceId\":\"" + item.sourceId
                        + "\",\"itemId\":\"" + item.itemId + "\",\"title\":\"" + esc(item.title)
                        + "\",\"label\":\"" + esc(item.label) + "\",\"cover\":null,\"lang\":" + lang + "}";
                AnimangaApi.Resp r = api.postJson("/api/downloads", json);
                if (r.code != 200 && r.code != 201) throw new IllegalStateException("Queue failed (" + r.code + ")");
                int id = extractId(r.body);
                // poll server until done (server does the heavy lifting: CBZ zip / yt-dlp MP4)
                String status = "";
                for (int i = 0; i < 120; i++) {
                    Thread.sleep(2000);
                    AnimangaApi.Resp d = api.get("/api/downloads");
                    if (d.body.contains("\"id\":" + id) && d.body.contains("\"status\":\"done\"")) { status = "done"; break; }
                    if (d.body.contains("\"id\":" + id) && d.body.contains("\"status\":\"error\"")) { status = "error"; break; }
                }
                if (!"done".equals(status)) throw new IllegalStateException("Still processing on server — retry from Downloaded later");
                String ext = item.kind.equals("manga") ? "cbz" : "mp4";
                String fileName = safeFile(item.title + "-" + item.label + "." + ext);
                File dest = store.fileFor(fileName);
                boolean asAttachment = item.kind.equals("anime");
                api.downloadToFile(AnimangaApi.downloadFile(id, asAttachment), dest, null);
                store.put(new DownloadStore.Entry(item.kind, item.itemId, item.title, item.label, fileName, dest.length()));
                main.post(() -> { toast("Saved to phone: " + fileName); loadDevice(); show(screenDownloaded); });
            } catch (Exception e) {
                main.post(() -> toast("Download failed: " + e.getMessage()));
            }
        });
    }

    private void loadDevice() {
        deviceRows.clear(); deviceTitles.clear();
        List<DownloadStore.Entry> all = store.list();
        deviceRows.addAll(all);
        for (DownloadStore.Entry e : all) {
            deviceTitles.add(e.title + " — " + e.label + "\n" + e.fileName + " · " + (e.size / 1024) + " KB  [tap to delete]");
        }
        if (downloadedAdapter != null) downloadedAdapter.notifyDataSetChanged();
        if (downloadedStatus != null) {
            downloadedStatus.setText(all.size() + " on phone · " + (store.bytesUsed() / 1048576) + " MB used");
        }
    }

    private void confirmDelete(DownloadStore.Entry e) {
        bg(() -> {
            store.delete(e.kind, e.itemId);
            main.post(() -> { toast("Deleted from phone"); loadDevice(); });
        });
    }

    // ---------- web login reuse ----------
    private void openLoginWebView() {
        String raw = serverInput.getText().toString();
        final String base;
        try { base = ServerConfig.normalize(raw); } catch (Exception e) { toast(e.getMessage()); return; }
        WebView wv = new WebView(this);
        wv.getSettings().setJavaScriptEnabled(true);
        wv.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView v, String url) {
                syncCookieFromWebView();
                if (api == null || !api.base().equals(base)) api = new AnimangaApi(base);
            }
        });
        wv.loadUrl(base + "/manga");
        ScrollView sv = new ScrollView(this);
        sv.addView(wv, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1200));
        screenSetup.addView(sv);
        toast("Sign in above, then tap Save & Connect");
    }

    private void syncCookieFromWebView() {
        try {
            String c = CookieManager.getInstance().getCookie(api != null ? api.base() : "");
            if (c != null && api != null) api.setCookie(c);
        } catch (Exception ignored) {}
    }

    // ---------- tiny UI + parse helpers ----------
    private LinearLayout section() {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setVisibility(View.GONE);
        return l;
    }

    private void title(LinearLayout p, String s) {
        TextView t = new TextView(this);
        t.setText(s); t.setTextSize(24);
        p.addView(t);
    }

    private TextView text(LinearLayout p, String s) {
        TextView t = new TextView(this);
        t.setText(s); t.setTextSize(13);
        p.addView(t);
        return t;
    }

    private void toast(String s) {
        Toast.makeText(this, s, Toast.LENGTH_LONG).show();
    }

    /** Full-width segmented tabs mirroring Pencil Browse screen (accent pill = active). */
    private void styleTabs() {
        styleTab(mangaTab, mode.equals("manga"));
        styleTab(animeTab, mode.equals("anime"));
    }

    private void styleTab(Button b, boolean active) {
        if (b == null) return;
        android.graphics.drawable.GradientDrawable d = new android.graphics.drawable.GradientDrawable();
        d.setCornerRadius(dp(20));
        d.setColor(active ? 0xFFA855F7 : 0xFF1E1E2E);
        b.setBackground(d);
        b.setTextColor(active ? 0xFFFFFFFF : 0xFFA1A1B3);
    }

    private float dp(int v) {
        return v * getResources().getDisplayMetrics().density;
    }

    private void bg(Runnable r) { new Thread(r).start(); }

    private static String esc(String s) {
        return s == null ? "" : s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private static String safeFile(String s) {
        return s.replaceAll("[^a-zA-Z0-9._-]+", "_").replaceAll("_+", "_");
    }

    private static int extractId(String body) {
        int i = body.indexOf("\"id\":");
        if (i < 0) return -1;
        int j = i + 5;
        StringBuilder sb = new StringBuilder();
        while (j < body.length() && (Character.isDigit(body.charAt(j)) || body.charAt(j) == '-')) sb.append(body.charAt(j++));
        try { return Integer.parseInt(sb.toString()); } catch (Exception e) { return -1; }
    }

    /** Minimal item extractor for webapp shapes: manga/anime lists, chapters, episodes. */
    static List<RowRef> parseItems(String body, String kind) {
        List<RowRef> out = new ArrayList<>();
        // split top-level objects naively; server JSON is flat arrays of objects here
        int depth = 0, start = -1;
        for (int i = 0; i < body.length(); i++) {
            char c = body.charAt(i);
            if (c == '{') { if (depth == 1) start = i; depth++; }
            else if (c == '}') {
                depth--;
                if (depth == 1 && start >= 0) {
                    String obj = body.substring(start, i + 1);
                    RowRef r = new RowRef();
                    r.kind = kind.equals("episode") ? "anime" : kind.equals("chapter") ? "manga" : kind;
                    r.sourceId = field(obj, "mangaId", field(obj, "id", ""));
                    if (kind.equals("episode")) r.itemId = field(obj, "id", "");
                    else if (kind.equals("chapter")) r.itemId = field(obj, "id", "");
                    else r.itemId = field(obj, "id", "");
                    if (r.sourceId.isEmpty()) r.sourceId = r.itemId;
                    r.title = field(obj, "title", r.itemId);
                    String ch = field(obj, "chapter", "");
                    String num = field(obj, "number", ch);
                    r.label = num.isEmpty() ? r.title : ("anime".equals(r.kind) ? "EP " + num : "Ch." + num);
                    if (!r.itemId.isEmpty()) out.add(r);
                    start = -1;
                    if (out.size() >= 50) break;
                }
            } else if (c == '[' && depth == 0) depth = 1;
            else if (c == ']' && depth == 1) depth = 0;
        }
        return out;
    }

    private static String field(String obj, String key, String fb) {
        String k = "\"" + key + "\":";
        int i = obj.indexOf(k);
        if (i < 0) return fb;
        i += k.length();
        while (i < obj.length() && (obj.charAt(i) == ' ' || obj.charAt(i) == '"')) {
            boolean quoted = obj.charAt(i) == '"';
            if (!quoted) { i++; continue; }
            i++;
            StringBuilder sb = new StringBuilder();
            for (; i < obj.length(); i++) {
                char c = obj.charAt(i);
                if (c == '\\' && i + 1 < obj.length()) { sb.append(obj.charAt(i + 1)); i++; continue; }
                if (c == '"') break;
                sb.append(c);
            }
            String v = sb.toString();
            return v.equals("null") ? fb : v;
        }
        StringBuilder sb = new StringBuilder();
        for (; i < obj.length() && obj.charAt(i) != ',' && obj.charAt(i) != '}'; i++) sb.append(obj.charAt(i));
        String v = sb.toString().trim();
        return v.isEmpty() || v.equals("null") ? fb : v;
    }
}
