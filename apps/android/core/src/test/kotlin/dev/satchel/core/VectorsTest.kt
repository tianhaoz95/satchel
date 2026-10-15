package dev.satchel.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.security.KeyFactory
import java.security.KeyPair
import java.security.Signature
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec

/** Conformance with spec/companion/test-vectors.json (shared with the node and the Swift client). */
class VectorsTest {
    private val root = File(System.getProperty("satchel.repoRoot") ?: "../../..")
    private val v: JsonObject = Json.parseToJsonElement(File(root, "spec/companion/test-vectors.json").readText()).jsonObject
    private fun o(vararg path: String): JsonObject = path.fold(v) { acc, k -> acc[k]!!.jsonObject }
    private fun s(obj: JsonObject, k: String) = obj[k]!!.jsonPrimitive.content
    private val publicKey get() = s(o("key"), "spki_der_b64url")

    private fun verify(message: String, sig: String): Boolean {
        val pub = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(B64.fromUrl(publicKey)))
        return Signature.getInstance("SHA256withECDSA").run { initVerify(pub); update(message.toByteArray()); verify(B64.fromUrl(sig)) }
    }

    @Test fun canonicalMessages() {
        val p = o("pairing", "input")
        assertEquals(s(o("pairing"), "message"), CompanionProtocol.pairingMessage(s(p, "nodeId"), s(p, "code"), s(p, "publicKey")))
        val e = o("enroll", "input")
        assertEquals(s(o("enroll"), "message"), CompanionProtocol.enrollMessage(s(e, "nodeId"), s(e, "parentId"), s(e, "childPublicKey"), e["signedAt"]!!.jsonPrimitive.long))
        val a = o("approval", "input")
        val decision = Decision.entries.first { it.wire == s(a, "decision") }
        assertEquals(
            s(o("approval"), "message"),
            CompanionProtocol.approvalMessage(s(a, "nodeId"), s(a, "approvalId"), decision, s(a, "action"), s(a, "target"), s(a, "detailHash"), a["signedAt"]!!.jsonPrimitive.long),
        )
    }

    @Test fun pairingLink() {
        val i = o("pairing_link", "input")
        val link = PairingLink.parse(s(o("pairing_link"), "link"))
        assertEquals(PairingLink(s(i, "url"), s(i, "code"), s(i, "nodeId"), s(i, "nodeName"), s(i, "pin")), link)
        assertTrue(link!!.isPinned)
        assertNull(PairingLink.parse("https://example.com/app/#pair=ABC"))
    }

    @Test fun keyEncodingsAndPin() {
        val raw = B64.fromUrl(s(o("key"), "raw_x963_b64url"))
        assertEquals(publicKey, B64.url(Pin.P256_SPKI_PREFIX + raw))
        assertEquals(s(o("key"), "pin_sha256_b64"), Pin.sha256(B64.fromUrl(publicKey)))
    }

    @Test fun nodeSignaturesVerify() {
        for (k in listOf("pairing", "enroll", "approval")) assertTrue(k, verify(s(o(k), "message"), s(o(k), "node_signature")))
        assertFalse(verify(s(o("approval"), "message").replace("approved", "denied"), s(o("approval"), "node_signature")))
    }

    /** With SATCHEL_WRITE_CLIENT_SIGNATURES=1, writes spec/companion/client-signatures/kotlin.json for the node tests. */
    @Test fun clientSignatures() {
        val kf = KeyFactory.getInstance("EC")
        val priv = kf.generatePrivate(PKCS8EncodedKeySpec(B64.fromUrl(s(o("key"), "pkcs8_der_b64url"))))
        val pub = kf.generatePublic(X509EncodedKeySpec(B64.fromUrl(publicKey)))
        val key = SoftwareKey(KeyPair(pub, priv))
        assertEquals(publicKey, key.publicKey)
        val sigs = listOf("pairing", "enroll", "approval").associateWith { key.signNow(s(o(it), "message")) }
        sigs.forEach { (k, sig) -> assertTrue(verify(s(o(k), "message"), sig)) }
        if (System.getenv("SATCHEL_WRITE_CLIENT_SIGNATURES") == "1") {
            File(root, "spec/companion/client-signatures/kotlin.json").writeText(
                sigs.toSortedMap().entries.joinToString(",", "{", "}\n") { "\"${it.key}\":\"${it.value}\"" },
            )
        }
    }
}
