plugins {
    id("com.android.application")
}

android {
    namespace = "com.animanga.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.animanga.app"
        minSdk = 26
        targetSdk = 34
        versionCode = (System.getenv("APP_VERSION_CODE")?.toIntOrNull() ?: 1)
        versionName = (System.getenv("APP_VERSION")?.removePrefix("v") ?: "1.0.0")
    }

    signingConfigs {
        create("release") {
            // ponytail: file-based signing from CI secrets; absent locally = unsigned release build.
            val ks = System.getenv("ANDROID_KEYSTORE_FILE")
            if (!ks.isNullOrBlank()) {
                storeFile = file(ks)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (!System.getenv("ANDROID_KEYSTORE_FILE").isNullOrBlank()) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

// ponytail: zero external dependencies — HttpURLConnection + framework views only.
dependencies {
}
