import SatchelKit
import SwiftUI

struct ApprovalsView: View {
    @EnvironmentObject var model: AppModel
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
            if let error = model.error { ErrorRow(message: error) }
            let pending = model.approvals.filter(\.isPending)
            Section {
                if pending.isEmpty {
                    Text("Nothing needs you right now.").foregroundStyle(.secondary)
                }
                ForEach(pending) { a in
                    NavigationLink(value: a) { ApprovalRow(approval: a) }
                }
            } header: {
                Text("Waiting for you")
            }
            let recent = model.approvals.filter { !$0.isPending }.prefix(10)
            if !recent.isEmpty {
                Section("Recent") {
                    ForEach(Array(recent)) { a in
                        NavigationLink(value: a) { ApprovalRow(approval: a) }
                    }
                }
            }
        }
        .navigationTitle("Approvals")
        .navigationDestination(for: Approval.self) { ApprovalDetailView(approval: $0) }
        .refreshable { await model.refresh() }
    }
}

struct ApprovalRow: View {
    let approval: Approval

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(approval.title).font(.headline)
                Spacer()
                StatusPill(status: approval.status)
            }
            Text("\(approval.clientName) · \(approval.created, format: .relative(presentation: .named))").font(.subheadline).foregroundStyle(.secondary)
            Text(approval.target).font(.caption.monospaced()).foregroundStyle(.secondary).lineLimit(1)
        }
        .padding(.vertical, 2)
    }
}

struct StatusPill: View {
    let status: String
    var body: some View {
        switch status {
        case "pending": Pill(text: "waiting", color: Theme.warn)
        case "approved", "used": Pill(text: status)
        default: Pill(text: status, color: Theme.danger)
        }
    }
}

/// Facts first; the agent's reason is shown last and labeled unverified.
struct ApprovalDetailView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let approval: Approval

    var body: some View {
        List {
            Section {
                LabeledContent("Agent", value: approval.clientName)
                LabeledContent("Action", value: approval.title)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Target").foregroundStyle(.secondary).font(.subheadline)
                    Text(approval.target).font(.callout.monospaced()).textSelection(.enabled)
                }
                LabeledContent("Requested") { Text(approval.created, format: .relative(presentation: .named)) }
                if let preview = approval.detail.preview {
                    LabeledContent("Value", value: preview).monospaced()
                }
            }
            if let moves = approval.detail.moves, !moves.isEmpty {
                Section("\(moves.count) file move\(moves.count == 1 ? "" : "s")") {
                    ForEach(moves, id: \.from) { m in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(m.from).font(.caption.monospaced()).foregroundStyle(.secondary)
                            Text("→ \(m.to)").font(.caption.monospaced()).foregroundStyle(Theme.accent)
                        }
                    }
                }
            }
            if let text = approval.detail.text {
                Section("Proposed VAULT.md") { Text(text).font(.caption.monospaced()) }
            }
            if !approval.reason.isEmpty {
                Section {
                    Text(approval.reason).foregroundStyle(.secondary)
                } header: {
                    Text("Agent's stated reason (unverified)")
                }
            }
            if approval.isPending {
                Section {
                    Button {
                        Task { if await model.decide(approval, .approved) { dismiss() } }
                    } label: {
                        Label("Approve with Face ID", systemImage: "faceid").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .listRowBackground(Color.clear)
                    Button(role: .destructive) {
                        Task { if await model.decide(approval, .denied) { dismiss() } }
                    } label: {
                        Text("Deny").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .tint(Theme.danger)
                    .listRowBackground(Color.clear)
                } footer: {
                    Text(model.key?.isHardware == true
                        ? "Your decision is signed by this iPhone's Secure Enclave key. Your node rejects high-risk approvals without it."
                        : "Simulator: signed with a software key.")
                }
                .disabled(model.busy)
            } else if let by = approval.decidedBy {
                Section { LabeledContent("Decided by", value: by) }
            }
        }
        .navigationTitle(approval.title)
        .navigationBarTitleDisplayMode(.inline)
    }
}
