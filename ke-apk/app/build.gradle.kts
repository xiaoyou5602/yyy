plugins {
    id("com.android.application")
}

android {
    namespace = "com.cyberboss.ke"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.cyberboss.ke"
        minSdk = 24
        targetSdk = 34
        versionCode = 15
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.9.0")
}
