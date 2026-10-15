package dev.satchel.core

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Test

/** Runs against a live node when SATCHEL_TEST_PAIR_LINK is set (CI: scripts/ci-companion-node.ts). */
class IntegrationTest {
    @Test fun pairAndSignAgainstLiveNode() = runBlocking {
        val raw = System.getenv("SATCHEL_TEST_PAIR_LINK").orEmpty()
        assumeTrue("SATCHEL_TEST_PAIR_LINK not set", raw.isNotEmpty())
        val link = PairingLink.parse(raw)!!
        val key = SoftwareKey.generate()
        val client = NodeClient(link.url, null, link.pin)
        val paired = client.pair(link, key, "Kotlin CI", "android")
        assertEquals(link.nodeId, paired.node.id)
        assertEquals(true, client.node().me?.signing)
        val reveal = client.approvals(pendingOnly = true).first { it.action == "reveal_field" }
        assertEquals(true, reveal.requiresSignature)
        val now = System.currentTimeMillis()
        val decided = client.submitDecision(reveal, Decision.APPROVED, now, key.signNow(client.decisionMessage(reveal, Decision.APPROVED, now)))
        assertEquals("approved", decided.status)
        assertEquals("Kotlin CI (signed)", decided.decidedBy)
    }
}
