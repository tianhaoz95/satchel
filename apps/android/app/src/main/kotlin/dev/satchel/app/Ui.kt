package dev.satchel.app

import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.net.Uri
import android.os.PersistableBundle
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.DateRange
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.MailOutline
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.activity.compose.BackHandler
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import dev.satchel.core.Approval
import dev.satchel.core.Credentials
import dev.satchel.core.Decision
import dev.satchel.core.KeystoreKey
import dev.satchel.core.PairingLink
import kotlinx.coroutines.launch

val Accent = Color(0xFF1F6F50)
val Warn = Color(0xFFA15C07)
val Danger = Color(0xFFB42318)

/** Flat theme shared with the web app: one green accent, outlined surfaces, no elevation. */
@Composable
fun SatchelTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val colors = if (dark) {
        darkColorScheme(primary = Color(0xFF4FB487), onPrimary = Color(0xFF0C1A13), background = Color(0xFF141413), surface = Color(0xFF1C1B1A), surfaceContainer = Color(0xFF1C1B1A))
    } else {
        lightColorScheme(primary = Accent, onPrimary = Color.White, background = Color(0xFFFAFAF9), surface = Color.White, surfaceContainer = Color(0xFFF3F3F1))
    }
    MaterialTheme(colorScheme = colors, content = content)
}

@Composable
fun Pill(text: String, color: Color = Accent) {
    Text(
        text,
        color = color,
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier.background(color.copy(alpha = 0.12f), RoundedCornerShape(50)).padding(horizontal = 8.dp, vertical = 2.dp),
    )
}

fun daysLabel(d: Int) = if (d < 0) "${-d} d late" else if (d == 0) "today" else "$d d"
fun daysColor(d: Int) = if (d < 0) Danger else if (d <= 60) Warn else Accent

fun ago(ms: Double): String {
    val s = ((System.currentTimeMillis() - ms) / 1000).toLong()
    return when {
        s < 60 -> "just now"
        s < 3600 -> "${s / 60} min ago"
        s < 86400 -> "${s / 3600} h ago"
        else -> "${s / 86400} d ago"
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SatchelApp(vm: AppViewModel, onSendToWatch: suspend (String, Credentials) -> Unit) {
    val state by vm.state.collectAsState()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(state.message, state.error) {
        (state.message ?: state.error)?.let {
            snackbar.showSnackbar(it)
            vm.dismissMessage()
        }
    }
    SatchelTheme {
        if (!state.paired) {
            PairScreen(vm, state.busy, state.error)
            return@SatchelTheme
        }
        Scaffold(
            snackbarHost = { SnackbarHost(snackbar) },
            topBar = {
                TopAppBar(
                    title = { Text(state.open?.title ?: titleFor(state.tab), fontWeight = FontWeight.SemiBold) },
                    navigationIcon = { if (state.open != null) TextButton(onClick = { vm.open(null) }) { Text("Back") } },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
                )
            },
            bottomBar = {
                NavigationBar(containerColor = MaterialTheme.colorScheme.surfaceContainer, tonalElevation = 0.dp) {
                    tabItem(vm, state.tab, Tab.APPROVALS, "Approve", Icons.Outlined.CheckCircle, state.pendingCount)
                    tabItem(vm, state.tab, Tab.INBOX, "Inbox", Icons.Outlined.MailOutline)
                    tabItem(vm, state.tab, Tab.UPCOMING, "Upcoming", Icons.Outlined.DateRange)
                    tabItem(vm, state.tab, Tab.CAPTURE, "Capture", Icons.Outlined.Add)
                    tabItem(vm, state.tab, Tab.SETTINGS, "Settings", Icons.Outlined.Settings)
                }
            },
            containerColor = MaterialTheme.colorScheme.background,
        ) { pad ->
            Box(Modifier.padding(pad).fillMaxSize()) {
                when {
                    state.open != null -> ApprovalDetail(vm, state.open!!, state.busy)
                    state.tab == Tab.APPROVALS -> ApprovalsList(vm, state.approvals)
                    state.tab == Tab.INBOX -> InboxList(vm, state)
                    state.tab == Tab.UPCOMING -> UpcomingList(state)
                    state.tab == Tab.CAPTURE -> CaptureScreen(vm, state.busy)
                    else -> SettingsScreen(vm, state)
                }
            }
        }
        state.pendingWatch?.let { w ->
            val scope = rememberCoroutineScope()
            AlertDialog(
                onDismissRequest = vm::rejectWatch,
                title = { Text("Allow ${w.name}?") },
                text = { Text("It will be able to approve and deny requests with its own key. It never shows values agents send you.") },
                confirmButton = { Button(onClick = { scope.launch { vm.confirmWatch(onSendToWatch) } }) { Text("Allow") } },
                dismissButton = { TextButton(onClick = vm::rejectWatch) { Text("Not now") } },
            )
        }
        BackHandler(enabled = state.open != null) { vm.open(null) }
    }
}

private fun titleFor(t: Tab) = when (t) {
    Tab.APPROVALS -> "Approvals"
    Tab.INBOX -> "Inbox"
    Tab.UPCOMING -> "Upcoming"
    Tab.CAPTURE -> "Capture"
    Tab.SETTINGS -> "Settings"
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.tabItem(vm: AppViewModel, current: Tab, tab: Tab, label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, badge: Int = 0) {
    NavigationBarItem(
        selected = current == tab,
        onClick = { vm.select(tab) },
        icon = { BadgedBox(badge = { if (badge > 0) Badge { Text("$badge") } }) { Icon(icon, contentDescription = label) } },
        label = { Text(label) },
    )
}

@Composable
fun Section(title: String) {
    Text(title.uppercase(), fontSize = 12.sp, letterSpacing = 1.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f), modifier = Modifier.padding(top = 16.dp, bottom = 6.dp))
}

@Composable
fun FlatCard(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    OutlinedCard(modifier.fillMaxWidth(), shape = RoundedCornerShape(10.dp), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
        Column(Modifier.padding(14.dp)) { content() }
    }
}

// ----------------------------------------------------------------------------- pairing

@Composable
fun PairScreen(vm: AppViewModel, busy: Boolean, error: String?) {
    val context = LocalContext.current
    var pasted by remember { mutableStateOf("") }
    val link = PairingLink.parse(pasted)
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).padding(24.dp).padding(top = 48.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Icon(Icons.Outlined.Lock, null, tint = Accent, modifier = Modifier.size(40.dp))
        Text("Pair with your Satchel node", fontSize = 28.sp, fontWeight = FontWeight.Bold)
        Text(
            "On your computer, open Satchel → Phone → Show pairing code, then scan it. This phone creates a signing key in secure hardware; approvals will need your fingerprint or face.",
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.65f),
        )
        error?.let { Text(it, color = Danger) }
        Button(
            onClick = {
                GmsBarcodeScanning.getClient(context).startScan().addOnSuccessListener { code ->
                    code.rawValue?.let { PairingLink.parse(it) }?.let { vm.pair(it) }
                }
            },
            modifier = Modifier.fillMaxWidth(),
            enabled = !busy,
        ) { Text("Scan pairing code") }
        Text("Or paste the pairing link", fontWeight = FontWeight.SemiBold)
        OutlinedTextField(pasted, { pasted = it }, Modifier.fillMaxWidth(), placeholder = { Text("satchel://pair?…") }, textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace))
        if (link != null) {
            PinNote(link.isPinned)
            OutlinedButton(onClick = { vm.pair(link) }, enabled = !busy) { Text("Pair with ${link.nodeName}") }
        }
        if (busy) CircularProgressIndicator()
    }
}

@Composable
fun PinNote(pinned: Boolean) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(if (pinned) Icons.Outlined.Lock else Icons.Outlined.Warning, null, tint = if (pinned) Accent else Warn, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(6.dp))
        Text(if (pinned) "Pinned to your node's own key" else "Home network only, without TLS. Connect a relay to use Satchel anywhere.", fontSize = 13.sp, color = if (pinned) Accent else Warn)
    }
}

// ----------------------------------------------------------------------------- approvals

@Composable
fun ApprovalsList(vm: AppViewModel, approvals: List<Approval>) {
    val pending = approvals.filter { it.isPending }
    val recent = approvals.filter { !it.isPending }.take(10)
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item { Section("Waiting for you") }
        if (pending.isEmpty()) item { Text("Nothing needs you right now.", color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)) }
        items(pending, key = { it.id }) { ApprovalRow(it) { vm.open(it) } }
        if (recent.isNotEmpty()) {
            item { Section("Recent") }
            items(recent, key = { it.id }) { ApprovalRow(it) { vm.open(it) } }
        }
    }
}

@Composable
fun ApprovalRow(a: Approval, onClick: () -> Unit) {
    FlatCard(Modifier.clickable(onClick = onClick)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(a.title, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, modifier = Modifier.weight(1f))
            StatusPill(a.status)
        }
        Text("${a.clientName} · ${ago(a.createdAt)}", color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f), fontSize = 14.sp)
        Text(a.target, fontFamily = FontFamily.Monospace, fontSize = 12.sp, maxLines = 1, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f))
    }
}

@Composable
fun StatusPill(status: String) = when (status) {
    "pending" -> Pill("waiting", Warn)
    "approved", "used" -> Pill(status)
    else -> Pill(status, Danger)
}

/** Facts first, then the agent's reason (labeled unverified), then the signed decision. */
@Composable
fun ApprovalDetail(vm: AppViewModel, a: Approval, busy: Boolean) {
    val hardware = remember { KeystoreKey.load(AppViewModel.KEY_ALIAS)?.isHardware == true }
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            FlatCard {
                Fact("Agent", a.clientName)
                Fact("Action", a.title)
                Text("Target", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f), modifier = Modifier.padding(top = 6.dp))
                Text(a.target, fontFamily = FontFamily.Monospace, fontSize = 14.sp)
                Fact("Requested", ago(a.createdAt))
                a.detail.preview?.let { Fact("Value", it, mono = true) }
            }
        }
        a.detail.moves?.takeIf { it.isNotEmpty() }?.let { moves ->
            item {
                FlatCard {
                    Text("${moves.size} file move${if (moves.size == 1) "" else "s"}", fontWeight = FontWeight.SemiBold)
                    moves.forEach {
                        Text(it.from, fontFamily = FontFamily.Monospace, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
                        Text("→ ${it.to}", fontFamily = FontFamily.Monospace, fontSize = 12.sp, color = Accent)
                    }
                }
            }
        }
        a.detail.text?.let { item { FlatCard { Text(it, fontFamily = FontFamily.Monospace, fontSize = 12.sp) } } }
        if (a.reason.isNotEmpty()) {
            item {
                Section("Agent's stated reason (unverified)")
                Text(a.reason, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f))
            }
        }
        if (a.isPending) {
            item {
                Button(onClick = { vm.decide(a, Decision.APPROVED) }, enabled = !busy, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) { Text("Approve with fingerprint") }
                OutlinedButton(onClick = { vm.decide(a, Decision.DENIED) }, enabled = !busy, modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.outlinedButtonColors(contentColor = Danger)) { Text("Deny") }
                Text(
                    if (hardware) "Your decision is signed by this phone's hardware-backed key. Your node rejects high-risk approvals without it." else "Signed with a software key (emulator).",
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                )
            }
        } else {
            a.decidedBy?.let { item { FlatCard { Fact("Decided by", it) } } }
        }
    }
}

@Composable
fun Fact(label: String, value: String, mono: Boolean = false) {
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
        Text(label, modifier = Modifier.weight(1f))
        Text(value, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.65f), fontFamily = if (mono) FontFamily.Monospace else FontFamily.Default)
    }
}

// ----------------------------------------------------------------------------- inbox, upcoming

@Composable
fun InboxList(vm: AppViewModel, state: UiState) {
    val context = LocalContext.current
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (state.deliveries.isEmpty()) item { Text("Nothing here. Values agents send you appear here and are deleted after 24 hours.") }
        items(state.deliveries, key = { it.id }) { d ->
            val shown = d.id in state.revealed
            FlatCard {
                Text(d.title, fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
                Text("from ${d.clientName} · ${ago(d.at)}", color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f), fontSize = 14.sp)
                if (d.note.isNotEmpty()) Text(d.note, modifier = Modifier.padding(top = 6.dp))
                Row(
                    Modifier.fillMaxWidth().padding(top = 10.dp).background(MaterialTheme.colorScheme.surfaceContainer, RoundedCornerShape(8.dp)).padding(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(if (shown) d.value else "••••••••••", fontFamily = FontFamily.Monospace, fontSize = 20.sp, modifier = Modifier.weight(1f))
                    if (shown) {
                        OutlinedButton(onClick = {
                            // Marked sensitive so the keyboard/clipboard previews don't show it.
                            val clip = ClipData.newPlainText("Satchel", d.value).apply {
                                description.extras = PersistableBundle().apply { putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true) }
                            }
                            context.getSystemService(ClipboardManager::class.java).setPrimaryClip(clip)
                        }) { Text("Copy") }
                    } else {
                        OutlinedButton(onClick = { vm.reveal(d) }) { Text("Show") }
                    }
                }
            }
        }
    }
}

@Composable
fun UpcomingList(state: UiState) {
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (state.upcoming.isEmpty()) item { Text("No dates in the next six months.") }
        items(state.upcoming, key = { it.path + it.key }) { u ->
            FlatCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(u.title, fontWeight = FontWeight.SemiBold)
                        Text(listOfNotNull(u.subject, u.date).joinToString(" · "), fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f))
                    }
                    Pill(daysLabel(u.daysLeft), daysColor(u.daysLeft))
                }
            }
        }
    }
}

// ----------------------------------------------------------------------------- capture

@Composable
fun CaptureScreen(vm: AppViewModel, busy: Boolean) {
    val context = LocalContext.current
    val activity = context as MainActivity
    var note by remember { mutableStateOf("") }
    fun upload(uri: Uri, name: String, type: String) {
        context.contentResolver.openInputStream(uri)?.use { vm.capture(it.readBytes(), name, type, note) }
        note = ""
    }
    val scanLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { r ->
        GmsDocumentScanningResult.fromActivityResultIntent(r.data)?.pdf?.let { upload(it.uri, "Scan.pdf", "application/pdf") }
    }
    val photoLauncher = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> uri?.let { upload(it, "Photo.jpg", "image/jpeg") } }
    val fileLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> uri?.let { upload(it, "Document.pdf", context.contentResolver.getType(it) ?: "application/pdf") } }
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Button(onClick = {
            val options = GmsDocumentScannerOptions.Builder().setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_PDF).setGalleryImportAllowed(true).build()
            GmsDocumentScanning.getClient(options).getStartScanIntent(activity).addOnSuccessListener { scanLauncher.launch(IntentSenderRequest.Builder(it).build()) }
        }, modifier = Modifier.fillMaxWidth(), enabled = !busy) { Text("Scan a document") }
        OutlinedButton(onClick = { photoLauncher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }, modifier = Modifier.fillMaxWidth(), enabled = !busy) { Text("Choose a photo") }
        OutlinedButton(onClick = { fileLauncher.launch(arrayOf("application/pdf", "image/*")) }, modifier = Modifier.fillMaxWidth(), enabled = !busy) { Text("Choose a file") }
        OutlinedTextField(note, { note = it }, Modifier.fillMaxWidth(), label = { Text("Note for your agent (optional)") }, placeholder = { Text("New registration for the Civic") })
        Text("Captures go straight to your node's Inbox folder; your agent files them next time it checks in.", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f))
        if (busy) CircularProgressIndicator()
    }
}

// ----------------------------------------------------------------------------- settings

@Composable
fun SettingsScreen(vm: AppViewModel, state: UiState) {
    val key = remember(state.credentials) { KeystoreKey.load(AppViewModel.KEY_ALIAS) }
    var confirm by remember { mutableStateOf(false) }
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        state.credentials?.let { c ->
            item {
                Section("Node")
                FlatCard {
                    Fact("Name", c.nodeName)
                    Fact("Address", Uri.parse(c.url).host ?: c.url)
                    PinNote(c.pin != null)
                    state.node?.policy?.deviceSignature?.let { Fact("High-risk approvals", if (it == "never") "anywhere" else "signed devices only") }
                }
            }
        }
        item {
            Section("This phone")
            FlatCard {
                Fact("Key", if (key?.isHardware == true) "Hardware-backed (Keystore)" else "Software")
                key?.let { Fact("Fingerprint", dev.satchel.core.keyFingerprint(it.publicKey), mono = true) }
                Text("The private key never leaves secure hardware and only signs after biometric verification.", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f))
            }
        }
        item {
            Section("Wear OS watch")
            FlatCard { Text("Open Satchel on your watch and tap Enroll. You'll confirm here with your fingerprint.", color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f)) }
        }
        item { Section("Devices") }
        items(state.devices, key = { it.id }) { d ->
            FlatCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(d.name, fontWeight = FontWeight.SemiBold)
                        Text("${d.kind} · ${if (d.hardware) "hardware key" else "software key"}", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f))
                    }
                    if (d.id == state.credentials?.deviceId) Pill("this device") else TextButton(onClick = { vm.remove(d) }) { Text("Remove", color = Danger) }
                }
            }
        }
        item {
            OutlinedButton(onClick = { confirm = true }, modifier = Modifier.fillMaxWidth().padding(top = 12.dp), colors = ButtonDefaults.outlinedButtonColors(contentColor = Danger)) { Text("Unpair this phone") }
        }
    }
    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            title = { Text("Unpair this phone?") },
            text = { Text("Its key is deleted and its watch is removed too.") },
            confirmButton = { TextButton(onClick = { confirm = false; vm.unpair() }) { Text("Unpair", color = Danger) } },
            dismissButton = { TextButton(onClick = { confirm = false }) { Text("Cancel") } },
        )
    }
}
