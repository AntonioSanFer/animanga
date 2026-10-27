package com.animanga.app

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import coil.request.ImageRequest

val Bg = Color(0xFF0B0B12)
val Surface = Color(0xFF151522)
val Card = Color(0xFF1E1E2E)
val BodyText = Color(0xFFFFFFFF)
val Secondary = Color(0xFFA1A1B3)
val Muted = Color(0xFF71717A)
val Accent = Color(0xFFA855F7)
val Accent2 = Color(0xFF06B6D4)
val Danger = Color(0xFFEF4444)

@Composable
fun AppTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Accent,
            secondary = Accent2,
            background = Bg,
            surface = Surface,
            error = Danger,
            onBackground = BodyText,
            onSurface = BodyText,
        ),
        content = content,
    )
}

@Composable
fun OfflineBanner() {
    Box(
        Modifier.fillMaxWidth().background(Danger).padding(8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text("Offline — showing downloads", color = Color.White, fontSize = 13.sp)
    }
}

@Composable
fun CoverImage(url: String?, cookie: String, title: String, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    // ponytail: covers live on the user's LAN server like everything else —
    // ignore system proxies (the app's HttpURLConnection calls already bypass them).
    val loader = remember(context) {
        coil.ImageLoader.Builder(context)
            .okHttpClient(
                okhttp3.OkHttpClient.Builder()
                    .proxy(java.net.Proxy.NO_PROXY)
                    .build(),
            )
            .build()
    }
    if (url == null) {
        Box(modifier.background(Card), contentAlignment = Alignment.Center) {
            Text(title.take(1).uppercase(), color = Secondary, fontWeight = FontWeight.Bold, fontSize = 28.sp)
        }
    } else {
        AsyncImage(
            model = ImageRequest.Builder(context).data(url)
                .apply { if (cookie.isNotEmpty()) addHeader("Cookie", cookie) }
                .listener(object : coil.request.ImageRequest.Listener {
                    override fun onError(request: coil.request.ImageRequest, result: coil.request.ErrorResult) {
                        android.util.Log.e("Cover", "load failed: $url", result.throwable)
                    }
                })
                .crossfade(true).build(),
            imageLoader = loader,
            contentDescription = title,
            modifier = modifier,
            contentScale = ContentScale.Crop,
        )
    }
}
