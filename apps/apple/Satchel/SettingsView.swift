import SatchelKit
import SwiftUI
import WatchConnectivity

struct SettingsView: View {
    @EnvironmentObject var model: AppModel
    @ObservedObject private var watch = WatchSync.shared
    @State private var confirmUnpair = false

    var body: some View {
        List {
            if let c = model.credentials {
                Section("Node") {
                    LabeledContent("Name", value: c.nodeName)
                    LabeledContent("Address", value: c.url.host() ?? c.url.absoluteString)
                    if c.pin != nil {
                        Label("Pinned to the node's own key", systemImage: "lock.fill").foregroundStyle(Theme.accent)
                    } else {
                        Label("Home network only (no relay)", systemImage: "wifi").foregroundStyle(Theme.warn)
                    }
                    if let policy = model.node?.policy.deviceSignature {
                        LabeledContent("High-risk approvals", value: policy == "never" ? "anywhere" : "signed devices only")
                    }
                }
            }
            Section {
                LabeledContent("Key", value: model.key?.isHardware == true ? "Secure Enclave" : "Software (simulator)")
                if let fp = model.key?.fingerprint { LabeledContent("Fingerprint", value: fp).monospaced() }
            } header: {
                Text("This iPhone")
            } footer: {
                Text("The private key never leaves the Secure Enclave and only signs after Face ID.")
            }
            Section {
                if watch.isPaired {
                    if watch.isWatchAppInstalled {
                        Text(watch.status ?? "Open Satchel on your Apple Watch to enroll it. You'll confirm with Face ID here.").foregroundStyle(.secondary)
                    } else {
                        Text("Install Satchel on your Apple Watch from the Watch app.").foregroundStyle(.secondary)
                    }
                } else {
                    Text("No Apple Watch paired with this iPhone.").foregroundStyle(.secondary)
                }
            } header: {
                Text("Apple Watch")
            }
            Section("Devices") {
                ForEach(model.devices) { d in
                    HStack {
                        Image(systemName: d.kind == "watch" ? "applewatch" : "iphone")
                        VStack(alignment: .leading) {
                            Text(d.name)
                            Text(d.hardware ? "hardware key" : "software key").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if d.id == model.credentials?.deviceId { Pill(text: "this device") }
                    }
                    .swipeActions {
                        if d.id != model.credentials?.deviceId {
                            Button("Remove", role: .destructive) { Task { await model.remove(d) } }
                        }
                    }
                }
            }
            Section {
                Button("Unpair this iPhone", role: .destructive) { confirmUnpair = true }
            }
        }
        .navigationTitle("Settings")
        .refreshable { await model.refresh() }
        .confirmationDialog("Unpair this iPhone? Its key is deleted and its watch is removed too.", isPresented: $confirmUnpair, titleVisibility: .visible) {
            Button("Unpair", role: .destructive) { Task { await model.unpair() } }
        }
    }
}

/// iPhone side of watch enrollment over WatchConnectivity. The watch generates its own key and
/// sends the public key; this phone countersigns it (Face ID) and returns the watch's credentials.
final class WatchSync: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = WatchSync()
    @Published var isPaired = false
    @Published var isWatchAppInstalled = false
    @Published var status: String?
    private weak var model: AppModel?

    func activate(model: AppModel) {
        self.model = model
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func session(_ session: WCSession, activationDidCompleteWith _: WCSessionActivationState, error _: Error?) {
        DispatchQueue.main.async {
            self.isPaired = session.isPaired
            self.isWatchAppInstalled = session.isWatchAppInstalled
        }
    }

    func sessionWatchStateDidChange(_ session: WCSession) {
        DispatchQueue.main.async {
            self.isPaired = session.isPaired
            self.isWatchAppInstalled = session.isWatchAppInstalled
        }
    }

    func sessionDidBecomeInactive(_: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) { session.activate() }

    func session(_: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        guard message["type"] as? String == "enroll", let publicKey = message["public_key"] as? String else {
            return replyHandler(["error": "Unknown request"])
        }
        let name = message["name"] as? String ?? "Apple Watch"
        let hardware = message["hardware"] as? Bool ?? false
        Task { @MainActor in
            guard let model = self.model else { return replyHandler(["error": "iPhone app not ready"]) }
            do {
                let creds = try await model.enrollWatch(publicKey: publicKey, name: name, hardware: hardware)
                self.status = "\(name) can now approve requests."
                replyHandler(["credentials": try JSONEncoder().encode(creds)])
            } catch {
                self.status = error.localizedDescription
                replyHandler(["error": error.localizedDescription])
            }
        }
    }
}
