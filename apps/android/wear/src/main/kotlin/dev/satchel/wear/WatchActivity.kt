package dev.satchel.wear

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material3.AppScaffold
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.ColorScheme
import androidx.wear.compose.material3.ListHeader
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import dev.satchel.core.Approval
import dev.satchel.core.Decision
import dev.satchel.core.PairingLink

private val Accent = Color(0xFF4FB487)
private val Danger = Color(0xFFF2776B)

class WatchActivity : ComponentActivity() {
    private val vm: WatchModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (BuildConfig.DEBUG) {
            vm.debugOpenFirst = intent.getBooleanExtra("openFirstApproval", false)
            if (!vm.state.value.enrolled) intent.getStringExtra("pairLink")?.let { PairingLink.parse(it) }?.let { vm.pairDirectly(it) }
        }
        setContent {
            MaterialTheme(colorScheme = ColorScheme(primary = Accent, onPrimary = Color(0xFF0C1A13))) {
                AppScaffold { WatchApp(vm) }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        vm.refresh()
    }
}

@Composable
fun WatchApp(vm: WatchModel) {
    val state by vm.state.collectAsState()
    val list = rememberScalingLazyListState()
    BackHandler(enabled = state.open != null) { vm.open(null) }
    ScreenScaffold(scrollState = list) {
        ScalingLazyColumn(state = list, modifier = Modifier.fillMaxWidth()) {
            val open = state.open
            when {
                !state.enrolled -> {
                    item { ListHeader { Text("Satchel") } }
                    item { Text("Keep Satchel open on your phone; you'll confirm there with your fingerprint.", fontSize = 13.sp, textAlign = TextAlign.Center) }
                    state.error?.let { e -> item { Text(e, color = Danger, fontSize = 12.sp, textAlign = TextAlign.Center) } }
                    item { Button(onClick = vm::enroll, enabled = !state.busy, modifier = Modifier.fillMaxWidth()) { Text(if (state.busy) "Waiting for phone…" else "Enroll this watch") } }
                }
                open != null -> detail(open, state.busy, vm)
                else -> {
                    item { ListHeader { Text("Approve") } }
                    state.error?.let { e -> item { Text(e, color = Danger, fontSize = 12.sp) } }
                    if (state.pending.isEmpty()) item { Text("Nothing needs you.", fontSize = 14.sp) }
                    items(state.pending, key = { it.id }) { a ->
                        Button(onClick = { vm.open(a) }, modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.filledTonalButtonColors(), label = { Text(a.title) }, secondaryLabel = { Text(a.clientName) })
                    }
                    state.upcoming.firstOrNull { it.daysLeft >= 0 }?.let { u ->
                        item { ListHeader { Text("Next") } }
                        item { Text("${u.title} · ${u.daysLeft} d", fontSize = 13.sp) }
                    }
                }
            }
        }
    }
}

/** Facts first, then Approve / Deny. Delivered values are never shown on the watch. */
private fun androidx.wear.compose.foundation.lazy.ScalingLazyListScope.detail(a: Approval, busy: Boolean, vm: WatchModel) {
    item { ListHeader { Text(a.title) } }
    item { Text(a.clientName, fontSize = 13.sp) }
    item { Text(a.target, fontSize = 11.sp, fontFamily = FontFamily.Monospace, textAlign = TextAlign.Center, modifier = Modifier.padding(horizontal = 8.dp)) }
    a.detail.moves?.let { m -> item { Text("${m.size} file move${if (m.size == 1) "" else "s"}", fontSize = 13.sp) } }
    if (a.reason.isNotEmpty()) item { Text("Reason (unverified): ${a.reason}", fontSize = 11.sp, textAlign = TextAlign.Center) }
    item { Button(onClick = { vm.decide(a, Decision.APPROVED) }, enabled = !busy, modifier = Modifier.fillMaxWidth(), label = { Text("Approve") }) }
    item {
        Button(
            onClick = { vm.decide(a, Decision.DENIED) },
            enabled = !busy,
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.filledTonalButtonColors(contentColor = Danger),
            label = { Text("Deny") },
        )
    }
}
