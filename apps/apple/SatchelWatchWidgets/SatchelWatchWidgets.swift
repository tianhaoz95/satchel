import SwiftUI
import WidgetKit

struct Entry: TimelineEntry {
    let date: Date
    let pending: Int
    let nextTitle: String?
    let nextDays: Int?
}

struct Provider: TimelineProvider {
    private var suite: UserDefaults { UserDefaults(suiteName: "group.dev.satchel") ?? .standard }

    private func current() -> Entry {
        Entry(date: .now, pending: suite.integer(forKey: "pending"), nextTitle: suite.string(forKey: "nextTitle"), nextDays: suite.object(forKey: "nextDays") as? Int)
    }

    func placeholder(in _: Context) -> Entry { Entry(date: .now, pending: 1, nextTitle: "Registration", nextDays: 21) }
    func getSnapshot(in _: Context, completion: @escaping (Entry) -> Void) { completion(current()) }
    func getTimeline(in _: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        completion(Timeline(entries: [current()], policy: .after(.now.addingTimeInterval(30 * 60))))
    }
}

/// Watch-face complication: pending approvals, or the next expiring record.
struct SatchelComplicationView: View {
    @Environment(\.widgetFamily) private var family
    let entry: Entry

    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Image(systemName: "checkmark.shield")
                    Text("\(entry.pending)").font(.headline)
                }
            }
        case .accessoryInline:
            Text(entry.pending > 0 ? "\(entry.pending) to approve" : "Satchel: all clear")
        default:
            VStack(alignment: .leading) {
                Text(entry.pending > 0 ? "\(entry.pending) waiting for approval" : "Nothing to approve").font(.headline)
                if let t = entry.nextTitle, let d = entry.nextDays { Text("\(t) in \(d) d").font(.caption) }
            }
        }
    }
}

@main
struct SatchelWatchWidgets: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "SatchelComplication", provider: Provider()) { entry in
            SatchelComplicationView(entry: entry).containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Satchel")
        .description("Pending approvals and the next expiring record.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}
