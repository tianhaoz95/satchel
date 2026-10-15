package dev.satchel.core

import java.net.URI
import java.net.URLDecoder
import java.security.MessageDigest
import java.util.Base64

/**
 * Canonical byte strings of companion protocol v2 (spec/companion/protocol.md). They must match the
 * node byte for byte; VectorsTest checks them against spec/companion/test-vectors.json.
 */
object CompanionProtocol {
    fun pairingMessage(nodeId: String, code: String, publicKey: String) =
        listOf("satchel-pair-v1", nodeId, code.uppercase(), publicKey).joinToString("\n")

    fun enrollMessage(nodeId: String, parentId: String, childPublicKey: String, signedAt: Long) =
        listOf("satchel-enroll-v1", nodeId, parentId, childPublicKey, signedAt.toString()).joinToString("\n")

    fun approvalMessage(
        nodeId: String, approvalId: String, decision: Decision, action: String, target: String, detailHash: String, signedAt: Long,
    ) = listOf("satchel-approval-v1", nodeId, approvalId, decision.wire, action, target, detailHash, signedAt.toString()).joinToString("\n")
}

enum class Decision(val wire: String) { APPROVED("approved"), DENIED("denied") }

object B64 {
    fun url(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    fun fromUrl(s: String): ByteArray = Base64.getUrlDecoder().decode(s.trimEnd('='))
    fun std(bytes: ByteArray): String = Base64.getEncoder().encodeToString(bytes)
}

object Pin {
    /** Standard base64 SHA-256 of a key's SPKI DER: the value carried in the pairing link. */
    fun sha256(spki: ByteArray): String = B64.std(MessageDigest.getInstance("SHA-256").digest(spki))

    /** SPKI prefix for an uncompressed P-256 point, to turn a raw X9.63 key into SPKI DER. */
    val P256_SPKI_PREFIX: ByteArray = "3059301306072a8648ce3d020106082a8648ce3d030107034200".chunked(2).map { it.toInt(16).toByte() }.toByteArray()
}

/** `satchel://pair?v=2&url=…&code=…&node=…&name=…&pin=…` (application/x-www-form-urlencoded). */
data class PairingLink(val url: String, val code: String, val nodeId: String, val nodeName: String, val pin: String?) {
    val isPinned: Boolean get() = pin != null && url.startsWith("https://")

    companion object {
        fun parse(raw: String): PairingLink? {
            val uri = runCatching { URI(raw.trim()) }.getOrNull() ?: return null
            if (uri.scheme != "satchel" || uri.host != "pair") return null
            val q = (uri.rawQuery ?: "").split("&").mapNotNull {
                val kv = it.split("=", limit = 2)
                if (kv.size == 2) URLDecoder.decode(kv[0], "UTF-8") to URLDecoder.decode(kv[1], "UTF-8") else null
            }.toMap()
            if (q["v"] != "2") return null
            return PairingLink(q["url"] ?: return null, q["code"] ?: return null, q["node"] ?: return null, q["name"] ?: "Satchel", q["pin"])
        }
    }
}
