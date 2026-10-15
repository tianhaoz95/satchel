plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "dev.satchel.core"
    compileSdk = 37
    defaultConfig { minSdk = 28 }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    testOptions {
        unitTests.all {
            // Conformance tests read spec/companion from the repo root and may write client signatures.
            it.systemProperty("satchel.repoRoot", rootProject.projectDir.resolve("../..").canonicalPath)
            it.environment("SATCHEL_TEST_PAIR_LINK", System.getenv("SATCHEL_TEST_PAIR_LINK") ?: "")
            it.environment("SATCHEL_WRITE_CLIENT_SIGNATURES", System.getenv("SATCHEL_WRITE_CLIENT_SIGNATURES") ?: "")
        }
    }
}


dependencies {
    api(libs.okhttp)
    api(libs.kotlinx.serialization.json)
    api(libs.kotlinx.coroutines.android)
    testImplementation(libs.junit)
}
