package com.animanga.app

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch

@Composable
fun SetupScreen(vm: AppViewModel, onDone: () -> Unit) {
    val saved by vm.server.collectAsStateWithLifecycle()
    var domain by remember(saved) { mutableStateOf(saved ?: "") }
    var status by remember { mutableStateOf("") }
    var ok by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    Column(
        Modifier.fillMaxSize().background(Bg).padding(24.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.Center,
    ) {
        Text("AniManga", color = BodyText, fontSize = 32.sp, fontWeight = FontWeight.Bold)
        Text("Self-hosted anime & manga", color = Secondary, fontSize = 15.sp)
        Spacer(Modifier.height(24.dp))
        OutlinedTextField(
            value = domain, onValueChange = { domain = it }, label = { Text("Server domain") },
            singleLine = true, modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(8.dp))
        if (status.isNotEmpty()) Text(status, color = if (ok) Accent2 else Danger, fontSize = 14.sp)
        Spacer(Modifier.height(8.dp))
        Button(
            onClick = {
                scope.launch {
                    busy = true
                    ok = false
                    status = "Checking…"
                    try {
                        val base = ServerConfig.normalize(domain)
                        val r = vm.healthCheck(base)
                        if (r.code == 200) {
                            vm.saveServer(base)
                            status = ""
                            onDone()
                        } else {
                            status = "Server error (${r.code})"
                        }
                    } catch (e: IllegalArgumentException) {
                        status = e.message ?: "Invalid server URL"
                    } catch (e: Exception) {
                        status = "Unreachable: ${e.message}"
                    }
                    busy = false
                }
            },
            enabled = !busy, modifier = Modifier.fillMaxWidth(),
        ) { Text(if (busy) "Checking…" else "Save & Connect") }
    }
}

@Composable
fun LoginScreen(vm: AppViewModel, onBrowse: () -> Unit, onPending: () -> Unit) {
    val base by vm.server.collectAsStateWithLifecycle()
    var providers by remember { mutableStateOf<List<Sso>>(emptyList()) }
    var pwEnabled by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(true) }
    var loadErr by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var create by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()

    suspend fun loadProviders() {
        loading = true
        loadErr = ""
        try {
            val r = vm.apiGet("/api/providers")
            if (r.code == 200) {
                val (list, pw) = parseProviders(r.body)
                providers = list
                pwEnabled = pw
            } else {
                loadErr = "Could not load sign-in options (${r.code})"
            }
        } catch (e: Exception) {
            loadErr = e.message ?: "Network error"
        }
        loading = false
    }
    LaunchedEffect(Unit) { loadProviders() }

    fun afterAuth(code: Int, body: String) {
        scope.launch {
            if (code != 200) {
                err = ApiModels.apiError(body, "Sign in failed ($code)")
                busy = false
                return@launch
            }
            try {
                val me = vm.apiGet("/api/me")
                busy = false
                if (me.code == 401) {
                    err = "Not signed in — try again"
                    return@launch
                }
                val st = lockedStatus(me.code, me.body) ?: ApiModels.appUserStatus(me.body)
                if (st == "pending" || st == "blocked") onPending() else onBrowse()
            } catch (e: Exception) {
                busy = false
                err = e.message ?: "Network error"
            }
        }
    }

    Column(
        Modifier.fillMaxSize().background(Bg).padding(24.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.Center,
    ) {
        Text("AniManga", color = BodyText, fontSize = 32.sp, fontWeight = FontWeight.Bold)
        Text("Sign in to continue", color = Secondary, fontSize = 15.sp)
        Spacer(Modifier.height(24.dp))
        if (base == null) {
            Text("No server configured — set it up first.", color = Danger, fontSize = 14.sp)
        } else if (loading) {
            Text("Loading sign-in options…", color = Secondary, fontSize = 14.sp)
        } else if (loadErr.isNotEmpty()) {
            Text(loadErr, color = Danger, fontSize = 14.sp)
            Spacer(Modifier.height(8.dp))
            OutlinedButton(onClick = { scope.launch { loadProviders() } }) { Text("Retry") }
        } else {
            for (p in providers) {
                OutlinedButton(
                    onClick = {
                        ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(base + "/")))
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Continue with ${p.label}") }
                Spacer(Modifier.height(8.dp))
            }
            if (providers.isNotEmpty() && pwEnabled) {
                Text("or", color = Muted, fontSize = 14.sp)
                Spacer(Modifier.height(8.dp))
            }
            if (pwEnabled) {
                OutlinedTextField(
                    value = email, onValueChange = { email = it }, label = { Text("Email") },
                    singleLine = true, modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = password, onValueChange = { password = it }, label = { Text("Password") },
                    singleLine = true, visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth(),
                )
                if (create) {
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = name, onValueChange = { name = it }, label = { Text("Name") },
                        singleLine = true, modifier = Modifier.fillMaxWidth(),
                    )
                }
                Spacer(Modifier.height(4.dp))
                Text(
                    "The first account to sign up becomes admin.",
                    color = Muted, fontSize = 13.sp,
                )
                if (err.isNotEmpty()) {
                    Spacer(Modifier.height(4.dp))
                    Text(err, color = Danger, fontSize = 14.sp)
                }
                Spacer(Modifier.height(8.dp))
                Button(
                    onClick = {
                        busy = true
                        err = ""
                        scope.launch {
                            try {
                                val r = if (create) {
                                    vm.apiPost(
                                        "/api/auth/sign-up/email",
                                        "{\"email\":\"" + ApiModels.esc(email.trim()) + "\",\"password\":\"" +
                                            ApiModels.esc(password) + "\",\"name\":\"" +
                                            ApiModels.esc(if (name.trim().isEmpty()) email.trim().substringBefore("@") else name.trim()) + "\"}",
                                    )
                                } else {
                                    vm.apiPost(
                                        "/api/auth/sign-in/email",
                                        "{\"email\":\"" + ApiModels.esc(email.trim()) + "\",\"password\":\"" +
                                            ApiModels.esc(password) + "\"}",
                                    )
                                }
                                afterAuth(r.code, r.body)
                            } catch (e: Exception) {
                                busy = false
                                err = e.message ?: "Network error"
                            }
                        }
                    },
                    enabled = !busy && email.isNotBlank() && password.isNotEmpty(),
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = Accent),
                ) { Text(if (busy) "Please wait…" else if (create) "Create account" else "Sign in") }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                    TextButton(onClick = { create = !create; err = "" }) {
                        Text(
                            if (create) "Have an account? Sign in" else "New here? Create an account",
                            color = Accent2, fontSize = 14.sp,
                        )
                    }
                }
            } else if (providers.isEmpty()) {
                Text("No sign-in methods enabled on this server.", color = Danger, fontSize = 14.sp)
            }
            Text(
                "SSO users sign in on the site — email users sign in here.",
                color = Muted, fontSize = 13.sp,
            )
        }
    }
}

@Composable
fun PendingScreen(vm: AppViewModel, onLogin: () -> Unit) {
    val scope = rememberCoroutineScope()
    Column(
        Modifier.fillMaxSize().background(Bg).padding(24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text("Approval pending", color = BodyText, fontSize = 28.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        Text(
            "Your account is waiting for approval (or has been blocked). Ask an admin, then sign in again.",
            color = Secondary, fontSize = 15.sp,
        )
        Spacer(Modifier.height(24.dp))
        Button(
            onClick = {
                scope.launch {
                    vm.signOutAndClear()
                    onLogin()
                }
            },
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF3F3F4D)),
        ) { Text("Sign out", color = BodyText) }
    }
}
