package dev.satchel.wear

import android.content.Context
import androidx.wear.watchface.complications.data.ComplicationData
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.PlainComplicationText
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import androidx.wear.watchface.complications.datasource.SuspendingComplicationDataSourceService

/** Watch-face complication: how many requests are waiting for approval. */
class PendingComplicationService : SuspendingComplicationDataSourceService() {
    companion object {
        fun save(context: Context, pending: Int) {
            context.getSharedPreferences("complication", Context.MODE_PRIVATE).edit().putInt("pending", pending).apply()
            context.complicationRequester().requestUpdateAll()
        }
    }

    private fun data(pending: Int): ComplicationData = ShortTextComplicationData.Builder(
        PlainComplicationText.Builder(if (pending > 0) "$pending" else "✓").build(),
        PlainComplicationText.Builder(if (pending > 0) "$pending Satchel approvals waiting" else "Nothing to approve").build(),
    ).setTitle(PlainComplicationText.Builder("Satchel").build()).build()

    override fun getPreviewData(type: ComplicationType): ComplicationData? = if (type == ComplicationType.SHORT_TEXT) data(2) else null

    override suspend fun onComplicationRequest(request: ComplicationRequest): ComplicationData =
        data(getSharedPreferences("complication", Context.MODE_PRIVATE).getInt("pending", 0))
}
