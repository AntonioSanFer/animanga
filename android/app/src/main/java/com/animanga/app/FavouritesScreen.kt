package com.animanga.app

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@Composable
fun FavouritesScreen(vm: AppViewModel, goDetail: () -> Unit) {
    val favs by vm.favs.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { vm.loadFavourites() }
    Column(Modifier.fillMaxSize().background(Bg)) {
        Column(Modifier.padding(horizontal = 16.dp)) {
            Spacer(Modifier.height(12.dp))
            Text("Favourites", color = BodyText, fontSize = 26.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
        }
        if (favs.isEmpty()) {
            Text("Nothing saved yet — tap ♥ on a series.", color = Secondary, fontSize = 14.sp, modifier = Modifier.padding(horizontal = 16.dp))
        }
        LazyVerticalGrid(
            columns = GridCells.Fixed(3),
            modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(favs, key = { it.kind + ":" + it.sourceId }) { f ->
                Column(
                    Modifier.clickable {
                        vm.selected.value = ApiModels.Row().apply {
                            kind = f.kind
                            sourceId = f.sourceId
                            itemId = f.sourceId
                            title = f.title
                            cover = f.cover
                            label = f.kind
                        }
                        goDetail()
                    },
                ) {
                    CoverImage(vm.coverUrl(f.cover), vm.cookieHeader(), f.title, Modifier.fillMaxWidth().aspectRatio(0.75f).clip(RoundedCornerShape(8.dp)))
                    Spacer(Modifier.height(4.dp))
                    Text(f.title, color = BodyText, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}
