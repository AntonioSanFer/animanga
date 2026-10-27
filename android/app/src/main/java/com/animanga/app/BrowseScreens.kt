package com.animanga.app

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.Locale

@Composable
fun BrowseScreen(
    vm: AppViewModel,
    goDetail: () -> Unit,
    goDownloaded: () -> Unit,
    onLogin: () -> Unit,
    onLocked: () -> Unit,
) {
    val offline by vm.offline.collectAsStateWithLifecycle()
    var tab by rememberSaveable { mutableStateOf("manga") }
    var query by rememberSaveable { mutableStateOf("") }
    var rows by remember { mutableStateOf<List<ApiModels.Row>>(emptyList()) }
    var err by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }

    LaunchedEffect(offline) {
        if (offline) goDownloaded()
    }
    LaunchedEffect(tab, query, offline) {
        if (offline) return@LaunchedEffect
        if (query.isNotEmpty()) delay(400)
        loading = true
        err = ""
        try {
            val q = query.trim()
            val path = if (tab == "manga") {
                if (q.isEmpty()) "/api/manga/popular?lang=en&page=1" else AnimangaApi.mangaSearch(q, "en", 1)
            } else {
                if (q.isEmpty()) "/api/anime/popular?page=1" else AnimangaApi.animeSearch(q, 1)
            }
            val r = vm.apiGet(path)
            when {
                r.code == 200 -> rows = ApiModels.parseRows(r.body, tab)
                r.code == 401 -> onLogin()
                lockedStatus(r.code, r.body) != null -> onLocked()
                else -> err = ApiModels.apiError(r.body, "Load failed (${r.code})")
            }
        } catch (e: Exception) {
            err = e.message ?: "Network error"
        }
        loading = false
    }

    Column(Modifier.fillMaxSize().background(Bg)) {
        if (offline) OfflineBanner()
        Column(Modifier.padding(horizontal = 16.dp)) {
            Spacer(Modifier.height(12.dp))
            Text("Browse", color = BodyText, fontSize = 26.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(Surface).padding(4.dp)) {
                for ((id, label) in listOf("manga" to "Manga", "anime" to "Anime")) {
                    val active = tab == id
                    TextButton(
                        onClick = { tab = id },
                        modifier = Modifier.weight(1f).clip(RoundedCornerShape(20.dp))
                            .background(if (active) Accent else androidx.compose.ui.graphics.Color.Transparent),
                    ) { Text(label, color = if (active) BodyText else Secondary, fontWeight = FontWeight.Bold) }
                }
            }
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = query, onValueChange = { query = it }, label = { Text("Search") },
                singleLine = true, modifier = Modifier.fillMaxWidth(),
            )
            if (err.isNotEmpty()) Text(err, color = Danger, fontSize = 13.sp)
            if (loading && rows.isEmpty()) Text("Loading…", color = Secondary, fontSize = 14.sp)
        }
        LazyVerticalGrid(
            columns = GridCells.Fixed(3),
            modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(rows, key = { it.kind + ":" + it.itemId }) { r ->
                Column(Modifier.clickable { vm.selected.value = r; goDetail() }) {
                    CoverImage(vm.coverUrl(r.cover), vm.cookieHeader(), r.title, Modifier.fillMaxWidth().aspectRatio(0.75f).clip(RoundedCornerShape(8.dp)))
                    Spacer(Modifier.height(4.dp))
                    Text(r.title, color = BodyText, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(r.label, color = Muted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}

@Composable
fun DetailScreen(
    vm: AppViewModel,
    onBack: () -> Unit,
    onDownloaded: () -> Unit,
    onLogin: () -> Unit,
    onLocked: () -> Unit,
) {
    val series by vm.selected.collectAsStateWithLifecycle()
    val entries by vm.entries.collectAsStateWithLifecycle()
    val dlMsg by vm.dlMsg.collectAsStateWithLifecycle()
    var desc by remember { mutableStateOf("") }
    var items by remember { mutableStateOf<List<ApiModels.Row>>(emptyList()) }
    var err by remember { mutableStateOf("") }
    var busyId by remember { mutableStateOf<String?>(null) }
    val s = series

    LaunchedEffect(s?.itemId) {
        vm.clearDlMsg()
        busyId = null
        if (s == null) return@LaunchedEffect
        err = ""
        try {
            val d = vm.apiGet(
                if (s.kind == "anime") "/api/anime/" + AnimangaApi.encode(s.sourceId)
                else "/api/manga/" + AnimangaApi.encode(s.sourceId),
            )
            when {
                d.code == 200 -> desc = ApiModels.field(d.body, "description", "")
                d.code == 401 -> { onLogin(); return@LaunchedEffect }
                lockedStatus(d.code, d.body) != null -> { onLocked(); return@LaunchedEffect }
                else -> err = ApiModels.apiError(d.body, "Load failed (${d.code})")
            }
            val path = if (s.kind == "anime") "/api/anime/" + AnimangaApi.encode(s.sourceId) + "/episodes"
            else AnimangaApi.mangaChapters(s.sourceId, "en")
            val c = vm.apiGet(path)
            when {
                c.code == 200 -> {
                    val kind = if (s.kind == "anime") "episode" else "chapter"
                    items = ApiModels.parseRows(c.body, kind).map {
                        it.sourceId = s.sourceId
                        it
                    }
                }
                c.code == 401 -> onLogin()
                lockedStatus(c.code, c.body) != null -> onLocked()
                else -> err = ApiModels.apiError(c.body, "Load failed (${c.code})")
            }
        } catch (e: Exception) {
            err = e.message ?: "Network error"
        }
    }

    if (s == null) {
        Box(Modifier.fillMaxSize().background(Bg), contentAlignment = Alignment.Center) {
            Text("Nothing selected", color = Secondary)
        }
        return
    }
    Column(Modifier.fillMaxSize().background(Bg).verticalScroll(rememberScrollState()).padding(16.dp)) {
        TextButton(onClick = onBack) { Text("‹ Back", color = Accent2) }
        Row {
            CoverImage(vm.coverUrl(s.cover), vm.cookieHeader(), s.title, Modifier.width(120.dp).aspectRatio(0.75f).clip(RoundedCornerShape(8.dp)))
            Spacer(Modifier.width(12.dp))
            Column {
                Text(s.title, color = BodyText, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                Text(s.label, color = Secondary, fontSize = 14.sp)
            }
        }
        if (desc.isNotEmpty()) {
            Spacer(Modifier.height(12.dp))
            Text(desc, color = Secondary, fontSize = 14.sp)
        }
        if (err.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            Text(err, color = Danger, fontSize = 13.sp)
        }
        if (dlMsg.isNotEmpty() && dlMsg != "done") {
            Spacer(Modifier.height(8.dp))
            Text(dlMsg, color = Accent2, fontSize = 13.sp)
        }
        Spacer(Modifier.height(12.dp))
        Text(if (s.kind == "anime") "Episodes" else "Chapters", color = BodyText, fontSize = 18.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        for (row in items) {
            val saved = entries.any { it.kind == s.kind && it.itemId == row.itemId }
            Row(
                Modifier.fillMaxWidth().padding(vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(row.title, color = BodyText, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(row.label, color = Muted, fontSize = 12.sp)
                        if (saved) {
                            Spacer(Modifier.width(6.dp))
                            Text("Saved", color = Accent2, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
                Button(
                    onClick = {
                        busyId = row.itemId
                        vm.startDownload(s, row, if (s.kind == "anime") "sub" else "en") {
                            busyId = null
                            onDownloaded()
                        }
                    },
                    enabled = busyId == null,
                    colors = ButtonDefaults.buttonColors(containerColor = Accent),
                ) { Text(if (busyId == row.itemId) "…" else "Download", fontSize = 13.sp) }
            }
        }
        if (items.isEmpty() && err.isEmpty()) Text("No chapters yet.", color = Muted, fontSize = 14.sp)
    }
}

fun fmtMB(bytes: Long): String {
    val mb = bytes / 1048576.0
    return if (mb >= 10) "${mb.toInt()} MB" else String.format(Locale.US, "%.1f MB", mb)
}

@Composable
fun DownloadedScreen(vm: AppViewModel) {
    val offline by vm.offline.collectAsStateWithLifecycle()
    val entries by vm.entries.collectAsStateWithLifecycle()
    val ctx = LocalContext.current
    LaunchedEffect(Unit) { vm.refreshEntries() }
    var used by remember { mutableStateOf(0L) }
    LaunchedEffect(entries) {
        used = try { vm.store.bytesUsed() } catch (_: Exception) { 0L }
    }
    Column(Modifier.fillMaxSize().background(Bg)) {
        if (offline) OfflineBanner()
        Column(Modifier.padding(16.dp)) {
            Text("Downloaded", color = BodyText, fontSize = 26.sp, fontWeight = FontWeight.Bold)
            Text("${entries.size} on phone · ${fmtMB(used)} used", color = Secondary, fontSize = 14.sp)
        }
        LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
            items(entries, key = { it.kind + ":" + it.itemId }) { e ->
                Row(
                    Modifier.fillMaxWidth().padding(vertical = 8.dp)
                        .clickable {
                            Toast.makeText(ctx, e.fileName, Toast.LENGTH_SHORT).show()
                        },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(e.title, color = BodyText, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(
                            "${e.label} · ${e.fileName} · ${fmtMB(e.size)}",
                            color = Muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                    }
                    TextButton(onClick = { vm.deleteEntry(e.kind, e.itemId) }) {
                        Text("×", color = Danger, fontSize = 22.sp)
                    }
                }
            }
        }
    }
}

@Composable
fun SettingsScreen(vm: AppViewModel, onSetup: () -> Unit, onLogin: () -> Unit) {
    val manual by vm.manualOffline.collectAsStateWithLifecycle()
    val auto by vm.autoNoWifi.collectAsStateWithLifecycle()
    val server by vm.server.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxSize().background(Bg).padding(16.dp)) {
        Text("Settings", color = BodyText, fontSize = 26.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(16.dp))
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Offline mode", color = BodyText, fontSize = 16.sp)
                Text("Use downloaded files only", color = Secondary, fontSize = 13.sp)
            }
            Switch(checked = manual, onCheckedChange = { vm.setManualOffline(it) })
        }
        Spacer(Modifier.height(12.dp))
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Auto-offline on no Wi-Fi", color = BodyText, fontSize = 16.sp)
                Text("Go offline when Wi-Fi drops", color = Secondary, fontSize = 13.sp)
            }
            Switch(checked = auto, onCheckedChange = { vm.setAutoNoWifi(it) })
        }
        Spacer(Modifier.height(16.dp))
        Text("Server", color = BodyText, fontSize = 16.sp)
        Text(server ?: "Not set", color = Secondary, fontSize = 14.sp)
        Spacer(Modifier.height(8.dp))
        Button(onClick = onSetup, modifier = Modifier.fillMaxWidth()) { Text("Change") }
        Spacer(Modifier.height(8.dp))
        Button(
            onClick = {
                scope.launch {
                    vm.signOutAndClear()
                    onLogin()
                }
            },
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = Danger),
        ) { Text("Sign out") }
    }
}
