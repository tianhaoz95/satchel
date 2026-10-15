package dev.satchel.app

import android.app.Application
import android.os.Build
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import dev.satchel.core.Approval
import dev.satchel.core.Credentials
import dev.satchel.core.CredentialsStore
import dev.satchel.core.Decision
import dev.satchel.core.Delivery
import dev.satchel.core.DeviceInfo
import dev.satchel.core.KeystoreKey
import dev.satchel.core.NodeClient
import dev.satchel.core.NodeInfo
import dev.satchel.core.PairResult
import dev.satchel.core.PairingLink
import dev.satchel.core.Upcoming
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class Tab { APPROVALS, INBOX, UPCOMING, CAPTURE, SETTINGS }

data class UiState(
    val credentials: Credentials? = null,
    val approvals: List<Approval> = emptyList(),
    val deliveries: List<Delivery> = emptyList(),
    val upcoming: List<Upcoming> = emptyList(),
    val devices: List<DeviceInfo> = emptyList(),
    val node: NodeInfo? = null,
    val tab: Tab = Tab.APPROVALS,
    val open: Approval? = null,
    val revealed: Set<String> = emptySet(),
    val busy: Boolean = false,
    val error: String? = null,
    val message: String? = null,
    val pendingWatch: WatchRequest? = null,
) {
    val paired get() = credentials != null
    val pendingCount get() = approvals.count { it.isPending }
}

/** A watch asked (over the Wearable Data Layer) to be enrolled; the owner confirms with biometrics. */
data class WatchRequest(val sourceNode: String, val publicKey: String, val name: String, val hardware: Boolean)

/**
 * App state. Every network call goes through a pinned NodeClient; decisions and pairing are signed
 * by the Keystore key through [Authenticator] (BiometricPrompt).
 */
class AppViewModel(app: Application) : AndroidViewModel(app) {
    private val store = CredentialsStore(app)
    private val _state = MutableStateFlow(UiState(credentials = store.load()))
    val state = _state.asStateFlow()
    private var client: NodeClient? = _state.value.credentials?.let { NodeClient(it) }
    var authenticator: Authenticator? = null
    var skipAuth = false
    var debugOpenFirst = false
    var debugRevealAll = false

    companion object {
        const val KEY_ALIAS = "satchel.phone"
    }

    private val key get() = KeystoreKey.load(KEY_ALIAS)

    fun select(tab: Tab) = _state.update { it.copy(tab = tab, open = null) }
    fun open(a: Approval?) = _state.update { it.copy(open = a) }
    fun dismissMessage() = _state.update { it.copy(message = null, error = null) }

    private suspend fun <T> busy(block: suspend () -> T): T? {
        _state.update { it.copy(busy = true, error = null) }
        return try {
            block()
        } catch (_: AuthCancelled) {
            null
        } catch (e: Exception) {
            _state.update { it.copy(error = e.message ?: e.toString()) }
            null
        } finally {
            _state.update { it.copy(busy = false) }
        }
    }

    fun pair(link: PairingLink) = viewModelScope.launch {
        busy {
            val auth = authenticator ?: error("Not ready")
            val key = KeystoreKey.create(KEY_ALIAS, requireBiometrics = !skipAuth)
            val c = NodeClient(link.url, null, link.pin)
            val message = dev.satchel.core.CompanionProtocol.pairingMessage(link.nodeId, link.code, key.publicKey)
            val sig = auth.sign(key, message, "Pair with ${link.nodeName}", "Creates this phone's signing key")
            val r: PairResult = c.pair(link, key, Build.MODEL, "android", signature = sig)
            val creds = Credentials(link.url, r.token, r.id, r.node.id, r.node.name, link.pin, KEY_ALIAS)
            store.save(creds)
            client = NodeClient(creds)
            _state.update { it.copy(credentials = creds) }
            PushRegistration.register(getApplication())
        }
        refresh()
    }

    fun unpair() = viewModelScope.launch {
        val c = _state.value.credentials
        runCatching { if (c != null) client?.removeDevice(c.deviceId) }
        store.clear()
        KeystoreKey.delete(KEY_ALIAS)
        client = null
        _state.value = UiState()
    }

    fun refresh() = viewModelScope.launch {
        val c = client ?: return@launch
        try {
            val approvals = c.approvals()
            val deliveries = c.deliveries()
            val upcoming = c.upcoming()
            val node = c.node()
            val devices = c.devices()
            _state.update { s ->
                s.copy(
                    approvals = approvals, deliveries = deliveries, upcoming = upcoming, node = node, devices = devices, error = null,
                    open = s.open ?: if (debugOpenFirst) approvals.firstOrNull { it.isPending } else null,
                    revealed = if (debugRevealAll) deliveries.map { it.id }.toSet() else s.revealed,
                )
            }
        } catch (e: Exception) {
            _state.update { it.copy(error = e.message) }
        }
    }

    fun decide(a: Approval, decision: Decision) = viewModelScope.launch {
        val c = client ?: return@launch
        val ok = busy {
            val key = key ?: error("No device key")
            val now = System.currentTimeMillis()
            val verb = if (decision == Decision.APPROVED) "Approve" else "Deny"
            val sig = authenticator!!.sign(key, c.decisionMessage(a, decision, now), "$verb: ${a.title}", "Requested by ${a.clientName}")
            c.submitDecision(a, decision, now, sig)
        }
        if (ok != null) _state.update { it.copy(open = null, message = if (decision == Decision.APPROVED) "Approved and signed" else "Denied") }
        refresh()
    }

    fun reveal(d: Delivery) = viewModelScope.launch {
        if (authenticator?.confirm("Show ${d.title}") == true) {
            _state.update { it.copy(revealed = it.revealed + d.id) }
            runCatching { client?.markSeen(d.id) }
        }
    }

    fun capture(bytes: ByteArray, name: String, type: String, note: String) = viewModelScope.launch {
        val path = busy { client!!.capture(bytes, name, type, note) }
        if (path != null) _state.update { it.copy(message = "Saved to $path") }
    }

    fun remove(d: DeviceInfo) = viewModelScope.launch {
        runCatching { client?.removeDevice(d.id) }
        refresh()
    }

    fun setPushTicket(ticket: String) = viewModelScope.launch { runCatching { client?.setPushTicket(ticket) } }

    // watch enrollment

    fun watchRequested(r: WatchRequest) = _state.update { it.copy(pendingWatch = r, tab = Tab.SETTINGS) }

    /** Countersigns the watch's key (biometrics), then sends its credentials back over the Data Layer. */
    fun confirmWatch(send: suspend (String, Credentials) -> Unit) = viewModelScope.launch {
        val r = _state.value.pendingWatch ?: return@launch
        val creds = _state.value.credentials ?: return@launch
        busy {
            val key = key ?: error("No device key")
            val now = System.currentTimeMillis()
            val sig = authenticator!!.sign(key, client!!.enrollMessage(creds.nodeId, creds.deviceId, r.publicKey, now), "Allow ${r.name}", "It will be able to approve requests")
            val res = client!!.enrollChild(r.publicKey, r.name, "wearos", r.hardware, now, sig)
            send(r.sourceNode, Credentials(creds.url, res.token, res.id, creds.nodeId, creds.nodeName, creds.pin, "satchel.watch"))
            _state.update { it.copy(pendingWatch = null, message = "${r.name} can now approve requests") }
        }
        refresh()
    }

    fun rejectWatch() = _state.update { it.copy(pendingWatch = null) }
}
