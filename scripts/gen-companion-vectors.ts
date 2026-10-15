// Generates spec/companion/test-vectors.json: canonical messages, a TEST-ONLY P-256 key and node
// signatures that the Swift and Kotlin clients must reproduce and verify. Re-run only when the
// protocol changes. The key is regenerated, so re-run the Swift and Kotlin vector tests with
// SATCHEL_WRITE_CLIENT_SIGNATURES=1 to refresh spec/companion/client-signatures/.
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { writeFileSync } from "node:fs";
import { approvalDetailHash, approvalMessage, b64url, enrollMessage, pairingLink, pairingMessage } from "../packages/core/src/companion.ts";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const spki = publicKey.export({ format: "der", type: "spki" }) as Buffer;
const raw = spki.subarray(spki.length - 65);
const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" }) as Buffer;
const jwk = privateKey.export({ format: "jwk" });
const pub = b64url(spki);
const nodeId = "6f1c2d3e-4b5a-4c6d-8e7f-90a1b2c3d4e5";
const sig = (m: string) => b64url(sign("sha256", Buffer.from(m, "utf8"), { key: privateKey, dsaEncoding: "der" }));

const detail = { path: "home/People/Alex/ID/2019-03 Passport.pdf", key: "passport_number", preview: "567••••••", nested: { b: 2, a: [1, "x"] } };
const detailHash = approvalDetailHash(detail);
const pair = { nodeId, code: "7F3A9C21B0", publicKey: pub };
const enroll = { nodeId, parentId: "0b6f8f9e-1111-4222-8333-944455556666", childPublicKey: pub, signedAt: 1765000000000 };
const approval = {
  nodeId,
  approvalId: "3d2c1b0a-9f8e-4d7c-8b6a-594837261504",
  decision: "approved" as const,
  action: "reveal_field",
  target: "home/People/Alex/ID/2019-03 Passport.pdf#passport_number",
  detailHash,
  signedAt: 1765000123456,
};

const vectors = {
  description: "Satchel companion protocol v2 test vectors. The key below is TEST-ONLY and must never be used for anything else.",
  key: {
    spki_der_b64url: pub,
    raw_x963_b64url: b64url(raw),
    pkcs8_der_b64url: b64url(pkcs8),
    jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d },
    pin_sha256_b64: createHash("sha256").update(spki).digest("base64"),
  },
  pairing: { input: pair, message: pairingMessage(pair), node_signature: sig(pairingMessage(pair)) },
  enroll: { input: enroll, message: enrollMessage(enroll), node_signature: sig(enrollMessage(enroll)) },
  approval: { detail, detail_hash: detailHash, input: approval, message: approvalMessage(approval), node_signature: sig(approvalMessage(approval)) },
  pairing_link: {
    input: { url: "https://alex.satchel.dev", code: "7F3A9C21B0", nodeId, nodeName: "Alex's NAS", pin: "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=" },
    link: pairingLink({
      url: "https://alex.satchel.dev",
      code: "7F3A9C21B0",
      nodeId,
      nodeName: "Alex's NAS",
      pin: "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
    }),
  },
};
writeFileSync("spec/companion/test-vectors.json", `${JSON.stringify(vectors, null, 2)}\n`);
console.log("wrote spec/companion/test-vectors.json");
