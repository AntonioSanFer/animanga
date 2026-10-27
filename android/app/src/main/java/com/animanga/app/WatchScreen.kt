package com.animanga.app

import android.net.Uri
import android.view.ViewGroup
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView

@Composable
fun WatchScreen(
    vm: AppViewModel,
    onBack: () -> Unit,
    onDownloaded: () -> Unit,
) {
    val target by vm.watch.collectAsStateWithLifecycle()
    val entries by vm.entries.collectAsStateWithLifecycle()
    val dlMsg by vm.dlMsg.collectAsStateWithLifecycle()
    val t = target
    if (t == null) {
        Text("Nothing to play", color = Secondary, modifier = Modifier.padding(16.dp))
        return
    }
    val context = LocalContext.current
    val base = vm.server.collectAsStateWithLifecycle().value ?: ""
    var eps by remember(t.animeId) { mutableStateOf<List<ApiModels.Row>>(emptyList()) }
    var playerError by remember(t.episodeId, t.lang) { mutableStateOf(false) }

    LaunchedEffect(t.animeId) {
        try {
            val r = vm.apiGet(AnimangaApi.animeEpisodes(t.animeId))
            if (r.code == 200) eps = ApiModels.parseRows(r.body, "episode")
        } catch (_: Exception) { }
    }

    val entry = entries.firstOrNull { it.kind == "anime" && it.itemId == t.episodeId }
    val localFile = remember(entry) { entry?.let { vm.store.fileFor(it.fileName) }?.takeIf { it.exists() } }
    // ponytail: cookie read once per player build, not per frame.
    val cookie = remember(t.episodeId, t.lang) { vm.cookieHeader() }

    val exo = remember(t.episodeId, t.lang, localFile) {
        val http = DefaultHttpDataSource.Factory()
            .setDefaultRequestProperties(mapOf("Cookie" to cookie))
        val mediaSourceFactory = DefaultMediaSourceFactory(DefaultDataSource.Factory(context, http))
        ExoPlayer.Builder(context).setMediaSourceFactory(mediaSourceFactory).build().apply {
            addListener(object : Player.Listener {
                override fun onPlayerError(error: PlaybackException) { playerError = true }
            })
            val uri = if (localFile != null) Uri.fromFile(localFile).toString()
                else base + AnimangaApi.animeStream(t.episodeId, t.lang)
            val item = if (localFile == null && t.lang == "sub") {
                MediaItem.Builder().setUri(uri)
                    .setSubtitleConfigurations(
                        listOf(
                            MediaItem.SubtitleConfiguration.Builder(Uri.parse(base + AnimangaApi.animeSubtitle(t.episodeId, t.lang)))
                                .setMimeType(MimeTypes.TEXT_VTT).setLanguage("en")
                                .setSelectionFlags(C.SELECTION_FLAG_DEFAULT).build(),
                        ),
                    ).build()
            } else {
                MediaItem.fromUri(uri)
            }
            setMediaItem(item)
            prepare()
            playWhenReady = true
        }
    }
    DisposableEffect(t.episodeId, t.lang, localFile) { onDispose { exo.release() } }

    val idx = eps.indexOfFirst { it.itemId == t.episodeId }
    val prev = if (idx > 0) eps[idx - 1] else null
    val next = if (idx >= 0 && idx < eps.size - 1) eps[idx + 1] else null
    fun jump(ep: ApiModels.Row) {
        playerError = false
        vm.watch.value = WatchTarget(ep.itemId, t.animeId, t.seriesTitle, ep.label.ifEmpty { ep.title }, t.lang)
    }

    Column(Modifier.fillMaxSize().background(Bg)) {
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("‹ Back", color = Accent2) }
            Spacer(Modifier.weight(1f))
            TextButton(onClick = { prev?.let(::jump) }, enabled = prev != null) {
                Text("Prev", color = if (prev != null) Accent2 else Muted)
            }
            TextButton(onClick = { next?.let(::jump) }, enabled = next != null) {
                Text("Next", color = if (next != null) Accent2 else Muted)
            }
        }
        Text(
            t.seriesTitle,
            color = BodyText, fontSize = 18.sp, fontWeight = FontWeight.Bold,
            maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(horizontal = 16.dp),
        )
        Row(Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(t.label, color = Secondary, fontSize = 13.sp)
            Spacer(Modifier.width(8.dp))
            Text(t.lang.uppercase(), color = Accent2, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.width(8.dp))
            Text(if (localFile != null) "On phone" else "Server stream", color = Muted, fontSize = 12.sp)
        }
        Spacer(Modifier.height(8.dp))
        AndroidView(
            factory = { ctx ->
                PlayerView(ctx).apply { player = exo; useController = true; layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT) }
            },
            modifier = Modifier.fillMaxWidth().weight(1f).background(androidx.compose.ui.graphics.Color.Black),
        )
        if (playerError) {
            Text("The stream could not be loaded.", color = Danger, fontSize = 14.sp, modifier = Modifier.padding(16.dp))
        }
        if (localFile == null) {
            if (dlMsg.isNotEmpty() && dlMsg != "done") {
                Text(dlMsg, color = Accent2, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 16.dp))
            }
            Button(
                onClick = {
                    val series = ApiModels.Row().apply {
                        kind = "anime"; sourceId = t.animeId; itemId = t.animeId; title = t.seriesTitle
                    }
                    val item = ApiModels.Row().apply {
                        kind = "anime"; sourceId = t.animeId; itemId = t.episodeId; title = t.label; label = t.label
                    }
                    vm.startDownload(series, item, t.lang) { onDownloaded() }
                },
                modifier = Modifier.fillMaxWidth().padding(16.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Accent),
            ) { Text("Save to device") }
        } else {
            Spacer(Modifier.height(16.dp))
        }
    }
}
