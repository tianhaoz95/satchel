import Foundation

public struct Approval: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let clientName: String
    public let action: String
    public let target: String
    public let reason: String
    public let status: String
    public let createdAt: Double
    public let decidedBy: String?
    public let detail: ApprovalDetail
    // Signing info (v2)
    public let nodeId: String?
    public let detailHash: String?
    public let requiresSignature: Bool?

    public var isPending: Bool { status == "pending" }
    public var created: Date { Date(timeIntervalSince1970: createdAt / 1000) }

    public var title: String {
        switch action {
        case "reveal_field": "See a sensitive value"
        case "apply_plan": "Reorganize files"
        case "update_conventions": "Change VAULT.md"
        case "set_metadata": "Edit metadata"
        default: action
        }
    }

    enum CodingKeys: String, CodingKey {
        case id, action, target, reason, status, detail
        case clientName = "client_name", createdAt = "created_at", decidedBy = "decided_by"
        case nodeId = "node_id", detailHash = "detail_hash", requiresSignature = "requires_signature"
    }
}

/// The parts of an approval's detail the apps display. Unknown keys are ignored.
public struct ApprovalDetail: Codable, Hashable, Sendable {
    public struct Move: Codable, Hashable, Sendable {
        public let from: String
        public let to: String
    }

    public let path: String?
    public let key: String?
    public let preview: String?
    public let moves: [Move]?
    public let text: String?
    public let root: String?
}

public struct Delivery: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let at: Double
    public let clientName: String
    public let title: String
    public let value: String
    public let note: String
    public let seen: Int

    public var date: Date { Date(timeIntervalSince1970: at / 1000) }

    enum CodingKeys: String, CodingKey {
        case id, at, title, value, note, seen
        case clientName = "client_name"
    }
}

public struct Upcoming: Codable, Identifiable, Hashable, Sendable {
    public let key: String
    public let date: String
    public let path: String
    public let title: String
    public let subject: String?

    public var id: String { "\(path)#\(key)" }

    public var daysLeft: Int {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "UTC")
        guard let d = f.date(from: date) else { return 0 }
        let today = f.date(from: f.string(from: Date()))!
        return Int((d.timeIntervalSince(today) / 86400).rounded())
    }
}

public struct DeviceInfo: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String
    public let platform: String
    public let kind: String
    public let parentId: String?
    public let hardware: Bool
    public let signing: Bool
    public let keyFingerprint: String?
    public let lastSeen: Double?
    public let push: Bool

    enum CodingKeys: String, CodingKey {
        case id, name, platform, kind, hardware, signing, push
        case parentId = "parent_id", keyFingerprint = "key_fingerprint", lastSeen = "last_seen"
    }
}

public struct NodeInfo: Codable, Sendable {
    public struct Policy: Codable, Sendable {
        public let deviceSignature: String
        enum CodingKeys: String, CodingKey { case deviceSignature = "device_signature" }
    }

    public let id: String
    public let name: String
    public let pin: String?
    public let policy: Policy
    public let me: DeviceInfo?
}

/// What a device keeps after pairing: where its node is, how to authenticate, and the pin.
public struct Credentials: Codable, Equatable, Sendable {
    public var url: URL
    public var token: String
    public var deviceId: String
    public var nodeId: String
    public var nodeName: String
    public var pin: String?
    public var keyLabel: String

    public init(url: URL, token: String, deviceId: String, nodeId: String, nodeName: String, pin: String?, keyLabel: String) {
        self.url = url
        self.token = token
        self.deviceId = deviceId
        self.nodeId = nodeId
        self.nodeName = nodeName
        self.pin = pin
        self.keyLabel = keyLabel
    }

    public static func load() -> Credentials? {
        guard let (data, _) = Keychain.get(account: "credentials") else { return nil }
        return try? JSONDecoder().decode(Credentials.self, from: data)
    }

    public func save() throws {
        try Keychain.set(try JSONEncoder().encode(self), account: "credentials")
    }

    public static func clear() {
        Keychain.delete(account: "credentials")
    }
}
