import SatchelKit
import SwiftUI

struct EnrollView: View {
    @EnvironmentObject var model: WatchModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Image(systemName: "applewatch.radiowaves.left.and.right").font(.title2).foregroundStyle(Theme.accent)
                Text("Set up Satchel").font(.headline)
                Text("Keep Satchel open on your iPhone. It confirms with Face ID that this watch may approve requests.")
                    .font(.footnote).foregroundStyle(.secondary)
                if let error = model.error { Text(error).font(.footnote).foregroundStyle(Theme.danger) }
                Button(model.busy ? "Waiting for iPhone…" : "Enroll this watch") { model.enroll() }
                    .disabled(model.busy)
            }
        }
        .navigationTitle("Satchel")
    }
}

struct WatchApprovalsView: View {
    @EnvironmentObject var model: WatchModel
    @State private var path: [Approval] = []

    var body: some View {
        NavigationStack(path: $path) { list }
            .onChange(of: model.approvals) { _, approvals in
                #if DEBUG
                    if ProcessInfo.processInfo.arguments.contains("-SatchelOpenFirstApproval"), path.isEmpty, let first = approvals.first(where: \.isPending) {
                        path = [first]
                    }
                #endif
            }
    }

    private var list: some View {
        List {
            if let error = model.error { Text(error).font(.footnote).foregroundStyle(Theme.danger) }
            if model.pending.isEmpty {
                Text("Nothing needs you.").foregroundStyle(.secondary)
            }
            ForEach(model.pending) { a in
                NavigationLink(value: a) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(a.title).font(.headline)
                        Text(a.clientName).font(.footnote).foregroundStyle(.secondary)
                    }
                }
            }
            if let next = model.upcoming.first(where: { $0.daysLeft >= 0 }) {
                Section("Next") {
                    HStack {
                        Text(next.title).font(.footnote)
                        Spacer()
                        Text(Theme.daysLabel(next.daysLeft)).font(.footnote.weight(.semibold)).foregroundStyle(Theme.daysColor(next.daysLeft))
                    }
                }
            }
        }
        .navigationTitle("Approve")
        .navigationDestination(for: Approval.self) { WatchApprovalDetail(approval: $0) }
        .refreshable { await model.refresh() }
    }
}

/// Facts first, then Approve / Deny. Values are never shown on the watch.
struct WatchApprovalDetail: View {
    @EnvironmentObject var model: WatchModel
    @Environment(\.dismiss) private var dismiss
    let approval: Approval

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                Text(approval.title).font(.headline)
                Text(approval.clientName).font(.footnote).foregroundStyle(.secondary)
                Text(approval.target).font(.caption2.monospaced()).lineLimit(4)
                if let moves = approval.detail.moves { Text("\(moves.count) file move\(moves.count == 1 ? "" : "s")").font(.footnote) }
                if !approval.reason.isEmpty {
                    Text("Reason (unverified): \(approval.reason)").font(.caption2).foregroundStyle(.secondary)
                }
                Button("Approve") { Task { if await model.decide(approval, .approved) { dismiss() } } }
                    .tint(Theme.accent)
                    .disabled(model.busy)
                Button("Deny", role: .destructive) { Task { if await model.decide(approval, .denied) { dismiss() } } }
                    .disabled(model.busy)
            }
        }
    }
}
