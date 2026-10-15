package dev.satchel.core

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import kotlinx.serialization.json.Json
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Credentials sealed with a Keystore AES-GCM key and kept in app-private storage. */
class CredentialsStore(context: Context) {
    private val prefs = context.getSharedPreferences("satchel", Context.MODE_PRIVATE)
    private val alias = "satchel.credentials"

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(
                KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .build(),
            )
        }.generateKey()
    }

    fun load(): Credentials? = runCatching {
        val blob = B64.fromUrl(prefs.getString("credentials", null) ?: return null)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, blob.copyOfRange(0, 12))) }
        Json.decodeFromString<Credentials>(String(cipher.doFinal(blob.copyOfRange(12, blob.size))))
    }.getOrNull()

    fun save(c: Credentials) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val sealed = cipher.iv + cipher.doFinal(Json.encodeToString(Credentials.serializer(), c).toByteArray())
        prefs.edit().putString("credentials", B64.url(sealed)).apply()
    }

    fun clear() {
        prefs.edit().remove("credentials").apply()
    }
}
