package dev.satchel.app

import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import dev.satchel.core.KeystoreKey
import dev.satchel.core.Signer
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class AuthCancelled : Exception("Authentication was cancelled")

/**
 * Biometric gate for the device key. The Keystore key only signs through a `Signature` that
 * BiometricPrompt authenticated (BIOMETRIC_STRONG, one use), so a stolen unlocked phone still
 * can't approve without the owner's fingerprint or face.
 */
class Authenticator(private val activity: FragmentActivity, private val skip: Boolean) {
    suspend fun sign(signer: Signer, message: String, title: String, subtitle: String): String {
        // Software keys (tests) and debug builds with -skipAuth sign directly.
        if (skip || signer !is KeystoreKey) return signer.signNow(message)
        val signature = signer.signature()
        return suspendCancellableCoroutine { cont ->
            val prompt = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    runCatching { signer.finish(result.cryptoObject!!.signature!!, message) }
                        .onSuccess { cont.resume(it) }
                        .onFailure { cont.resumeWithException(it) }
                }

                override fun onAuthenticationError(code: Int, msg: CharSequence) = cont.resumeWithException(AuthCancelled())
            })
            val info = BiometricPrompt.PromptInfo.Builder()
                .setTitle(title)
                .setSubtitle(subtitle)
                .setNegativeButtonText("Cancel")
                .setAllowedAuthenticators(BIOMETRIC_STRONG)
                .build()
            prompt.authenticate(info, BiometricPrompt.CryptoObject(signature))
            cont.invokeOnCancellation { prompt.cancelAuthentication() }
        }
    }

    /** Owner check without a key (showing a delivered value): biometrics or the screen lock. */
    suspend fun confirm(title: String): Boolean {
        if (skip) return true
        return suspendCancellableCoroutine { cont ->
            val prompt = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) = cont.resume(true)
                override fun onAuthenticationError(code: Int, msg: CharSequence) = cont.resume(false)
            })
            prompt.authenticate(BiometricPrompt.PromptInfo.Builder().setTitle(title).setAllowedAuthenticators(BIOMETRIC_STRONG or DEVICE_CREDENTIAL).build())
        }
    }
}
