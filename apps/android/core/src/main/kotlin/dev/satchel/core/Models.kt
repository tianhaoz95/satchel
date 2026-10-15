package dev.satchel.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.temporal.ChronoUnit

@Serializable
data class Approval(
    val id: String,
    @SerialName("client_name") val clientName: String,
    val action: String,
    val target: String,
    val reason: String = "",
    val status: String,
    @SerialName("created_at") val createdAt: Double,
    @SerialName("decided_by") val decidedBy: String? = null,
    val detail: ApprovalDetail = ApprovalDetail(),
    @SerialName("node_id") val nodeId: String? = null,
    @SerialName("detail_hash") val detailHash: String? = null,
    @SerialName("requires_signature") val requiresSignature: Boolean? = null,
) {
    val isPending get() = status == "pending"
    val title get() = when (action) {
        "reveal_field" -> "See a sensitive value"
        "apply_plan" -> "Reorganize files"
        "update_conventions" -> "Change VAULT.md"
        "set_metadata" -> "Edit metadata"
        else -> action
    }
}

@Serializable
data class Move(val from: String, val to: String)

@Serializable
data class ApprovalDetail(
    val path: String? = null,
    val key: String? = null,
    val preview: String? = null,
    val moves: List<Move>? = null,
    val text: String? = null,
    val root: String? = null,
)

@Serializable
data class Delivery(
    val id: String,
    val at: Double,
    @SerialName("client_name") val clientName: String,
    val title: String,
    val value: String,
    val note: String = "",
    val seen: Int = 0,
)

@Serializable
data class Upcoming(val key: String, val date: String, val path: String, val title: String, val subject: String? = null) {
    val daysLeft: Int get() = ChronoUnit.DAYS.between(LocalDate.now(ZoneOffset.UTC), LocalDate.parse(date)).toInt()
}

@Serializable
data class DeviceInfo(
    val id: String,
    val name: String,
    val platform: String,
    val kind: String,
    @SerialName("parent_id") val parentId: String? = null,
    val hardware: Boolean,
    val signing: Boolean,
    @SerialName("key_fingerprint") val keyFingerprint: String? = null,
    @SerialName("last_seen") val lastSeen: Double? = null,
    val push: Boolean = false,
)

@Serializable
data class NodeInfo(val id: String, val name: String, val pin: String? = null, val policy: Policy, val me: DeviceInfo? = null) {
    @Serializable
    data class Policy(@SerialName("device_signature") val deviceSignature: String)
}

@Serializable
data class PairResult(val id: String, val token: String, val node: Node) {
    @Serializable
    data class Node(val id: String, val name: String, val pin: String? = null)
}

/** What a device keeps after pairing. */
@Serializable
data class Credentials(
    val url: String,
    val token: String,
    val deviceId: String,
    val nodeId: String,
    val nodeName: String,
    val pin: String?,
    val keyAlias: String,
)
