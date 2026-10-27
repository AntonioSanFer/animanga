# AniManga Android

Native APK (Jetpack Compose UI, dependency-free HTTP core) that talks to the
same Bun+Hono backend as the webapp.

Design: 5 Pencil screens — 01 Server Setup, 02 Browse, 03 Detail, 04 Downloaded, 05 Offline Settings.

## Structure

- `app/src/main/java/com/animanga/app/ServerConfig.java` — domain normalize/validate
- `app/src/main/java/com/animanga/app/CookieJar.java` — multi-cookie session jar
- `app/src/main/java/com/animanga/app/AnimangaApi.java` — HttpURLConnection client for
  `/api/health`, `/api/providers`, `/api/me`, `/api/auth/*` (native email
  sign-up/sign-in/sign-out, `Origin` header included for better-auth),
  `/api/manga/*`, `/api/anime/*`, `/api/downloads*` (same routes as `src/server/api.ts`);
  downloads use the server queue (`POST /api/downloads` → poll → `GET /api/downloads/:id/file`),
  then save bytes to phone storage.
- `app/src/main/java/com/animanga/app/ApiModels.java` — dependency-free JSON row parsing
- `app/src/main/java/com/animanga/app/DownloadStore.java` — on-phone registry (JSONL + files)
- `app/src/main/java/com/animanga/app/OfflinePolicy.java` — `manual || (auto && !wifi)`
- `MainActivity.kt`, `AppViewModel.kt`, `Theme.kt`, `SetupLoginScreens.kt`,
  `BrowseScreens.kt` — Compose UI (Material3 dark theme matching the Pencil tokens).
  Login is native email/password mirroring web `Accounts.tsx` (SSO buttons open the
  system browser); no WebView anywhere. Covers via Coil, session cookie header,
  system proxy bypassed (covers live on the user's LAN server).

## Build APK (Android Studio SDK)

```powershell
# Uses the Studio SDK via local.properties (sdk.dir) — no extra setup.
cd android
./gradlew assembleDebug
# APK: app/build/outputs/apk/debug/app-debug.apk
```

Verified 2026-10-27 with Gradle 8.11.1 + AGP 8.9.2 + `platforms/android-34`:
`BUILD SUCCESSFUL`, installed on Pixel_7 emulator via `adb install -r`,
app launches, connects to host backend over `http://10.0.2.2:3000`,
offline banner + Downloaded list + auth-gating (401 → Setup) all confirmed on-device.

`MainActivity` targets `minSdk 26`. Kotlin 2.0.21 + Compose BOM (Material3,
navigation, lifecycle-viewmodel) + Coil for covers; the HTTP/auth core stays
dependency-free and JVM-tested (see below).

## Release signing (one-time setup)

Tagging `v*` triggers the `release` job, which builds a signed `app-release.apk`
(+ `app-release.aab` for the Play Store) with versionName = tag without the `v`,
and attaches both to the GitHub Release. It needs four repo secrets:

```powershell
# 1. create a keystore (keep the passwords + file somewhere safe, outside the repo)
keytool -genkeypair -keystore animanga-release.jks -alias animanga `
  -keyalg RSA -keysize 2048 -validity 9125

# 2. upload as secrets (repo Settings → Secrets → Actions, or via gh cli)
[Convert]::ToBase64String([IO.File]::ReadAllBytes("animanga-release.jks")) | gh secret set ANDROID_KEYSTORE_BASE64
gh secret set ANDROID_KEYSTORE_PASSWORD   # read with Read-Host -AsSecureString, confirm on prompt
gh secret set ANDROID_KEY_ALIAS            # e.g. animanga
gh secret set ANDROID_KEY_PASSWORD
```

Without these secrets the `release` job fails fast with a message pointing here;
`assembleRelease` without `ANDROID_KEYSTORE_FILE` still builds locally, unsigned.

## Test core without Android SDK

```powershell
cd android
javac -d out core-test/RunTests.java app/src/main/java/com/animanga/app/*.java
java -cp out RunTests                      # offline unit tests
# end-to-end vs live backend:
$b = Start-Job { bun run start }            # from repo root, or: bun src/server/index.ts
java -cp out RunTests --live http://localhost:3000
```

Live checks: `/api/health` = 200, unauthenticated `/api/downloads` = 401 (proves auth wiring),
`/api/manga/popular` reachable shape, download URL builders for chapter CBZ + anime MP4,
native auth round-trip (signup → me → bad-login 401 → signout → me 401 → signin).
Run the dev server with `AUTH_PASSWORD_ENABLED=1` for the auth checks.
