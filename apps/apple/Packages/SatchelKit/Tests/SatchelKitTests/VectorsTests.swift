import CryptoKit
import Foundation
@testable import SatchelKit
import XCTest

/// Conformance with spec/companion/test-vectors.json (shared with the node and the Kotlin client).
final class VectorsTests: XCTestCase {
    /// Tests/SatchelKitTests/ → SatchelKit → Packages → apple → apps → repo root.
    static let vectorsURL = (0 ..< 7).reduce(URL(fileURLWithPath: #filePath)) { url, _ in url.deletingLastPathComponent() }
        .appendingPathComponent("spec/companion/test-vectors.json")

    var v: [String: Any] = [:]

    override func setUpWithError() throws {
        v = try JSONSerialization.jsonObject(with: Data(contentsOf: Self.vectorsURL)) as! [String: Any]
    }

    private func obj(_ path: String...) -> [String: Any] {
        path.reduce(v) { $0[$1] as! [String: Any] }
    }

    private var publicKey: String { obj("key")["spki_der_b64url"] as! String }

    private func verify(_ message: String, _ signature: String) throws -> Bool {
        let key = try P256.Signing.PublicKey(derRepresentation: Base64URL.decode(publicKey)!)
        return key.isValidSignature(try P256.Signing.ECDSASignature(derRepresentation: Base64URL.decode(signature)!), for: Data(message.utf8))
    }

    func testCanonicalMessages() {
        let p = obj("pairing", "input")
        XCTAssertEqual(CompanionProtocol.pairingMessage(nodeId: p["nodeId"] as! String, code: p["code"] as! String, publicKey: p["publicKey"] as! String), obj("pairing")["message"] as! String)
        let e = obj("enroll", "input")
        XCTAssertEqual(
            CompanionProtocol.enrollMessage(nodeId: e["nodeId"] as! String, parentId: e["parentId"] as! String, childPublicKey: e["childPublicKey"] as! String, signedAt: (e["signedAt"] as! NSNumber).int64Value),
            obj("enroll")["message"] as! String
        )
        let a = obj("approval", "input")
        XCTAssertEqual(
            CompanionProtocol.approvalMessage(
                nodeId: a["nodeId"] as! String, approvalId: a["approvalId"] as! String, decision: Decision(rawValue: a["decision"] as! String)!,
                action: a["action"] as! String, target: a["target"] as! String, detailHash: a["detailHash"] as! String, signedAt: (a["signedAt"] as! NSNumber).int64Value
            ),
            obj("approval")["message"] as! String
        )
    }

    func testPairingLinkParsing() {
        let input = obj("pairing_link", "input")
        let link = PairingLink(obj("pairing_link")["link"] as! String)
        XCTAssertEqual(link, PairingLink(url: URL(string: input["url"] as! String)!, code: input["code"] as! String, nodeId: input["nodeId"] as! String, nodeName: input["nodeName"] as! String, pin: input["pin"] as? String))
        XCTAssertEqual(link?.isPinned, true)
        XCTAssertNil(PairingLink("https://example.com/app/#pair=ABC"))
    }

    func testKeyEncodingsAndPin() {
        let raw = Base64URL.decode(obj("key")["raw_x963_b64url"] as! String)!
        XCTAssertEqual(Base64URL.encode(SPKIHeader.p256 + raw), publicKey)
        XCTAssertEqual(Pin.sha256(spki: Base64URL.decode(publicKey)!), obj("key")["pin_sha256_b64"] as! String)
        let secKey = SecKeyCreateWithData(raw as CFData, [kSecAttrKeyType: kSecAttrKeyTypeECSECPrimeRandom, kSecAttrKeyClass: kSecAttrKeyClassPublic] as CFDictionary, nil)!
        XCTAssertEqual(Pin.of(secKey), obj("key")["pin_sha256_b64"] as! String)
    }

    func testNodeSignaturesVerify() throws {
        for k in ["pairing", "enroll", "approval"] {
            XCTAssertTrue(try verify(obj(k)["message"] as! String, obj(k)["node_signature"] as! String), k)
        }
        XCTAssertFalse(try verify((obj("approval")["message"] as! String).replacingOccurrences(of: "approved", with: "denied"), obj("approval")["node_signature"] as! String))
    }

    /// Signs the vectors with the test key. With SATCHEL_WRITE_CLIENT_SIGNATURES=1 the signatures are
    /// written to spec/companion/client-signatures/swift.json, which the node's tests verify.
    func testClientSignatures() throws {
        let d = Base64URL.decode((obj("key")["jwk"] as! [String: Any])["d"] as! String)!
        let key = try DeviceKey.software(raw: d)
        XCTAssertEqual(key.publicKey, publicKey)
        var sigs: [String: String] = [:]
        for k in ["pairing", "enroll", "approval"] {
            let message = obj(k)["message"] as! String
            let sig = try key.sign(message, reason: "test")
            XCTAssertTrue(try verify(message, sig))
            sigs[k] = sig
        }
        if ProcessInfo.processInfo.environment["SATCHEL_WRITE_CLIENT_SIGNATURES"] == "1" {
            let out = Self.vectorsURL.deletingLastPathComponent().appendingPathComponent("client-signatures/swift.json")
            let data = try JSONSerialization.data(withJSONObject: sigs, options: [.sortedKeys])
            try (data + Data("\n".utf8)).write(to: out)
        }
    }
}
