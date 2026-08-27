plugins {
    id("com.android.application")
}

android {
    namespace = "com.codexpocket.mobile"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.codexpocket.mobile"
        minSdk = 23
        targetSdk = 35
        versionCode = 14
        versionName = "1.11.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    dependencies {
        implementation("androidx.activity:activity:1.8.2")
        implementation("androidx.work:work-runtime:2.11.2")
        implementation("com.journeyapps:zxing-android-embedded:4.3.0")
        implementation("com.google.zxing:core:3.5.2")
        testImplementation("junit:junit:4.13.2")
    }
}

configurations.all {
    resolutionStrategy.force(
        "org.jetbrains.kotlin:kotlin-stdlib:1.8.22",
        "org.jetbrains.kotlin:kotlin-stdlib-jdk7:1.8.22",
        "org.jetbrains.kotlin:kotlin-stdlib-jdk8:1.8.22"
    )
}
