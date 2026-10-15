import SatchelKit
import SwiftUI
import WatchConnectivity
import WatchKit
import WidgetKit

@main
struct SatchelWatchApp: App {
    @StateObject private var model = WatchModel()

    var body: some Scene {
        WindowGroup {
            Group {
                if model.isEnrolled { WatchApprovalsView() } else { NavigationStack { EnrollView() } }
            }
            .environmentObject(model)
            .tint(Theme.accent)
            .task {
                #if DEBUG
                    let args = ProcessInfo.processInfo.arguments
                    if let i = args.firstIndex(of: "-SatchelPairLink"), i + 1 < args.count, !model.isEnrolled, let link = PairingLink(args[i + 1]) {
                        await model.pairDirectly(link)
                    }
                #endif
                await model.refresh()
            }
        }
    }
}

/// Watch state. The watch has its own Secure Enclave key; an unlocked, on-wrist watch is the
/// user-presence check, so signing doesn't ask for biometrics. It never displays delivered values.
@MainActor
final class WatchModel: NSObject, ObservableObject, WCSessionDelegate {
    @Published var credentials: Credentials?
    @Published var approvals: [Approval] = []
    @Published var upcoming: [Upcoming] = []
    @Published var error: String?
    @Published var busy = false
    private(set) var key: DeviceKey?
    private var client: NodeClient?
    static let keyLabel = "watch"

    override init() {
        super.init()
        credentials = Credentials.load()
        key = DeviceKey.load(label: Self.keyLabel)
        if let c = credentials { client = NodeClient(c) }
        if WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
        }
    }

    var isEnrolled: Bool { credentials != nil && key != nil }
    var pending: [Approval] { approvals.filter(\.isPending) }

    /// Asks the iPhone to vouch for this watch's new key (the phone confirms with Face ID).
    func enroll() {
        busy = true
        error = nil
        do {
            DeviceKey.delete(label: Self.keyLabel)
            let key = try DeviceKey.create(label: Self.keyLabel, requireBiometrics: false)
            guard WCSession.default.isReachable else {
                busy = false
                error = "Open Satchel on your iPhone first."
                return
            }
            let message: [String: Any] = ["type": "enroll", "public_key": key.publicKey, "name": WKInterfaceDevice.current().name, "hardware": key.isHardware]
            WCSession.default.sendMessage(message, replyHandler: { reply in
                Task { @MainActor in
                    self.busy = false
                    if let data = reply["credentials"] as? Data, let creds = try? JSONDecoder().decode(Credentials.self, from: data) {
                        try? creds.save()
                        self.key = key
                        self.credentials = creds
                        self.client = NodeClient(creds)
                        await self.refresh()
                    } else {
                        self.error = reply["error"] as? String ?? "Enrollment failed"
                    }
                }
            }, errorHandler: { err in
                Task { @MainActor in
                    self.busy = false
                    self.error = err.localizedDescription
                }
            })
        } catch {
            busy = false
            self.error = error.localizedDescription
        }
    }

    #if DEBUG
        /// Simulator/screenshot path: pair the watch directly with a pairing code.
        func pairDirectly(_ link: PairingLink) async {
            do {
                let key = try DeviceKey.create(label: Self.keyLabel, requireBiometrics: false)
                let c = NodeClient(baseURL: link.url, token: nil, pin: link.pin)
                let r = try await c.pair(link: link, key: key, name: "Apple Watch", platform: "watchos", kind: "watch")
                let creds = Credentials(url: link.url, token: r.token, deviceId: r.id, nodeId: r.node.id, nodeName: r.node.name, pin: link.pin, keyLabel: Self.keyLabel)
                try creds.save()
                self.key = key
                credentials = creds
                client = NodeClient(creds)
            } catch {
                self.error = error.localizedDescription
            }
        }
    #endif

    func refresh() async {
        guard let client else { return }
        do {
            async let a = client.approvals()
            async let u = client.upcoming()
            (approvals, upcoming) = try await (a, u)
            error = nil
            ComplicationData.save(pending: pending.count, next: upcoming.first(where: { $0.daysLeft >= 0 }))
        } catch {
            self.error = error.localizedDescription
        }
    }

    func decide(_ approval: Approval, _ decision: Decision) async -> Bool {
        guard let client, let key else { return false }
        busy = true
        defer { busy = false }
        do {
            _ = try await client.decide(approval, decision, key: key)
            WKInterfaceDevice.current().play(.success)
            await refresh()
            return true
        } catch {
            WKInterfaceDevice.current().play(.failure)
            self.error = error.localizedDescription
            return false
        }
    }

    nonisolated func session(_: WCSession, activationDidCompleteWith _: WCSessionActivationState, error _: Error?) {}
}

/// Numbers for the watch-face complication, shared through the app group.
enum ComplicationData {
    static let suite = UserDefaults(suiteName: "group.dev.satchel") ?? .standard

    static func save(pending: Int, next: Upcoming?) {
        suite.set(pending, forKey: "pending")
        suite.set(next?.title, forKey: "nextTitle")
        suite.set(next?.daysLeft, forKey: "nextDays")
        WidgetCenter.shared.reloadAllTimelines()
    }
}
