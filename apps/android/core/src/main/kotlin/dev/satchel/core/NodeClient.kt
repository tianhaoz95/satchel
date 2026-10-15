package dev.satchel.core

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager

class NodeException(val status: Int, message: String, val code: String? = null) : Exception(message)

/**
 * Accepts the server only if its leaf key matches the pin from pairing. The pin replaces CA trust: it
 * works with self-signed node certificates and defeats a mis-issued certificate for the node's name.
 */
class PinningTrustManager(private val pin: String) : X509TrustManager {
    override fun checkServerTrusted(chain: Array<out X509Certificate>, authType: String) {
        val leaf = chain.firstOrNull() ?: throw CertificateException("No certificate")
        if (Pin.sha256(leaf.publicKey.encoded) != pin) {
            throw CertificateException("The node's certificate doesn't match the one you paired with")
        }
    }

    override fun checkClientTrusted(chain: Array<out X509Certificate>, authType: String) = throw CertificateException("Not a server")
    override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
}

/** Talks to the owner's node (companion protocol v2). Pure JVM, so it runs in unit tests too. */
class NodeClient(private val baseUrl: String, var token: String?, pin: String?) {
    constructor(c: Credentials) : this(c.url, c.token, c.pin)

    private val json = Json { ignoreUnknownKeys = true }
    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .apply {
            if (pin != null) {
                val tm = PinningTrustManager(pin)
                val ctx = SSLContext.getInstance("TLS").apply { init(null, arrayOf(tm), SecureRandom()) }
                sslSocketFactory(ctx.socketFactory, tm)
                // Identity is the pinned key, not the certificate's name.
                hostnameVerifier { _, _ -> true }
            }
        }
        .build()

    private suspend fun call(path: String, method: String = "GET", body: RequestBody? = null, headers: Map<String, String> = emptyMap()): String =
        withContext(Dispatchers.IO) {
            val req = Request.Builder().url("${baseUrl.trimEnd('/')}/app/api/$path").method(method, body ?: if (method == "GET") null else ByteArray(0).toRequestBody())
            token?.let { req.header("Authorization", "Bearer $it") }
            headers.forEach { (k, v) -> req.header(k, v) }
            http.newCall(req.build()).execute().use { res ->
                val text = res.body.string()
                if (!res.isSuccessful) {
                    val obj = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull()
                    throw NodeException(res.code, obj?.get("error")?.jsonPrimitive?.content ?: "HTTP ${res.code}", obj?.get("code")?.jsonPrimitive?.content)
                }
                text
            }
        }

    private fun JsonObject.body() = toString().toRequestBody("application/json".toMediaType())

    // pairing

    /** Pairs this device; [signer] proves possession of the key it registers. */
    suspend fun pair(link: PairingLink, signer: Signer, name: String, platform: String, kind: String = "phone", signature: String? = null): PairResult {
        val sig = signature ?: signer.signNow(CompanionProtocol.pairingMessage(link.nodeId, link.code, signer.publicKey))
        val body = buildJsonObject {
            put("code", link.code); put("name", name); put("platform", platform); put("kind", kind)
            put("hardware", signer.isHardware); put("public_key", signer.publicKey); put("signature", sig)
        }
        val result = json.decodeFromString<PairResult>(call("v2/pair", "POST", body.body()))
        if (result.node.id != link.nodeId) throw NodeException(0, "Paired with an unexpected node")
        token = result.token
        return result
    }

    // reads

    suspend fun node(): NodeInfo = json.decodeFromString(call("v2/node"))
    suspend fun approvals(pendingOnly: Boolean = false): List<Approval> = json.decodeFromString(call(if (pendingOnly) "v2/approvals?status=pending" else "v2/approvals"))
    suspend fun deliveries(): List<Delivery> = json.decodeFromString(call("deliveries"))
    suspend fun upcoming(): List<Upcoming> = json.decodeFromString(call("upcoming"))
    suspend fun devices(): List<DeviceInfo> = json.decodeFromString(call("v2/devices"))
    suspend fun markSeen(id: String) { call("deliveries/$id/seen", "POST", JsonObject(emptyMap()).body()) }

    // decisions

    /** The message to sign for [decision]; sign it (BiometricPrompt on device), then call [submitDecision]. */
    fun decisionMessage(approval: Approval, decision: Decision, signedAt: Long): String =
        CompanionProtocol.approvalMessage(approval.nodeId ?: error("no node id"), approval.id, decision, approval.action, approval.target, approval.detailHash ?: error("no detail hash"), signedAt)

    suspend fun submitDecision(approval: Approval, decision: Decision, signedAt: Long, signature: String): Approval {
        val body = buildJsonObject { put("decision", decision.wire); put("signed_at", signedAt); put("signature", signature) }
        return json.decodeFromString(call("v2/approvals/${approval.id}", "POST", body.body()))
    }

    // devices, push, capture

    fun enrollMessage(nodeId: String, parentId: String, childPublicKey: String, signedAt: Long) =
        CompanionProtocol.enrollMessage(nodeId, parentId, childPublicKey, signedAt)

    suspend fun enrollChild(publicKey: String, name: String, platform: String, hardware: Boolean, signedAt: Long, signature: String): PairResult {
        val body = buildJsonObject {
            put("name", name); put("platform", platform); put("hardware", hardware)
            put("public_key", publicKey); put("signed_at", signedAt); put("signature", signature)
        }
        return json.decodeFromString(call("v2/devices/children", "POST", body.body()))
    }

    suspend fun removeDevice(id: String) { call("v2/devices/$id", "DELETE") }

    suspend fun setPushTicket(ticket: String?) {
        call("v2/push", "POST", JsonObject(mapOf("ticket" to JsonPrimitive(ticket))).body())
    }

    suspend fun capture(bytes: ByteArray, filename: String, contentType: String, note: String): String {
        val out = call("capture", "POST", bytes.toRequestBody(contentType.toMediaType()), mapOf("X-Filename" to filename, "X-Note" to note))
        return json.parseToJsonElement(out).jsonObject["path"]?.jsonPrimitive?.content ?: ""
    }
}

/** Registers an FCM token with the push gateway; returns the opaque ticket for the node. */
object PushGateway {
    var url = "https://push.satchel.dev"

    suspend fun register(fcmToken: String): String = withContext(Dispatchers.IO) {
        val body = buildJsonObject { put("platform", "fcm"); put("token", fcmToken) }.toString().toRequestBody("application/json".toMediaType())
        OkHttpClient().newCall(Request.Builder().url("$url/v1/register").post(body).build()).execute().use { res ->
            if (!res.isSuccessful) throw NodeException(res.code, "Push gateway rejected the token")
            Json.parseToJsonElement(res.body.string()).jsonObject["ticket"]!!.jsonPrimitive.content
        }
    }
}

/** Fingerprint shown for comparing keys: first 16 chars of the base64url SHA-256 of the SPKI. */
fun keyFingerprint(spkiB64url: String): String = B64.url(MessageDigest.getInstance("SHA-256").digest(B64.fromUrl(spkiB64url))).take(16)
