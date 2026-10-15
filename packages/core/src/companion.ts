import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";

/**
 * Companion protocol v2: native apps hold a hardware-bound P-256 key (Secure Enclave / Android
 * Keystore) that only signs after biometric verification. The node stores the public key and
 * accepts high-risk decisions only with a valid signature. The byte strings built here are the
 * contract shared with the Swift and Kotlin clients; see spec/companion/protocol.md and the
 * test vectors in spec/companion/test-vectors.json.
 */
export const COMPANION_VERSION = 2;

export type DevicePlatform = "ios" | "android" | "watchos" | "wearos";
export type DeviceKind = "phone" | "watch";

/** SPKI DER prefix for an uncompressed P-256 public key (id-ecPublicKey, prime256v1). */
const P256_SPKI_PREFIX = Buffer.from("3059301306072a8648ce3d020106082a8648ce3d030107034200", "hex");

export const b64url = (b: Buffer | Uint8Array) => Buffer.from(b).toString("base64url");
export const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
export const sha256b64url = (data: string | Buffer) => b64url(createHash("sha256").update(data).digest());

/**
 * Accepts a P-256 public key as SPKI DER (Android `PublicKey.encoded`, CryptoKit
 * `derRepresentation`) or raw X9.63 uncompressed point (65 bytes, `SecKeyCopyExternalRepresentation`),
 * base64/base64url encoded. Returns the canonical SPKI DER as base64url.
 */
export function normalizePublicKey(encoded: string): string {
  const raw = fromB64url(encoded);
  const der = raw.length === 65 && raw[0] === 4 ? Buffer.concat([P256_SPKI_PREFIX, raw]) : raw;
  const key = createPublicKey({ key: der, format: "der", type: "spki" });
  const details = key.asymmetricKeyDetails;
  if (key.asymmetricKeyType !== "ec" || details?.namedCurve !== "prime256v1") throw new Error("Device keys must be P-256");
  return b64url(key.export({ format: "der", type: "spki" }));
}

function keyObject(spkiB64url: string): KeyObject {
  return createPublicKey({ key: fromB64url(spkiB64url), format: "der", type: "spki" });
}

/** Verifies an ECDSA P-256 SHA-256 signature (DER, base64url) over `message`. */
export function verifySignature(spkiB64url: string, message: string, signatureB64url: string): boolean {
  try {
    return verify("sha256", Buffer.from(message, "utf8"), { key: keyObject(spkiB64url), dsaEncoding: "der" }, fromB64url(signatureB64url));
  } catch {
    return false;
  }
}

/** Fingerprint shown to the user when comparing keys (first 16 chars of the SHA-256 of the SPKI). */
export const keyFingerprint = (spkiB64url: string) => sha256b64url(fromB64url(spkiB64url)).slice(0, 16);

// ---------------------------------------------------------------- canonical messages

/** Proves possession of the new device key during pairing. */
export function pairingMessage(p: { nodeId: string; code: string; publicKey: string }): string {
  return ["satchel-pair-v1", p.nodeId, p.code.toUpperCase(), p.publicKey].join("\n");
}

/** A phone vouches for its watch: signed by the parent (phone) key. */
export function enrollMessage(p: { nodeId: string; parentId: string; childPublicKey: string; signedAt: number }): string {
  return ["satchel-enroll-v1", p.nodeId, p.parentId, p.childPublicKey, String(p.signedAt)].join("\n");
}

/** Hash of an approval's details as the device saw them, so a decision can't be replayed onto changed details. */
export function approvalDetailHash(detail: Record<string, unknown>): string {
  return sha256b64url(canonicalJson(detail));
}

/** What the device signs when the owner approves or denies. */
export function approvalMessage(p: {
  nodeId: string;
  approvalId: string;
  decision: "approved" | "denied";
  action: string;
  target: string;
  detailHash: string;
  signedAt: number;
}): string {
  return ["satchel-approval-v1", p.nodeId, p.approvalId, p.decision, p.action, p.target, p.detailHash, String(p.signedAt)].join("\n");
}

/** JSON with object keys sorted recursively, no whitespace; identical output in every client. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** Signed timestamps must be within this window of the node's clock. */
export const SIGNATURE_MAX_SKEW_MS = 5 * 60_000;

/** Actions that need a hardware-signed decision once a signing device is paired. */
export const HIGH_RISK_ACTIONS = new Set(["reveal_field", "apply_plan", "update_conventions"]);

/** The pairing deep link encoded in the QR code: satchel://pair?v=2&url=…&code=…&node=…&pin=… */
export function pairingLink(p: { url: string; code: string; nodeId: string; nodeName: string; pin: string | null }): string {
  const q = new URLSearchParams({ v: "2", url: p.url, code: p.code, node: p.nodeId, name: p.nodeName });
  if (p.pin) q.set("pin", p.pin);
  return `satchel://pair?${q.toString()}`;
}
