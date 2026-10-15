package dev.satchel.core

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec

/**
 * A P-256 key in the Android Keystore (StrongBox when available). With [requireBiometrics] every
 * signature needs a BiometricPrompt-authenticated `Signature` (BIOMETRIC_STRONG, per use); the
 * watch uses an unlocked-device requirement instead. The private key never leaves secure hardware.
 */
class KeystoreKey private constructor(val alias: String) : Signer {
    private val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private val privateKey: PrivateKey get() = store.getKey(alias, null) as PrivateKey

    override val publicKey: String get() = B64.url(store.getCertificate(alias).publicKey.encoded)

    override val isHardware: Boolean get() = runCatching {
        val info = KeyFactory.getInstance(privateKey.algorithm, "AndroidKeyStore").getKeySpec(privateKey, KeyInfo::class.java)
        if (Build.VERSION.SDK_INT >= 31) {
            info.securityLevel == KeyProperties.SECURITY_LEVEL_STRONGBOX || info.securityLevel == KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT
        } else {
            @Suppress("DEPRECATION")
            info.isInsideSecureHardware
        }
    }.getOrDefault(false)

    override fun signature(): Signature = Signature.getInstance("SHA256withECDSA").apply { initSign(privateKey) }

    companion object {
        fun load(alias: String): KeystoreKey? {
            val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            return if (store.containsAlias(alias)) KeystoreKey(alias) else null
        }

        fun delete(alias: String) {
            KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(alias)
        }

        fun create(alias: String, requireBiometrics: Boolean): KeystoreKey {
            delete(alias)
            fun spec(strongBox: Boolean) = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
                .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256)
                .apply {
                    if (requireBiometrics) {
                        setUserAuthenticationRequired(true)
                        if (Build.VERSION.SDK_INT >= 30) setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
                        setInvalidatedByBiometricEnrollment(true)
                    } else {
                        setUnlockedDeviceRequired(true)
                    }
                    if (strongBox) setIsStrongBoxBacked(true)
                }
                .build()
            val gen = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
            try {
                gen.initialize(spec(strongBox = true))
                gen.generateKeyPair()
            } catch (_: StrongBoxUnavailableException) {
                gen.initialize(spec(strongBox = false))
                gen.generateKeyPair()
            }
            return KeystoreKey(alias)
        }
    }
}
