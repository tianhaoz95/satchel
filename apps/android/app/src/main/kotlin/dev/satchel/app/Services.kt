package dev.satchel.app

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import dev.satchel.core.CredentialsStore
import dev.satchel.core.NodeClient
import dev.satchel.core.PushGateway
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

class SatchelApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // Push is optional: without Firebase config the app works, it just doesn't get woken.
        if (BuildConfig.FIREBASE_APP_ID.isNotEmpty()) {
            FirebaseApp.initializeApp(
                this,
                FirebaseOptions.Builder()
                    .setApplicationId(BuildConfig.FIREBASE_APP_ID)
                    .setApiKey(BuildConfig.FIREBASE_API_KEY)
                    .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
                    .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
                    .build(),
            )
        }
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("approvals", "Approvals", NotificationManager.IMPORTANCE_HIGH))
    }
}

object PushRegistration {
    private val scope = CoroutineScope(Dispatchers.IO)

    fun register(context: Context, token: String? = null) {
        if (FirebaseApp.getApps(context).isEmpty()) return
        scope.launch {
            runCatching {
                val creds = CredentialsStore(context).load() ?: return@launch
                val fcm = token ?: FirebaseMessaging.getInstance().token.await()
                NodeClient(creds).setPushTicket(PushGateway.register(fcm))
            }
        }
    }
}

/** The gateway sends data-only messages ({kind}); the notification text is generic and local. */
class PushService : FirebaseMessagingService() {
    override fun onNewToken(token: String) = PushRegistration.register(this, token)

    override fun onMessageReceived(message: RemoteMessage) {
        val kind = message.data["kind"] ?: "approval"
        val intent = Intent(this, MainActivity::class.java).putExtra("tab", if (kind == "delivery") "inbox" else "approvals")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val pi = PendingIntent.getActivity(this, kind.hashCode(), intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = android.app.Notification.Builder(this, "approvals")
            .setSmallIcon(R.drawable.ic_satchel)
            .setContentTitle("Satchel")
            .setContentText(if (kind == "delivery") "You have something new in your inbox" else "Something needs your approval")
            .setContentIntent(pi)
            .setAutoCancel(true)
            .build()
        getSystemService(NotificationManager::class.java).notify(kind.hashCode(), n)
    }
}

/** A Wear OS watch asks to be enrolled: hand the request to the app, where the owner confirms. */
class WatchEnrollService : WearableListenerService() {
    override fun onMessageReceived(event: MessageEvent) {
        if (event.path != "/satchel/enroll") return
        val obj = runCatching { Json.parseToJsonElement(String(event.data)).jsonObject }.getOrNull() ?: return
        startActivity(
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                .putExtra("watchNode", event.sourceNodeId)
                .putExtra("watchKey", obj["public_key"]?.jsonPrimitive?.content)
                .putExtra("watchName", obj["name"]?.jsonPrimitive?.content ?: "Watch")
                .putExtra("watchHardware", obj["hardware"]?.jsonPrimitive?.boolean ?: false),
        )
    }
}
