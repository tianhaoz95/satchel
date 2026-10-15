plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "dev.satchel.app"
    compileSdk = 37
    defaultConfig {
        // The Wear OS app uses the same application id so the Wearable Data Layer connects them.
        applicationId = "dev.satchel.android"
        minSdk = 28
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0"
        // Firebase is initialized from these (no google-services plugin); empty = push disabled.
        buildConfigField("String", "FIREBASE_APP_ID", "\"${providers.gradleProperty("satchel.firebase.appId").getOrElse("")}\"")
        buildConfigField("String", "FIREBASE_API_KEY", "\"${providers.gradleProperty("satchel.firebase.apiKey").getOrElse("")}\"")
        buildConfigField("String", "FIREBASE_PROJECT_ID", "\"${providers.gradleProperty("satchel.firebase.projectId").getOrElse("")}\"")
        buildConfigField("String", "FIREBASE_SENDER_ID", "\"${providers.gradleProperty("satchel.firebase.senderId").getOrElse("")}\"")
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation(project(":core"))
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
    implementation(libs.compose.icons.core)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.fragment.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.biometric)
    implementation(libs.gms.code.scanner)
    implementation(libs.gms.doc.scanner)
    implementation(libs.gms.wearable)
    implementation(libs.firebase.messaging)
    implementation(libs.kotlinx.coroutines.play.services)
}
