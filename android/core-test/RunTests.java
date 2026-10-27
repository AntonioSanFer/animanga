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

    static java.util.Map<String, java.util.List<String>> headers(String... kv) {
        java.util.Map<String, java.util.List<String>> m = new java.util.LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) {
            m.computeIfAbsent(kv[i], k -> new java.util.ArrayList<>()).add(kv[i + 1]);
        }
        return m;
    }

    public static void main(String[] args) throws Exception {
        // 0. CookieJar: combines pairs, overwrites, evicts expired
        CookieJar jar = new CookieJar();
        jar.storeFromHeaders(headers("Set-Cookie", "a=1; Path=/; HttpOnly", "set-cookie", "b=2; Max-Age=300"));
        check(jar.header().equals("a=1; b=2"), "jar combines set-cookie pairs");
        jar.storeFromHeaders(headers("Set-Cookie", "a=9; Path=/"));
        check(jar.header().equals("a=9; b=2"), "jar overwrites by name");
        jar.storeFromHeaders(headers("Set-Cookie", "b=gone; Max-Age=0"));
        check(jar.header().equals("a=9"), "jar evicts expired cookie");
        check(jar.has("a") && !jar.has("b"), "jar has()");
        jar.clear();
        check(jar.isEmpty() && jar.header().isEmpty(), "jar clear");

        // 0b. ApiModels parsing with canned webapp shapes
        String search = "{\"items\":[{\"id\":\"m1\",\"title\":\"One Piece\",\"cover\":\"/api/img/manga/x/y\",\"description\":\"d\",\"year\":1997,\"status\":\"ongoing\",\"tags\":[\"a\"]}],\"total\":1}";
        java.util.List<ApiModels.Row> rows = ApiModels.parseRows(search, "manga");
        check(rows.size() == 1 && rows.get(0).title.equals("One Piece") && rows.get(0).label.contains("1997"), "parse manga search row");
        String chapters = "{\"items\":[{\"id\":\"c9\",\"volume\":\"1\",\"chapter\":\"5\",\"title\":null,\"lang\":\"en\",\"pages\":20,\"group\":\"g\",\"publishedAt\":null}],\"lang\":\"en\"}";
        java.util.List<ApiModels.Row> ch = ApiModels.parseRows(chapters, "chapter");
        check(ch.size() == 1 && ch.get(0).itemId.equals("c9") && ch.get(0).label.contains("5"), "parse chapter row");
        String episodes = "{\"items\":[{\"id\":\"42\",\"number\":\"12\",\"title\":\"EP Title\"}]}";
        java.util.List<ApiModels.Row> ep = ApiModels.parseRows(episodes, "episode");
        check(ep.size() == 1 && ep.get(0).itemId.equals("42") && ep.get(0).label.equals("EP 12"), "parse episode row");
        check(ApiModels.apiError("{\"message\":\"Invalid email or password\",\"code\":\"X\"}", "fb").equals("Invalid email or password"), "apiError prefers message");
        check(ApiModels.apiError("{\"error\":\"Access pending\",\"status\":\"pending\"}", "fb").equals("Access pending"), "apiError falls back to error");
        check(ApiModels.appUserStatus("{\"appUser\":{\"status\":\"pending\"}}").equals("pending"), "appUserStatus pending");
        check(ApiModels.appUserStatus("{\"appUser\":{\"email\":\"a@b.c\"}}").isEmpty(), "appUserStatus empty when absent");

        // favourites parsing + URL builders
        String favs = "{\"items\":[{\"kind\":\"manga\",\"sourceId\":\"m1\",\"title\":\"One Piece\",\"cover\":\"/api/img/manga/a/b\",\"createdAt\":1},{\"kind\":\"anime\",\"sourceId\":\"solo-leveling\",\"title\":\"Solo Leveling\",\"cover\":null,\"createdAt\":2}]}";
        java.util.List<ApiModels.Fav> fl = ApiModels.parseFavourites(favs);
        check(fl.size() == 2 && fl.get(0).sourceId.equals("m1") && fl.get(1).kind.equals("anime"), "parse favourites list");
        check(ApiModels.parseFavourites("{\"items\":[]}").isEmpty(), "parse empty favourites");
        check(AnimangaApi.animeStream("42", "sub").equals("/api/anime/stream/42?lang=sub"), "anime stream url");
        check(AnimangaApi.animeSubtitle("42", "sub").equals("/api/anime/subtitle/42?lang=sub"), "anime subtitle url");
        check(AnimangaApi.animeEpisodes("solo-leveling").equals("/api/anime/solo-leveling/episodes"), "anime episodes url");
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

            // live native auth: providers -> signup -> me -> signout -> me(401) -> bad login
            AnimangaApi.Resp prov = api.getProviders();
            boolean pw = prov.code == 200 && prov.body.contains("\"password\":true");
            if (!pw) {
                System.out.println("skip - live auth (password auth disabled on server)");
            } else {
                check(true, "live password auth enabled");
                String email = "apptest" + System.currentTimeMillis() + "@example.com";
                AnimangaApi.Resp su = api.signUpEmail(email, "testpass123", "App Test");
                check(su.code == 200 && api.hasSession(), "live signup sets session cookie (" + su.code + ")");
                AnimangaApi.Resp me = api.getMe();
                check(me.code == 200 && me.body.contains(email), "live /api/me after signup (" + me.code + ")");
                String st = ApiModels.appUserStatus(me.body);
                check(st.equals("active") || st.equals("pending"), "live appUser status present (" + st + ")");
                AnimangaApi.Resp bad = api.signInEmail(email, "wrongpass1");
                check(bad.code == 401 && ApiModels.apiError(bad.body, "").contains("Invalid email"), "live bad login 401 + message");
                api.signOut();
                AnimangaApi.Resp me2 = api.getMe();
                check(me2.code == 401, "live /api/me 401 after signout (" + me2.code + ")");
                AnimangaApi.Resp si = api.signInEmail(email, "testpass123");
                check(si.code == 200 && api.hasSession(), "live signin restores session (" + si.code + ")");
                // live favourites round-trip on a dedicated active dev account (skip if absent)
                AnimangaApi dev = new AnimangaApi(live);
                AnimangaApi.Resp dsi = dev.signInEmail("emu@test.local", "testpass123");
                AnimangaApi.Resp f0 = dsi.code == 200 ? dev.getFavourites() : null;
                if (f0 != null && f0.code == 200) {
                    check(true, "live favourites list (" + f0.code + ")");
                    AnimangaApi.Resp fa = dev.addFavourite("manga", "11111111-2222-3333-4444-555555555555", "Test Series", null);
                    check(fa.code == 201, "live favourite add (" + fa.code + ")");
                    AnimangaApi.Resp f1 = dev.getFavourites();
                    check(f1.code == 200 && f1.body.contains("11111111-2222-3333-4444-555555555555"), "live favourite present after add");
                    AnimangaApi.Resp fr = dev.removeFavourite("manga", "11111111-2222-3333-4444-555555555555");
                    check(fr.code == 200, "live favourite remove (" + fr.code + ")");
                    AnimangaApi.Resp f2 = dev.getFavourites();
                    check(f2.code == 200 && !f2.body.contains("11111111-2222-3333-4444-555555555555"), "live favourite gone after remove");
                    dev.signOut();
                } else {
                    System.out.println("skip - live favourites (no active dev account)");
                }
                api.signOut();
            }
        } else {
            System.out.println("skip - live tests (pass server base URL to enable)");
        }

        System.out.println("\n" + pass + " passed, " + fail + " failed");
        if (fail > 0) System.exit(1);
    }
}
