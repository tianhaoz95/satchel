# Satchel companion protocol v2

The contract between a Satchel node and the native companion apps (iOS, watchOS, Android, Wear OS).
Reference implementation: `packages/core/src/companion.ts`, `packages/node/src/companion.ts`.
Conformance: `spec/companion/test-vectors.json`, checked by the TypeScript, Swift and Kotlin test suites.

## Goals

- **Possession plus biometrics for high-risk decisions.** Each device holds a P-256 private key in
  hardware (Secure Enclave, StrongBox or TEE) that only signs after Face ID, Touch ID or a fingerprint.
  The node accepts high-risk decisions only with a valid signature.
- **No trust in the relay or push services.** Apps pin the node's TLS public key. Push notifications
  carry no content.

## Encodings

| Thing | Encoding |
|---|---|
| Public key | P-256, **SPKI DER, base64url** (no padding). The node also accepts raw X9.63 (65 bytes, `04‖X‖Y`) and normalizes it to SPKI |
| Signature | ECDSA P-256 with SHA-256, **DER**, base64url |
| Messages | UTF-8 text, fields joined by `\n`, no trailing newline |
| Timestamps | Milliseconds since the Unix epoch, decimal string in messages, number in JSON |
| TLS pin | **Standard base64** (with padding) SHA-256 of the node TLS key's SPKI DER, the same value as OkHttp's `sha256/…` |

## Pairing link (QR code)

```
satchel://pair?v=2&url=<node base URL>&code=<pairing code>&node=<node id>&name=<node name>&pin=<TLS pin>
```

The query is `application/x-www-form-urlencoded`: `+` means space, which Swift's `URLComponents`
doesn't decode, so clients must. `pin` is omitted for local-only nodes reached over plain HTTP on
the LAN. Clients must then warn that the connection isn't pinned. Codes are single-use and expire
after 10 minutes.

## Canonical messages

```
satchel-pair-v1      \n node_id \n CODE (upper-case) \n public_key
satchel-enroll-v1    \n node_id \n parent_device_id \n child_public_key \n signed_at
satchel-approval-v1  \n node_id \n approval_id \n decision \n action \n target \n detail_hash \n signed_at
```

- `decision` is `approved` or `denied`.
- `detail_hash` is computed by the node: base64url SHA-256 of the approval detail as canonical JSON
  (keys sorted recursively, no whitespace). Clients sign the value the node returns; they don't
  recompute it. Pinning guarantees they received it from the node.
- `signed_at` must be within **±5 minutes** of the node's clock.

## Endpoints

All paths are under `/app/api`. After pairing, send `Authorization: Bearer <device token>`.

| Method & path | Body → response | Notes |
|---|---|---|
| `POST /v2/pair` | `{code, name, platform, kind?, hardware, public_key, signature}` → `{id, token, node:{id,name,pin}}` | `signature` over the pairing message proves key possession. `platform`: `ios`, `android`, `watchos` or `wearos` |
| `GET /v2/node` | → `{id, name, pin, policy:{device_signature}, me, protocol: 2}` | `me` describes the calling device |
| `GET /v2/approvals?status=pending` | → `[approval + {node_id, detail_hash, requires_signature}]` | |
| `POST /v2/approvals/:id` | `{decision, signed_at, signature}` → approval | 403 `bad_signature` or `stale_signature`, 409 `already_decided`, 404 `not_found` |
| `GET /v2/devices` | → this device and its watches | Never returns keys or push tickets |
| `POST /v2/devices/children` | `{name, platform, hardware, public_key, signed_at, signature}` → `{id, token, node}` | Phone only. `signature` is the **phone's** signature over the enroll message |
| `DELETE /v2/devices/:id` | → `{ok}` | Self or own watch. Removing a phone removes its watches |
| `POST /v2/push` | `{ticket \| null}` → `{ok}` | Opaque push-gateway ticket |
| `GET /deliveries`, `POST /deliveries/:id/seen`, `GET /upcoming`, `POST /capture` | as in v1 | Capture: raw body, `x-filename`, `x-note` headers |

## Policy

`policy.approvals.deviceSignature` decides who may **approve** the high-risk actions
`reveal_field`, `apply_plan` and `update_conventions`:

- `when_paired` (default): once any signing device is paired, only signed decisions can approve them.
- `always`: only signed decisions, even before a device is paired.
- `never`: the admin UI and the PWA may approve as well.

**Denying never needs a signature**, because it can only reduce what an agent gets.

## Key requirements for clients

- **iOS / watchOS:** `SecureEnclave.P256.Signing.PrivateKey` with
  `SecAccessControl(.privateKeyUsage, .biometryCurrentSet)`. Store its `dataRepresentation` in the
  Keychain (`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`). Simulators fall back to a software key
  and report `hardware: false`.
- **Android / Wear OS:** Keystore EC key (`secp256r1`, `SHA256withECDSA`) with
  `setUserAuthenticationRequired(true)` and `setUserAuthenticationParameters(0, BIOMETRIC_STRONG)`,
  StrongBox when available. Sign through `BiometricPrompt` with a `CryptoObject`. Report `hardware`
  from `KeyInfo.securityLevel`.
- A watch never shows delivered secret values. It may approve and deny.

## Push gateway

Native apps register with the gateway (`apps/push-gateway`, a Cloudflare Worker), never with the node:

| Method & path | Body → response |
|---|---|
| `POST /v1/register` | `{platform: "apns" \| "apns-sandbox" \| "fcm", token, topic?}` → `{ticket}` |
| `POST /v1/wake` | `{ticket, kind: "approval" \| "delivery"}` → `{ok}`, or 410 if the device token is gone |

The ticket is the device token encrypted with the gateway's AES-GCM key, so the node stores it
without learning the APNs/FCM token. The notification text is generic ("Satchel needs your
attention") and carries only `kind`. The app fetches details from the node.
