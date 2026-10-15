package dev.satchel.wear

import android.app.Application
import android.content.Context
import android.os.Build
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester
import android.content.ComponentName
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import dev.satchel.core.Approval
import dev.satchel.core.Credentials
import dev.satchel.core.CredentialsStore
import dev.satchel.core.Decision
import dev.satchel.core.KeystoreKey
import dev.satchel.core.NodeClient
import dev.satchel.core.PairingLink
import dev.satchel.core.Upcoming
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

data class WatchState(
    val enrolled: Boolean = false,
    val approvals: List<Approval> = emptyList(),
    val upcoming: List<Upcoming> = emptyList(),
    val open: Approval? = null,
    val busy: Boolean = false,
    val error: String? = null,
) {
    val pending get() = approvals.filter { it.isPending }
}

/** Credentials arrive from the phone over the Data Layer, possibly while the UI isn't running. */
object Enrollment {
    val credentials = MutableStateFlow<Credentials?>(null)
}

class CredentialsListener : WearableListenerService() {
    override fun onMessageReceived(event: MessageEvent) {
        if (event.path != "/satchel/credentials") return
        val creds = runCatching { Json.decodeFromString(Credentials.serializer(), String(event.data)) }.getOrNull() ?: return
        CredentialsStore(this).save(creds)
        Enrollment.credentials.value = creds
    }
}

/**
 * The watch has its own Keystore key (unlocked-device bound: an unlocked, on-wrist watch is the
 * presence check). It approves and denies; it never shows values agents deliver.
 */
class WatchModel(app: Application) : AndroidViewModel(app) {
    private val store = CredentialsStore(app)
    private val _state = MutableStateFlow(WatchState())
    val state = _state.asStateFlow()
    private var client: NodeClient? = null
    var debugOpenFirst = false

    companion object {
        const val KEY_ALIAS = "satchel.watch"
    }

    init {
        store.load()?.let { use(it) }
        viewModelScope.launch { Enrollment.credentials.collect { c -> if (c != null) use(c) } }
    }

    private fun use(c: Credentials) {
        client = NodeClient(c)
        _state.update { it.copy(enrolled = KeystoreKey.load(KEY_ALIAS) != null, error = null, busy = false) }
        refresh()
    }

    fun open(a: Approval?) = _state.update { it.copy(open = a) }

    /** Creates this watch's key and asks the phone to vouch for it. */
    fun enroll() = viewModelScope.launch {
        _state.update { it.copy(busy = true, error = null) }
        try {
            val key = KeystoreKey.create(KEY_ALIAS, requireBiometrics = false)
            val phones = Wearable.getNodeClient(getApplication<Application>()).connectedNodes.await()
            val phone = phones.firstOrNull() ?: error("Your phone isn't connected")
            val body = buildJsonObject { put("public_key", key.publicKey); put("name", Build.MODEL); put("hardware", key.isHardware) }
            Wearable.getMessageClient(getApplication<Application>()).sendMessage(phone.id, "/satchel/enroll", body.toString().toByteArray()).await()
            _state.update { it.copy(error = "Confirm on your phone") }
        } catch (e: Exception) {
            _state.update { it.copy(busy = false, error = e.message) }
        }
    }

    /** Debug/emulator path: pair the watch directly with a pairing code. */
    fun pairDirectly(link: PairingLink) = viewModelScope.launch {
        runCatching {
            val key = KeystoreKey.create(KEY_ALIAS, requireBiometrics = false)
            val c = NodeClient(link.url, null, link.pin)
            val r = c.pair(link, key, "Wear OS watch", "wearos", kind = "watch")
            val creds = Credentials(link.url, r.token, r.id, r.node.id, r.node.name, link.pin, KEY_ALIAS)
            store.save(creds)
            use(creds)
        }.onFailure { e -> _state.update { it.copy(error = e.message) } }
    }

    fun refresh() = viewModelScope.launch {
        val c = client ?: return@launch
        runCatching {
            val approvals = c.approvals()
            val upcoming = c.upcoming()
            _state.update { s -> s.copy(approvals = approvals, upcoming = upcoming, error = null, open = s.open ?: if (debugOpenFirst) approvals.firstOrNull { it.isPending } else null) }
            PendingComplicationService.save(getApplication(), approvals.count { it.isPending })
        }.onFailure { e -> _state.update { it.copy(error = e.message) } }
    }

    fun decide(a: Approval, decision: Decision) = viewModelScope.launch {
        val c = client ?: return@launch
        val key = KeystoreKey.load(KEY_ALIAS) ?: return@launch
        _state.update { it.copy(busy = true) }
        runCatching {
            val now = System.currentTimeMillis()
            c.submitDecision(a, decision, now, key.signNow(c.decisionMessage(a, decision, now)))
        }.onSuccess { _state.update { it.copy(open = null) } }.onFailure { e -> _state.update { it.copy(error = e.message) } }
        _state.update { it.copy(busy = false) }
        refresh()
    }
}

fun Context.complicationRequester() = ComplicationDataSourceUpdateRequester.create(this, ComponentName(this, PendingComplicationService::class.java))
