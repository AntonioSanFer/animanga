package com.animanga.app

import android.app.Application
import android.content.Context
import android.content.SharedPreferences
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

// ponytail: one ViewModel holds api/store/prefs; screens keep only ephemeral UI state.
class AppViewModel(app: Application) : AndroidViewModel(app) {
    val prefs: SharedPreferences = app.getSharedPreferences("animanga", Context.MODE_PRIVATE)
    val store = DownloadStore(app.filesDir)

    private val _server = MutableStateFlow(prefs.getString("server", null))
    val server: StateFlow<String?> = _server.asStateFlow()

    private val _api = MutableStateFlow<AnimangaApi?>(null)
    val api: StateFlow<AnimangaApi?> = _api.asStateFlow()

    private val _manualOffline = MutableStateFlow(prefs.getBoolean("offline", false))
    val manualOffline: StateFlow<Boolean> = _manualOffline.asStateFlow()
    private val _autoNoWifi = MutableStateFlow(prefs.getBoolean("autoNoWifi", false))
    val autoNoWifi: StateFlow<Boolean> = _autoNoWifi.asStateFlow()
    private val _wifi = MutableStateFlow(true)

    val offline: StateFlow<Boolean> = combine(_manualOffline, _autoNoWifi, _wifi) { m, a, w ->
        OfflinePolicy.isOffline(m, a, w)
    }.stateIn(viewModelScope, SharingStarted.Eagerly, false)

    private val _startRoute = MutableStateFlow("loading")
    val startRoute: StateFlow<String> = _startRoute.asStateFlow()

    val selected = MutableStateFlow<ApiModels.Row?>(null)

    // ponytail: favourites + player target live here so Browse/Detail/Watch share them without nav args.
    private val _favs = MutableStateFlow<List<ApiModels.Fav>>(emptyList())
    val favs: StateFlow<List<ApiModels.Fav>> = _favs.asStateFlow()
    val animeLang = MutableStateFlow("sub")
    val watch = MutableStateFlow<WatchTarget?>(null)

    fun loadFavourites() {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val a = _api.value ?: return@launch
                val r = a.getFavourites()
                if (r.code == 200) _favs.value = ApiModels.parseFavourites(r.body)
            } catch (_: Exception) { }
        }
    }

    fun toggleFavourite(s: ApiModels.Row) {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val a = _api.value ?: return@launch
                val saved = _favs.value.any { it.kind == s.kind && it.sourceId == s.sourceId }
                if (saved) a.removeFavourite(s.kind, s.sourceId)
                else a.addFavourite(s.kind, s.sourceId, s.title, s.cover)
                val r = a.getFavourites()
                if (r.code == 200) _favs.value = ApiModels.parseFavourites(r.body)
            } catch (_: Exception) { }
        }
    }

    private val _entries = MutableStateFlow(store.list())
    val entries: StateFlow<List<DownloadStore.Entry>> = _entries.asStateFlow()

    private val _dlMsg = MutableStateFlow("")
    val dlMsg: StateFlow<String> = _dlMsg.asStateFlow()

    private val cm = app.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    private val netCb = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) { _wifi.value = wifiNow() }
        override fun onLost(network: Network) { _wifi.value = wifiNow() }
        override fun onCapabilitiesChanged(n: Network, c: NetworkCapabilities) { _wifi.value = wifiNow() }
    }

    init {
        _wifi.value = wifiNow()
        try {
            cm.registerNetworkCallback(
                NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI).build(),
                netCb,
            )
        } catch (_: Exception) { }
        rebuildApi()
        viewModelScope.launch { startup() }
    }

    override fun onCleared() {
        try { cm.unregisterNetworkCallback(netCb) } catch (_: Exception) { }
    }

    fun wifiNow(): Boolean = try {
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
    } catch (_: Exception) { false }

    private fun rebuildApi() {
        _api.value = _server.value?.takeIf { it.isNotBlank() }?.let { AnimangaApi(it) }
    }

    // no saved server -> setup; else health -> hasSession? me : login (mirror old flow).
    private suspend fun startup() = withContext(Dispatchers.IO) {
        val a = _api.value ?: run { _startRoute.value = "setup"; return@withContext }
        try {
            if (a.get("/api/health").code != 200) { _startRoute.value = "setup"; return@withContext }
        } catch (_: Exception) { _startRoute.value = "setup"; return@withContext }
        if (!a.hasSession()) { _startRoute.value = "login"; return@withContext }
        try {
            val me = a.getMe()
            if (me.code == 401) { _startRoute.value = "login"; return@withContext }
            val st = lockedStatus(me.code, me.body) ?: ApiModels.appUserStatus(me.body)
            _startRoute.value = if (st == "pending" || st == "blocked") "pending" else "browse"
        } catch (_: Exception) { _startRoute.value = "browse" }
    }

    fun saveServer(base: String) {
        prefs.edit().putString("server", base).apply()
        _server.value = base
        rebuildApi()
    }

    fun setManualOffline(b: Boolean) {
        prefs.edit().putBoolean("offline", b).apply()
        _manualOffline.value = b
    }

    fun setAutoNoWifi(b: Boolean) {
        prefs.edit().putBoolean("autoNoWifi", b).apply()
        _autoNoWifi.value = b
    }

    suspend fun healthCheck(base: String): AnimangaApi.Resp = withContext(Dispatchers.IO) {
        AnimangaApi(base).get("/api/health")
    }

    suspend fun apiGet(path: String): AnimangaApi.Resp = withContext(Dispatchers.IO) {
        (_api.value ?: throw IllegalStateException("No server")).get(path)
    }

    suspend fun apiPost(path: String, json: String): AnimangaApi.Resp = withContext(Dispatchers.IO) {
        (_api.value ?: throw IllegalStateException("No server")).postJson(path, json)
    }

    suspend fun signOutAndClear() = withContext(Dispatchers.IO) {
        try { _api.value?.signOut() } catch (_: Exception) { }
        try { _api.value?.clearSession() } catch (_: Exception) { }
    }

    fun coverUrl(cover: String): String? {
        if (cover.isBlank()) return null
        if (cover.startsWith("http://") || cover.startsWith("https://")) return cover
        val b = _server.value ?: return null
        return if (cover.startsWith("/")) b + cover else "$b/$cover"
    }

    fun cookieHeader(): String = try { _api.value?.cookies()?.header() ?: "" } catch (_: Exception) { "" }

    fun refreshEntries() { _entries.value = store.list() }

    fun deleteEntry(kind: String, itemId: String) {
        store.delete(kind, itemId)
        refreshEntries()
    }

    fun clearDlMsg() { _dlMsg.value = "" }

    // POST /api/downloads -> poll GET /api/downloads up to ~4 min -> save file -> store.put.
    fun startDownload(series: ApiModels.Row, item: ApiModels.Row, lang: String, onDone: () -> Unit) {
        _dlMsg.value = "Queuing…"
        viewModelScope.launch(Dispatchers.IO) {
            val a = _api.value ?: run { _dlMsg.value = "No server"; return@launch }
            try {
                val kind = series.kind
                val r = a.postJson(
                    "/api/downloads",
                    "{\"kind\":\"" + kind + "\",\"sourceId\":\"" + ApiModels.esc(series.sourceId) +
                        "\",\"itemId\":\"" + ApiModels.esc(item.itemId) +
                        "\",\"title\":\"" + ApiModels.esc(series.title) +
                        "\",\"label\":\"" + ApiModels.esc(item.label.ifEmpty { item.title }) +
                        "\",\"cover\":null,\"lang\":\"" + lang + "\"}",
                )
                if (r.code != 201 && r.code != 200) {
                    _dlMsg.value = ApiModels.apiError(r.body, "Queue failed (" + r.code + ")")
                    return@launch
                }
                val jobId = ApiModels.extractId(r.body)
                if (jobId < 0) { _dlMsg.value = "Bad queue response"; return@launch }
                var status: String? = null
                for (i in 0 until 120) {
                    delay(2000)
                    try {
                        val list = a.get("/api/downloads")
                        if (list.code == 200) {
                            status = jobStatus(list.body, jobId)
                            _dlMsg.value = if (status == "done") "Saving…" else "Preparing…"
                            if (status == "done" || status == "error" || status == "failed") break
                        }
                    } catch (_: Exception) { _dlMsg.value = "Waiting for network…" }
                }
                if (status != "done") { _dlMsg.value = "Timed out — try again later"; return@launch }
                val ext = if (kind == "anime") "mp4" else "cbz"
                val name = ApiModels.safeFile(series.title + "-" + item.itemId) + "." + ext
                val dest = store.fileFor(name)
                _dlMsg.value = "Saving…"
                a.downloadToFile(AnimangaApi.downloadFile(jobId, kind == "anime"), dest, null)
                store.put(DownloadStore.Entry(kind, item.itemId, series.title, item.label.ifEmpty { item.title }, name, dest.length()))
                refreshEntries()
                _dlMsg.value = "done"
                withContext(Dispatchers.Main) { onDone() }
            } catch (e: Exception) {
                _dlMsg.value = e.message ?: "Download failed"
            }
        }
    }
}

data class WatchTarget(
    val episodeId: String,
    val animeId: String,
    val seriesTitle: String,
    val label: String,
    val lang: String,
)

data class Sso(val id: String, val label: String)

// 403 + {"status":"pending"|"blocked"} on requireUser endpoints; null otherwise.
fun lockedStatus(code: Int, body: String): String? {
    if (code != 403) return null
    val s = ApiModels.field(body, "status", "")
    return if (s == "pending" || s == "blocked") s else null
}

// tolerant scan: match "id":<jobId> then the "status" that follows it.
fun jobStatus(body: String, jobId: Int): String? {
    val idRe = Regex("\"id\"\\s*:\\s*(-?\\d+)")
    val stRe = Regex("\"status\"\\s*:\\s*\"([^\"]*)\"")
    for (m in idRe.findAll(body)) {
        if (m.groupValues[1].toIntOrNull() != jobId) continue
        val end = (m.range.first + 900).coerceAtMost(body.length)
        val st = stRe.find(body, m.range.first)?.takeIf { it.range.first < end }?.groupValues?.get(1)
        if (st != null) return st
    }
    return null
}

// {"providers":[{"id","label"}],"password":bool,...}
fun parseProviders(body: String): Pair<List<Sso>, Boolean> {
    val out = mutableListOf<Sso>()
    val ai = body.indexOf("\"providers\"")
    if (ai >= 0) {
        val s = body.indexOf('[', ai)
        val e = body.indexOf(']', ai)
        if (s >= 0 && e > s) {
            val seg = body.substring(s, e + 1)
            var depth = 0
            var start = -1
            for (i in seg.indices) {
                when (seg[i]) {
                    '{' -> { if (depth == 0) start = i; depth++ }
                    '}' -> {
                        depth--
                        if (depth == 0 && start >= 0) {
                            val o = seg.substring(start, i + 1)
                            val id = ApiModels.field(o, "id", "")
                            if (id.isNotEmpty()) out.add(Sso(id, ApiModels.field(o, "label", id)))
                            start = -1
                        }
                    }
                }
            }
        }
    }
    return out to (ApiModels.field(body, "password", "false") == "true")
}
