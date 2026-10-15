package dev.satchel.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.fragment.app.FragmentActivity
import com.google.android.gms.wearable.Wearable
import dev.satchel.core.Credentials
import dev.satchel.core.PairingLink
import kotlinx.coroutines.tasks.await
import kotlinx.serialization.json.Json

class MainActivity : FragmentActivity() {
    private val vm: AppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // Debug-only switches for screenshot automation; ignored in release builds.
        val debug = BuildConfig.DEBUG
        vm.skipAuth = debug && intent.getBooleanExtra("skipAuth", false)
        vm.debugOpenFirst = debug && intent.getBooleanExtra("openFirstApproval", false)
        vm.debugRevealAll = debug && intent.getBooleanExtra("revealAll", false)
        vm.authenticator = Authenticator(this, vm.skipAuth)
        handle(intent)
        if (debug && !vm.state.value.paired) intent.getStringExtra("pairLink")?.let { PairingLink.parse(it) }?.let { vm.pair(it) }
        setContent { SatchelApp(vm, onSendToWatch = ::sendToWatch) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    override fun onResume() {
        super.onResume()
        vm.refresh()
    }

    private fun handle(intent: Intent) {
        intent.data?.toString()?.let { PairingLink.parse(it) }?.let { vm.pair(it) }
        when (intent.getStringExtra("tab")) {
            "inbox" -> vm.select(Tab.INBOX)
            "approvals" -> vm.select(Tab.APPROVALS)
            "upcoming" -> vm.select(Tab.UPCOMING)
            "capture" -> vm.select(Tab.CAPTURE)
            "settings" -> vm.select(Tab.SETTINGS)
        }
        val watchKey = intent.getStringExtra("watchKey")
        val watchNode = intent.getStringExtra("watchNode")
        if (watchKey != null && watchNode != null) {
            vm.watchRequested(WatchRequest(watchNode, watchKey, intent.getStringExtra("watchName") ?: "Watch", intent.getBooleanExtra("watchHardware", false)))
        }
    }

    private suspend fun sendToWatch(nodeId: String, creds: Credentials) {
        Wearable.getMessageClient(this).sendMessage(nodeId, "/satchel/credentials", Json.encodeToString(Credentials.serializer(), creds).toByteArray()).await()
    }
}
