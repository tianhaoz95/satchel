import Foundation

/// Canonical byte strings of companion protocol v2 (spec/companion/protocol.md). They must match
/// the node byte for byte; `VectorsTests` checks them against spec/companion/test-vectors.json.
public enum CompanionProtocol {
    public static func pairingMessage(nodeId: String, code: String, publicKey: String) -> String {
        ["satchel-pair-v1", nodeId, code.uppercased(), publicKey].joined(separator: "\n")
    }

    public static func enrollMessage(nodeId: String, parentId: String, childPublicKey: String, signedAt: Int64) -> String {
        ["satchel-enroll-v1", nodeId, parentId, childPublicKey, String(signedAt)].joined(separator: "\n")
    }

    public static func approvalMessage(nodeId: String, approvalId: String, decision: Decision, action: String, target: String, detailHash: String, signedAt: Int64) -> String {
        ["satchel-approval-v1", nodeId, approvalId, decision.rawValue, action, target, detailHash, String(signedAt)].joined(separator: "\n")
    }

    public static func nowMillis() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }
}

public enum Decision: String, Codable, Sendable {
    case approved
    case denied
}

/// `satchel://pair?v=2&url=…&code=…&node=…&name=…&pin=…` (form-encoded: `+` is a space).
public struct PairingLink: Equatable, Sendable {
    public let url: URL
    public let code: String
    public let nodeId: String
    public let nodeName: String
    public let pin: String?

    public init(url: URL, code: String, nodeId: String, nodeName: String, pin: String?) {
        self.url = url
        self.code = code
        self.nodeId = nodeId
        self.nodeName = nodeName
        self.pin = pin
    }

    public init?(_ string: String) {
        guard let comps = URLComponents(string: string.trimmingCharacters(in: .whitespacesAndNewlines)),
              comps.scheme == "satchel", comps.host == "pair" else { return nil }
        var q: [String: String] = [:]
        for pair in (comps.percentEncodedQuery ?? "").split(separator: "&") {
            let kv = pair.split(separator: "=", maxSplits: 1).map(String.init)
            guard kv.count == 2 else { continue }
            let decode = { (s: String) in s.replacingOccurrences(of: "+", with: " ").removingPercentEncoding ?? s }
            q[decode(kv[0])] = decode(kv[1])
        }
        guard q["v"] == "2", let u = q["url"].flatMap(URL.init(string:)), let code = q["code"], let node = q["node"] else { return nil }
        self.init(url: u, code: code, nodeId: node, nodeName: q["name"] ?? "Satchel", pin: q["pin"])
    }

    /// Pairing over plain HTTP (a node on the LAN without TLS) can't be pinned; the UI warns.
    public var isPinned: Bool { pin != nil && url.scheme == "https" }
}
