import { test } from "node:test";
import assert from "node:assert/strict";
import { pairingAddress } from "../src/lan.ts";

const base = { publicHost: null, lanUrl: null, listenHost: "0.0.0.0", port: 7710, requestHost: "localhost:7710" };

test("with a relay the phone gets the public HTTPS address, no warnings", () => {
  const a = pairingAddress({ ...base, publicHost: "alex.satchel.dev" });
  assert.deepEqual(a, { url: "https://alex.satchel.dev", scope: "relay", source: "relay", warnings: [] });
});

test("never hands the phone a loopback address", () => {
  const a = pairingAddress({ ...base, requestHost: "127.0.0.1:7710" });
  assert.equal(a.scope, "lan");
  assert.doesNotMatch(a.url, /localhost|127\.0\.0\.1/, a.url);
});

test("a configured home address wins; the request host is used when it isn't loopback", () => {
  assert.equal(pairingAddress({ ...base, lanUrl: "http://nas.local:7710/" }).url, "http://nas.local:7710");
  const viaLan = pairingAddress({ ...base, requestHost: "192.168.1.20:7710" });
  assert.equal(viaLan.url, "http://192.168.1.20:7710");
  assert.equal(viaLan.source, "request");
});

test("warns when the node only listens on this computer", () => {
  const a = pairingAddress({ ...base, listenHost: "127.0.0.1", lanUrl: "http://nas.local:7710" });
  assert.equal(a.warnings.length, 1);
  assert.match(a.warnings[0], /Reachable on my home network/);
});
