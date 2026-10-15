import LocalAuthentication
import SatchelKit
import SwiftUI
import UserNotifications

/// App state: pairing, the device key, and data from the node. All network calls go through a
/// pinned `NodeClient`; every decision is signed by the Secure Enclave key after Face ID.
@MainActor
final class AppModel: ObservableObject {
    enum Tab: String, CaseIterable { case approvals, inbox, upcoming, capture, settings }

    @Published var credentials: Credentials?
    @Published var approvals: [Approval] = []
    @Published var deliveries: [Delivery] = []
    @Published var upcoming: [Upcoming] = []
    @Published var devices: [DeviceInfo] = []
    @Published var node: NodeInfo?
    @Published var tab: Tab = .approvals
    @Published var error: String?
    @Published var busy = false
    @Published var revealed: Set<String> = []

    private(set) var key: DeviceKey?
    private var client: NodeClient?
    static let keyLabel = "phone"

    /// Debug-only switches used by UI tests and screenshot automation (ignored in Release builds).
    let skipAuth: Bool = {
        #if DEBUG
            ProcessInfo.processInfo.arguments.contains("-SatchelSkipAuth")
        #else
            false
        #endif
    }()

    init() {
        credentials = Credentials.load()
        key = DeviceKey.load(label: Self.keyLabel)
        if let c = credentials { client = NodeClient(c) }
        #if DEBUG
            let args = ProcessInfo.processInfo.arguments
            if let i = args.firstIndex(of: "-SatchelTab"), i + 1 < args.count, let t = Tab(rawValue: args[i + 1]) { tab = t }
        #endif
    }

    var isPaired: Bool { credentials != nil && key != nil }
    var pendingCount: Int { approvals.filter(\.isPending).count }

    // MARK: pairing

    func pair(_ link: PairingLink) async {
        busy = true
        defer { busy = false }
        do {
            DeviceKey.delete(label: Self.keyLabel)
            let key = try DeviceKey.create(label: Self.keyLabel, requireBiometrics: !skipAuth)
            let c = NodeClient(baseURL: link.url, token: nil, pin: link.pin)
            let result = try await c.pair(link: link, key: key, name: UIDevice.current.name, platform: "ios")
            let creds = Credentials(url: link.url, token: result.token, deviceId: result.id, nodeId: result.node.id, nodeName: result.node.name, pin: link.pin, keyLabel: Self.keyLabel)
            try creds.save()
            self.key = key
            credentials = creds
            client = NodeClient(creds)
            error = nil
            await refresh()
            PushRegistrar.requestAuthorization()
        } catch {
            DeviceKey.delete(label: Self.keyLabel)
            self.error = error.localizedDescription
        }
    }

    func unpair() async {
        if let c = client, let id = credentials?.deviceId { try? await c.removeDevice(id) }
        Credentials.clear()
        DeviceKey.delete(label: Self.keyLabel)
        credentials = nil
        key = nil
        client = nil
        approvals = []
        deliveries = []
        upcoming = []
        devices = []
    }

    // MARK: data

    func refresh() async {
        guard let client else { return }
        do {
            async let a = client.approvals()
            async let d = client.deliveries()
            async let u = client.upcoming()
            async let n = client.node()
            async let dev = client.devices()
            (approvals, deliveries, upcoming, node, devices) = try await (a, d, u, n, dev)
            #if DEBUG
                if ProcessInfo.processInfo.arguments.contains("-SatchelRevealAll") { revealed = Set(deliveries.map(\.id)) }
            #endif
            error = nil
            try? await UNUserNotificationCenter.current().setBadgeCount(pendingCount)
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
            await refresh()
            return true
        } catch DeviceKey.KeyError.cancelled {
            return false
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    /// Showing a delivered value needs Face ID (or the passcode), separately from the signing key.
    func reveal(_ delivery: Delivery) async {
        let allowed = skipAuth ? true : await authenticate(reason: "Show \(delivery.title)")
        if allowed {
            revealed.insert(delivery.id)
            try? await client?.markSeen(delivery.id)
        }
    }

    func authenticate(reason: String) async -> Bool {
        let context = LAContext()
        return (try? await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)) ?? false
    }

    func capture(_ data: Data, filename: String, contentType: String, note: String) async -> String? {
        guard let client else { return nil }
        busy = true
        defer { busy = false }
        do {
            return try await client.capture(data, filename: filename, contentType: contentType, note: note)
        } catch {
            self.error = error.localizedDescription
            return nil
        }
    }

    func remove(_ device: DeviceInfo) async {
        try? await client?.removeDevice(device.id)
        await refresh()
    }

    // MARK: watch + push

    /// Called by `WatchSync` when the watch asks to be enrolled. Signs with this phone's key.
    func enrollWatch(publicKey: String, name: String, hardware: Bool) async throws -> Credentials {
        guard let client, let key, let creds = credentials else { throw NodeError.invalidResponse }
        let r = try await client.enrollChild(publicKey: publicKey, name: name, platform: "watchos", hardware: hardware, nodeId: creds.nodeId, parentId: creds.deviceId, key: key)
        await refresh()
        return Credentials(url: creds.url, token: r.token, deviceId: r.id, nodeId: creds.nodeId, nodeName: creds.nodeName, pin: creds.pin, keyLabel: "watch")
    }

    func registerPush(token: Data) async {
        guard let client else { return }
        #if DEBUG
            let sandbox = true
        #else
            let sandbox = false
        #endif
        if let ticket = try? await PushGateway.register(token: token, sandbox: sandbox, topic: Bundle.main.bundleIdentifier ?? "dev.satchel.ios") {
            try? await client.setPushTicket(ticket)
        }
    }
}
