import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  approvalDetailHash,
  approvalMessage,
  enrollMessage,
  fromB64url,
  normalizePublicKey,
  pairingLink,
  pairingMessage,
  verifySignature,
} from "../src/index.ts";

const vectors = JSON.parse(readFileSync(path.join(import.meta.dirname, "..", "..", "..", "spec", "companion", "test-vectors.json"), "utf8"));
const pub = vectors.key.spki_der_b64url;

test("canonical messages match the shared vectors", () => {
  assert.equal(pairingMessage(vectors.pairing.input), vectors.pairing.message);
  assert.equal(enrollMessage(vectors.enroll.input), vectors.enroll.message);
  assert.equal(approvalDetailHash(vectors.approval.detail), vectors.approval.detail_hash);
  assert.equal(approvalMessage(vectors.approval.input), vectors.approval.message);
  assert.equal(pairingLink(vectors.pairing_link.input), vectors.pairing_link.link);
});

test("raw X9.63 and SPKI encodings normalize to the same key", () => {
  assert.equal(normalizePublicKey(vectors.key.raw_x963_b64url), pub);
  assert.equal(normalizePublicKey(pub), pub);
  assert.throws(() => normalizePublicKey("AAAA"));
});

test("the TLS pin is base64 SHA-256 of the SPKI", () => {
  assert.equal(createHash("sha256").update(fromB64url(pub)).digest("base64"), vectors.key.pin_sha256_b64);
});

test("node signatures verify; tampered messages don't", () => {
  for (const k of ["pairing", "enroll", "approval"]) assert.ok(verifySignature(pub, vectors[k].message, vectors[k].node_signature), k);
  assert.equal(verifySignature(pub, vectors.approval.message.replace("approved", "denied"), vectors.approval.node_signature), false);
});

test("signatures produced by the Swift and Kotlin clients verify on the node", () => {
  const clients = Object.entries(vectors.client_signatures as Record<string, Record<string, string>>);
  for (const [client, sigs] of clients) {
    for (const k of ["pairing", "enroll", "approval"]) assert.ok(verifySignature(pub, vectors[k].message, sigs[k]), `${client} ${k}`);
  }
});
