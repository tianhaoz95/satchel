import SatchelKit
import SwiftUI
import UIKit

/// Values agents sent with `deliver_to_user`. Hidden until Face ID; copies expire from the clipboard.
struct InboxView: View {
    @EnvironmentObject var model: AppModel
    @State private var copied: String?

    var body: some View {
        List {
            if model.deliveries.isEmpty {
                Text("Nothing here. Values agents send you appear here and are deleted after 24 hours.").foregroundStyle(.secondary)
            }
            ForEach(model.deliveries) { d in
                VStack(alignment: .leading, spacing: 8) {
                    Text(d.title).font(.headline)
                    Text("from \(d.clientName) · \(d.date, format: .relative(presentation: .named))").font(.subheadline).foregroundStyle(.secondary)
                    if !d.note.isEmpty { Text(d.note).font(.callout) }
                    HStack {
                        Text(model.revealed.contains(d.id) ? d.value : String(repeating: "•", count: 10))
                            .font(.title3.monospaced())
                            .textSelection(.enabled)
                        Spacer()
                        if model.revealed.contains(d.id) {
                            Button(copied == d.id ? "Copied" : "Copy") {
                                UIPasteboard.general.setItems([[UIPasteboard.typeAutomatic: d.value]], options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(60)])
                                copied = d.id
                            }
                            .buttonStyle(.bordered)
                        } else {
                            Button { Task { await model.reveal(d) } } label: { Label("Show", systemImage: "faceid") }
                                .buttonStyle(.bordered)
                        }
                    }
                    .padding(10)
                    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 8))
                }
                .padding(.vertical, 4)
            }
        }
        .navigationTitle("Inbox")
        .refreshable { await model.refresh() }
    }
}

struct UpcomingView: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        List {
            if model.upcoming.isEmpty { Text("No dates in the next six months.").foregroundStyle(.secondary) }
            ForEach(model.upcoming) { u in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(u.title).font(.headline)
                        Text([u.subject, u.date].compactMap { $0 }.joined(separator: " · ")).font(.subheadline).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Pill(text: Theme.daysLabel(u.daysLeft), color: Theme.daysColor(u.daysLeft))
                }
            }
        }
        .navigationTitle("Upcoming")
        .refreshable { await model.refresh() }
    }
}
