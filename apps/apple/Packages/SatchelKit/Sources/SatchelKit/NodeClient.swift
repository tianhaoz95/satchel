import Foundation

public enum NodeError: LocalizedError, Sendable {
    case http(Int, String, code: String?)
    case pinMismatch
    case invalidResponse

    public var errorDescription: String? {
        switch self {
        case let .http(_, message, _): message
        case .pinMismatch: "The node's certificate doesn't match the one you paired with. Satchel refused to connect."
        case .invalidResponse: "Unexpected response from the node"
        }
    }
}

/// Accepts the server only if its leaf key matches the pin from pairing. The pin replaces CA trust:
/// it works for self-signed node certificates and defeats a mis-issued certificate for the node's name.
final class PinningDelegate: NSObject, URLSessionDelegate, @unchecked Sendable {
    let pin: String?
    private(set) var mismatched = false

    init(pin: String?) {
        self.pin = pin
    }

    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust, let trust = challenge.protectionSpace.serverTrust else {
            return completionHandler(.performDefaultHandling, nil)
        }
        guard let pin else { return completionHandler(.performDefaultHandling, nil) }
        if let leaf = (SecTrustCopyCertificateChain(trust) as? [SecCertificate])?.first, let key = SecCertificateCopyKey(leaf), Pin.of(key) == pin {
            return completionHandler(.useCredential, URLCredential(trust: trust))
        }
        mismatched = true
        completionHandler(.cancelAuthenticationChallenge, nil)
    }
}

/// Talks to the owner's node (companion protocol v2) over a pinned session.
public final class NodeClient: @unchecked Sendable {
    public let baseURL: URL
    public private(set) var token: String?
    private let delegate: PinningDelegate
    private let session: URLSession

    public init(baseURL: URL, token: String?, pin: String?) {
        self.baseURL = baseURL
        self.token = token
        delegate = PinningDelegate(pin: pin)
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 20
        config.waitsForConnectivity = false
        session = URLSession(configuration: config, delegate: delegate, delegateQueue: nil)
    }

    public convenience init(_ c: Credentials) {
        self.init(baseURL: c.url, token: c.token, pin: c.pin)
    }

    private func request(_ path: String, method: String = "GET", json: Any? = nil, body: Data? = nil, headers: [String: String] = [:]) async throws -> Data {
        let parts = path.split(separator: "?", maxSplits: 1).map(String.init)
        var comps = URLComponents(url: baseURL.appendingPathComponent("app/api").appendingPathComponent(parts[0]), resolvingAgainstBaseURL: false)!
        if parts.count == 2 { comps.percentEncodedQuery = parts[1] }
        var req = URLRequest(url: comps.url!)
        req.httpMethod = method
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let json {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: json)
        } else if let body {
            req.httpBody = body
        }
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: req)
        } catch {
            if delegate.mismatched { throw NodeError.pinMismatch }
            throw error
        }
        guard let http = response as? HTTPURLResponse else { throw NodeError.invalidResponse }
        guard (200 ..< 300).contains(http.statusCode) else {
            let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            throw NodeError.http(http.statusCode, obj?["error"] as? String ?? "HTTP \(http.statusCode)", code: obj?["code"] as? String)
        }
        return data
    }

    private func decode<T: Decodable>(_ type: T.Type, _ data: Data) throws -> T {
        try JSONDecoder().decode(T.self, from: data)
    }

    // MARK: pairing

    public struct PairResult: Decodable, Sendable {
        public struct Node: Decodable, Sendable {
            public let id: String
            public let name: String
            public let pin: String?
        }

        public let id: String
        public let token: String
        public let node: Node
    }

    /// Pairs this device: proves possession of `key` by signing the pairing message.
    public func pair(link: PairingLink, key: DeviceKey, name: String, platform: String, kind: String = "phone") async throws -> PairResult {
        let message = CompanionProtocol.pairingMessage(nodeId: link.nodeId, code: link.code, publicKey: key.publicKey)
        let signature = try key.sign(message, reason: "Pair this device with \(link.nodeName)")
        let data = try await request("v2/pair", method: "POST", json: [
            "code": link.code, "name": name, "platform": platform, "kind": kind,
            "hardware": key.isHardware, "public_key": key.publicKey, "signature": signature,
        ])
        let result = try decode(PairResult.self, data)
        guard result.node.id == link.nodeId else { throw NodeError.invalidResponse }
        token = result.token
        return result
    }

    // MARK: reads

    public func node() async throws -> NodeInfo { try decode(NodeInfo.self, try await request("v2/node")) }
    public func approvals(pendingOnly: Bool = false) async throws -> [Approval] {
        try decode([Approval].self, try await request(pendingOnly ? "v2/approvals?status=pending" : "v2/approvals"))
    }

    public func deliveries() async throws -> [Delivery] { try decode([Delivery].self, try await request("deliveries")) }
    public func upcoming() async throws -> [Upcoming] { try decode([Upcoming].self, try await request("upcoming")) }
    public func devices() async throws -> [DeviceInfo] { try decode([DeviceInfo].self, try await request("v2/devices")) }

    public func markSeen(_ delivery: String) async throws {
        _ = try await request("deliveries/\(delivery)/seen", method: "POST", json: [String: String]())
    }

    // MARK: decisions

    /// Signs the decision with the device key (Face ID on iPhone), then submits it.
    public func decide(_ approval: Approval, _ decision: Decision, key: DeviceKey) async throws -> Approval {
        guard let nodeId = approval.nodeId, let hash = approval.detailHash else { throw NodeError.invalidResponse }
        let signedAt = CompanionProtocol.nowMillis()
        let message = CompanionProtocol.approvalMessage(nodeId: nodeId, approvalId: approval.id, decision: decision, action: approval.action, target: approval.target, detailHash: hash, signedAt: signedAt)
        let verb = decision == .approved ? "Approve" : "Deny"
        let signature = try key.sign(message, reason: "\(verb): \(approval.title) for \(approval.clientName)")
        return try decode(Approval.self, try await request("v2/approvals/\(approval.id)", method: "POST", json: ["decision": decision.rawValue, "signed_at": signedAt, "signature": signature]))
    }

    // MARK: devices, push, capture

    /// Enrolls a watch: the phone countersigns the watch's public key.
    public func enrollChild(publicKey: String, name: String, platform: String, hardware: Bool, nodeId: String, parentId: String, key: DeviceKey) async throws -> PairResult {
        let signedAt = CompanionProtocol.nowMillis()
        let message = CompanionProtocol.enrollMessage(nodeId: nodeId, parentId: parentId, childPublicKey: publicKey, signedAt: signedAt)
        let signature = try key.sign(message, reason: "Allow \(name) to approve requests")
        return try decode(PairResult.self, try await request("v2/devices/children", method: "POST", json: [
            "name": name, "platform": platform, "hardware": hardware, "public_key": publicKey, "signed_at": signedAt, "signature": signature,
        ]))
    }

    public func removeDevice(_ id: String) async throws {
        _ = try await request("v2/devices/\(id)", method: "DELETE")
    }

    public func setPushTicket(_ ticket: String?) async throws {
        _ = try await request("v2/push", method: "POST", json: ["ticket": ticket as Any])
    }

    @discardableResult
    public func capture(_ data: Data, filename: String, contentType: String, note: String) async throws -> String {
        let out = try await request("capture", method: "POST", body: data, headers: ["Content-Type": contentType, "X-Filename": filename, "X-Note": note])
        return ((try JSONSerialization.jsonObject(with: out)) as? [String: Any])?["path"] as? String ?? ""
    }
}

/// Registers the platform push token with the gateway; returns the opaque ticket for the node.
public enum PushGateway {
    public static var defaultURL = URL(string: "https://push.satchel.dev")!

    public static func register(token: Data, sandbox: Bool, topic: String, gateway: URL = defaultURL) async throws -> String {
        var req = URLRequest(url: gateway.appendingPathComponent("v1/register"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let hex = token.map { String(format: "%02x", $0) }.joined()
        req.httpBody = try JSONSerialization.data(withJSONObject: ["platform": sandbox ? "apns-sandbox" : "apns", "token": hex, "topic": topic])
        let (data, response) = try await URLSession.shared.data(for: req)
        guard (response as? HTTPURLResponse)?.statusCode == 200, let ticket = (try JSONSerialization.jsonObject(with: data) as? [String: Any])?["ticket"] as? String else {
            throw NodeError.invalidResponse
        }
        return ticket
    }
}
