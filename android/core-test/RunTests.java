import com.animanga.app.*;
import java.io.File;
import java.nio.file.Files;
import java.util.List;

/** Offline unit tests + optional live contract tests vs the Bun backend. No JUnit (ponytail: plain asserts). */
public class RunTests {
    static int pass = 0, fail = 0;

    static void check(boolean cond, String name) {
        if (cond) { pass++; System.out.println("ok - " + name); }
        else { fail++; System.out.println("FAIL - " + name); }
    }

    public static void main(String[] args) throws Exception {
        // 1. ServerConfig
        check(ServerConfig.normalize("manga.home.local:3000").equals("https://manga.home.local:3000"), "domain gets https prefix");
        check(ServerConfig.normalize("http://192.168.1.50:3000/").equals("http://192.168.1.50:3000"), "trailing slash stripped");
        check(ServerConfig.healthUrl("http://localhost:3000").equals("http://localhost:3000/api/health"), "health url");
        boolean threw = false;
        try { ServerConfig.normalize("http://host/app/path"); } catch (IllegalArgumentException e) { threw = true; }
        check(threw, "path in domain rejected");
        threw = false;
        try { ServerConfig.normalize("   "); } catch (IllegalArgumentException e) { threw = true; }
        check(threw, "empty domain rejected");

        // 2. OfflinePolicy
        check(OfflinePolicy.isOffline(true, true, true), "manual offline wins even on wifi");
        check(OfflinePolicy.isOffline(false, true, false), "auto offline when no wifi");
        check(!OfflinePolicy.isOffline(false, true, true), "online on wifi");
        check(!OfflinePolicy.isOffline(false, false, false), "no auto -> online even without wifi");

        // 3. URL builders mirror src/server/api.ts routes
        check(AnimangaApi.mangaChapterFile("abc-123").equals("/api/manga/chapter/abc-123/file"), "manga chapter file route");
        check(AnimangaApi.animeStreamDownload("123", "sub").contains("/api/anime/stream/123") && AnimangaApi.animeStreamDownload("123", "sub").contains("download=1"), "anime stream download route");
        check(AnimangaApi.downloadFile(7, true).equals("/api/downloads/7/file?dl=1"), "download file dl=1 for anime");
        check(AnimangaApi.downloadFile(7, false).equals("/api/downloads/7/file"), "download file plain for manga");
        check(AnimangaApi.mangaSearch("one piece", "en", 1).startsWith("/api/manga/search?q="), "manga search route");

        // 4. DownloadStore put/list/delete
        File tmp = Files.createTempDirectory("animanga-test").toFile();
        DownloadStore store = new DownloadStore(tmp);
        File f = store.fileFor("t.cbz");
        Files.write(f.toPath(), "hello".getBytes());
        store.put(new DownloadStore.Entry("manga", "ch1", "One Piece", "Ch.1", "t.cbz", 5));
        List<DownloadStore.Entry> list = store.list();
        check(list.size() == 1 && list.get(0).title.equals("One Piece"), "store roundtrip");
        check(store.bytesUsed() == 5, "bytes used");
        check(store.delete("manga", "ch1") && store.list().isEmpty() && !f.exists(), "delete removes bytes + row");
        check(!store.delete("manga", "missing"), "delete missing returns false");

        // 5. Live contract (optional)
        String live = null;
        for (String a : args) if (a.startsWith("http")) live = a;
        if (live != null) {
            AnimangaApi api = new AnimangaApi(live);
            AnimangaApi.Resp h = api.get("/api/health");
            check(h.code == 200 && h.body.contains("\"ok\""), "live /api/health 200 " + h.body.trim());
            AnimangaApi.Resp d = api.get("/api/downloads");
            check(d.code == 401 || d.code == 403, "live /api/downloads requires auth (" + d.code + ")");
            AnimangaApi.Resp m = api.get("/api/manga/popular?lang=en&page=1");
            check(m.code == 401 || m.code == 403, "live /api/manga/popular requires auth (" + m.code + ")");
            AnimangaApi.Resp img = api.get("/api/img/manga/bogus/xx?size=256");
            check(img.code == 400 || img.code == 401 || img.code == 403, "live /api/img validates (" + img.code + ")");
        } else {
            System.out.println("skip - live tests (pass server base URL to enable)");
        }

        System.out.println("\n" + pass + " passed, " + fail + " failed");
        if (fail > 0) System.exit(1);
    }
}
