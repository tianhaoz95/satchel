import Foundation
@testable import SatchelKit
import XCTest

/// Runs against a live node when SATCHEL_TEST_PAIR_LINK is set (CI: scripts/ci-companion-node.ts):
/// pairs with a software key, then signs a pending high-risk approval.
final class IntegrationTests: XCTestCase {
    func testPairAndSignAgainstLiveNode() async throws {
        guard let raw = ProcessInfo.processInfo.environment["SATCHEL_TEST_PAIR_LINK"], let link = PairingLink(raw) else {
            throw XCTSkip("SATCHEL_TEST_PAIR_LINK not set")
        }
        let key = try DeviceKey.software(raw: Data((0 ..< 32).map { _ in UInt8.random(in: 1 ... 200) }))
        let client = NodeClient(baseURL: link.url, token: nil, pin: link.pin)
        let paired = try await client.pair(link: link, key: key, name: "Swift CI", platform: "ios")
        XCTAssertEqual(paired.node.id, link.nodeId)
        let node = try await client.node()
        XCTAssertEqual(node.me?.signing, true)
        let pending = try await client.approvals(pendingOnly: true)
        let reveal = try XCTUnwrap(pending.first { $0.action == "reveal_field" })
        XCTAssertEqual(reveal.requiresSignature, true)
        let decided = try await client.decide(reveal, .approved, key: key)
        XCTAssertEqual(decided.status, "approved")
        XCTAssertEqual(decided.decidedBy, "Swift CI (signed)")
    }
}
