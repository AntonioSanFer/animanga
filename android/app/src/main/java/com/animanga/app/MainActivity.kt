package com.animanga.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            AppTheme {
                val vm: AppViewModel = viewModel()
                val start by vm.startRoute.collectAsStateWithLifecycle()
                if (start == "loading") {
                    Box(Modifier.fillMaxSize().background(Bg), contentAlignment = Alignment.Center) {
                        Text("AniManga", color = BodyText, fontSize = 28.sp, fontWeight = FontWeight.Bold)
                    }
                } else {
                    AppNav(vm, start)
                }
            }
        }
    }
}

// ponytail: pop everything then navigate — no fragile popUpTo route bookkeeping.
fun NavController.resetTo(route: String) {
    while (popBackStack()) { }
    navigate(route)
}

@Composable
fun AppNav(vm: AppViewModel, start: String) {
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route
    val showBar = route == "browse" || route == "favourites" || route == "downloaded" || route == "settings"
    Scaffold(
        containerColor = Bg,
        bottomBar = { if (showBar) BottomTabs(nav, route) },
    ) { pad ->
        Box(Modifier.padding(pad)) {
            NavHost(navController = nav, startDestination = start) {
                composable("setup") { SetupScreen(vm) { nav.resetTo("login") } }
                composable("login") {
                    LoginScreen(vm, onBrowse = { nav.resetTo("browse") }, onPending = { nav.resetTo("pending") })
                }
                composable("pending") { PendingScreen(vm) { nav.resetTo("login") } }
                composable("browse") {
                    BrowseScreen(
                        vm,
                        goDetail = { nav.navigate("detail") },
                        goDownloaded = { nav.navigate("downloaded") { popUpTo("browse") { inclusive = true } } },
                        onLogin = { nav.resetTo("login") },
                        onLocked = { nav.resetTo("pending") },
                    )
                }
                composable("detail") {
                    DetailScreen(
                        vm,
                        onBack = { nav.popBackStack() },
                        onDownloaded = { nav.navigate("downloaded") },
                        onLogin = { nav.resetTo("login") },
                        onLocked = { nav.resetTo("pending") },
                        onPlay = { nav.navigate("watch") },
                    )
                }
                composable("favourites") {
                    FavouritesScreen(vm, goDetail = { nav.navigate("detail") })
                }
                composable("watch") {
                    WatchScreen(
                        vm,
                        onBack = { nav.popBackStack() },
                        onDownloaded = { nav.navigate("downloaded") },
                    )
                }
                composable("downloaded") { DownloadedScreen(vm) }
                composable("settings") {
                    SettingsScreen(vm, onSetup = { nav.navigate("setup") }, onLogin = { nav.resetTo("login") })
                }
            }
        }
    }
}

@Composable
fun BottomTabs(nav: NavController, route: String?) {
    Row(
        Modifier.fillMaxWidth().background(Surface).padding(8.dp),
        horizontalArrangement = Arrangement.SpaceEvenly,
    ) {
        for ((r, label) in listOf("browse" to "Browse", "favourites" to "Favourites", "downloaded" to "Downloaded", "settings" to "Settings")) {
            val active = route == r
            TextButton(onClick = { if (!active) nav.navigate(r) { launchSingleTop = true } }) {
                Text(
                    label,
                    color = if (active) Accent else Secondary,
                    fontWeight = if (active) FontWeight.Bold else FontWeight.Normal,
                )
            }
        }
    }
}
