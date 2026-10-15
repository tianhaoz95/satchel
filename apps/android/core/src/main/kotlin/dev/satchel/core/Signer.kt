package dev.satchel.core

import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec

/**
 * Signs protocol messages with a P-256 key. On devices this is an Android Keystore key that needs a
 * BiometricPrompt-authenticated `Signature` (see KeystoreKey); tests use a software key.
 */
interface Signer {
    /** SPKI DER, base64url. */
    val publicKey: String
    val isHardware: Boolean

    /** An initialized `Signature`; for biometric-bound keys, pass it to BiometricPrompt.CryptoObject first. */
    fun signature(): Signature

    /** Completes a signature started with [signature] (after authentication, if required). */
    fun finish(signature: Signature, message: String): String {
        signature.update(message.toByteArray(Charsets.UTF_8))
        return B64.url(signature.sign())
    }

    fun signNow(message: String): String = finish(signature(), message)
}

class SoftwareKey(private val pair: KeyPair) : Signer {
    override val publicKey: String = B64.url(pair.public.encoded)
    override val isHardware = false
    override fun signature(): Signature = Signature.getInstance("SHA256withECDSA").apply { initSign(pair.private as PrivateKey) }

    companion object {
        fun generate(): SoftwareKey = SoftwareKey(KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair())
    }
}
