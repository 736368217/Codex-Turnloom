plugins {
    id("com.android.application")
}

android {
    namespace = "com.codex.turnloom.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.codex.turnloom.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 83
        versionName = "2.1.2"
        testInstrumentationRunner = "android.test.InstrumentationTestRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            // unsigned -> zipalign -p 4 -> apksigner by scripts/build-single-app.ps1
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

dependencies {
    // Real embedded ZXing camera preview + QR decoder. androidx.core is
    // required by the library's CaptureManager permission handling.
    implementation("com.journeyapps:zxing-android-embedded:4.3.0") {
        exclude(group = "androidx.activity")
        exclude(group = "androidx.fragment")
    }
    implementation("com.google.zxing:core:3.5.4")
    implementation("androidx.core:core:1.12.0")
    implementation("androidx.annotation:annotation:1.6.0")

    // Local JVM tests for URL/request/update validation; no emulator.
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
