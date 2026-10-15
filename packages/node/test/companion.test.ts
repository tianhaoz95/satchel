// Companion protocol v2 end to end: native-app pairing with key proof, signed decisions, the
// device-signature policy, watch enrollment, and push tickets.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { approvalMessage, b64url, enrollMessage, pairingMessage } from "@satchel/core";
import { buildMcpServer } from "../src/mcp.ts";
import { hashPassword, loadConfig, saveConfig, startNode, type RunningNode } from "../src/index.ts";

let running: RunningNode;
let base: string;
let admin: string;

type Key = { privateKey: KeyObject; pub: string };
const newKey = (): Key => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return { privateKey, pub: b64url(publicKey.export({ format: "der", type: "spki" }) as Buffer) };
};
const signWith = (k: Key, m: string) => b64url(sign("sha256", Buffer.from(m, "utf8"), { key: k.privateKey, dsaEncoding: "der" }));

async function api(pathname: string, opts: { method?: string; token?: string; cookie?: string; body?: unknown } = {}) {
  const res = await fetch(`${base}${pathname}`, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers: {
      ...(opts.body ? { "content-type": "application/json" } : {}),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

async function revealRequest(): Promise<string> {
  const server: any = buildMcpServer(running.node, { clientId: "c1", clientName: "Test agent", grant: { label: "t", roots: ["*"], scopes: ["read"] } });
  const res = await server._registeredTools.reveal_field.handler({ path: "home/ID/passport.txt", key: "passport_number", reason: "Fill the form" }, {});
  return JSON.parse(res.content[0].text).request_id;
}

before(async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "satchel-v2-"));
  await mkdir(path.join(dir, "vault", "ID"), { recursive: true });
  await writeFile(path.join(dir, "vault", "ID", "passport.txt"), "Passport 567123498");
  const config = loadConfig(path.join(dir, "data"));
  config.roots = [{ name: "home", path: path.join(dir, "vault") }];
  config.owner = hashPassword("pw");
  config.listen = { host: "127.0.0.1", port: 0 };
  config.push = { gateway: null };
  saveConfig(path.join(dir, "data"), config);
  running = await startNode(path.join(dir, "data"), { log: () => {} });
  base = `http://127.0.0.1:${(running.servers.http.address() as any).port}`;
  await running.node.vault.setMetadata("home/ID/passport.txt", { doc_type: "passport", passport_number: "567123498" }, { actor: "test" });
  const login = await fetch(`${base}/admin/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "pw" }),
  });
  admin = (login.headers.get("set-cookie") ?? "").split(";")[0];
});

after(async () => {
  await running?.stop();
});

let phone: { id: string; token: string; key: Key };

test("before any phone is paired, the admin UI can still approve high-risk requests", async () => {
  const id = await revealRequest();
  const r = await api(`/admin/api/approvals/${id}`, { cookie: admin, body: { decision: "approved" } });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "approved");
});

test("pairing requires proof of the private key and a valid code", async () => {
  const pair = await api("/admin/api/pair", { cookie: admin, body: {} });
  assert.match(pair.body.link, /^satchel:\/\/pair\?v=2&/);
  // Local-only node: home-network scope, never a loopback URL, and a warning that it only listens locally.
  assert.equal(pair.body.address.scope, "lan");
  assert.doesNotMatch(decodeURIComponent(pair.body.link), /url=http:\/\/(127\.0\.0\.1|localhost)/);
  assert.match(pair.body.address.warnings.join(" "), /only accepts connections from this computer/);
  const key = newKey();
  const nodeId = running.node.config.nodeId;
  const wrong = newKey();
  const bad = await api("/app/api/v2/pair", {
    body: {
      code: pair.body.code,
      name: "iPhone",
      platform: "ios",
      public_key: key.pub,
      signature: signWith(wrong, pairingMessage({ nodeId, code: pair.body.code, publicKey: key.pub })),
    },
  });
  assert.equal(bad.status, 403);
  const ok = await api("/app/api/v2/pair", {
    body: {
      code: pair.body.code,
      name: "iPhone",
      platform: "ios",
      hardware: true,
      public_key: key.pub,
      signature: signWith(key, pairingMessage({ nodeId, code: pair.body.code, publicKey: key.pub })),
    },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.node.id, nodeId);
  phone = { id: ok.body.id, token: ok.body.token, key };
  const again = await api("/app/api/v2/pair", {
    body: {
      code: pair.body.code,
      platform: "ios",
      public_key: key.pub,
      signature: signWith(key, pairingMessage({ nodeId, code: pair.body.code, publicKey: key.pub })),
    },
  });
  assert.equal(again.status, 400, "codes are single-use");
  const me = await api("/app/api/v2/node", { token: phone.token });
  assert.equal(me.body.me.signing, true);
  assert.equal(me.body.me.hardware, true);
});

test("once a phone is paired, the admin UI and the PWA can't approve high-risk requests (deny still works)", async () => {
  const id = await revealRequest();
  const viaAdmin = await api(`/admin/api/approvals/${id}`, { cookie: admin, body: { decision: "approved" } });
  assert.equal(viaAdmin.status, 403);
  assert.equal(viaAdmin.body.code, "needs_signature");
  const list = await api("/admin/api/approvals?status=pending", { cookie: admin });
  assert.equal(list.body.find((a: any) => a.id === id).requires_signature, true);
  const pwa = await api("/app/api/pair", { body: { code: (await api("/admin/api/pair", { cookie: admin, body: {} })).body.code, name: "Browser" } });
  const viaPwa = await api(`/app/api/approvals/${id}`, { token: pwa.body.token, body: { decision: "approved" } });
  assert.equal(viaPwa.status, 403);
  const deny = await api(`/admin/api/approvals/${id}`, { cookie: admin, body: { decision: "denied" } });
  assert.equal(deny.body.status, "denied");
});

test("a signed decision from the phone approves; tampered, stale or replayed signatures don't", async () => {
  const id = await revealRequest();
  const list = await api("/app/api/v2/approvals?status=pending", { token: phone.token });
  const a = list.body.find((x: any) => x.id === id);
  assert.equal(a.requires_signature, true);
  const fields = { nodeId: a.node_id, approvalId: a.id, action: a.action, target: a.target, detailHash: a.detail_hash };
  const now = Date.now();
  const deniedSig = signWith(phone.key, approvalMessage({ ...fields, decision: "denied", signedAt: now }));
  const tampered = await api(`/app/api/v2/approvals/${id}`, { token: phone.token, body: { decision: "approved", signed_at: now, signature: deniedSig } });
  assert.equal(tampered.status, 403);
  assert.equal(tampered.body.code, "bad_signature");
  const old = now - 10 * 60_000;
  const stale = await api(`/app/api/v2/approvals/${id}`, {
    token: phone.token,
    body: { decision: "approved", signed_at: old, signature: signWith(phone.key, approvalMessage({ ...fields, decision: "approved", signedAt: old })) },
  });
  assert.equal(stale.body.code, "stale_signature");
  const sig = signWith(phone.key, approvalMessage({ ...fields, decision: "approved", signedAt: now }));
  const ok = await api(`/app/api/v2/approvals/${id}`, { token: phone.token, body: { decision: "approved", signed_at: now, signature: sig } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.status, "approved");
  assert.equal(ok.body.decision_device, phone.id);
  assert.equal(ok.body.decision_signature, sig);
  const replay = await api(`/app/api/v2/approvals/${id}`, { token: phone.token, body: { decision: "approved", signed_at: now, signature: sig } });
  assert.equal(replay.status, 409);
});

test("a phone enrolls its watch with a countersignature; the watch signs its own decisions", async () => {
  const watchKey = newKey();
  const signedAt = Date.now();
  const nodeId = running.node.config.nodeId;
  const forged = await api("/app/api/v2/devices/children", {
    token: phone.token,
    body: {
      name: "Watch",
      platform: "watchos",
      public_key: watchKey.pub,
      signed_at: signedAt,
      signature: signWith(watchKey, enrollMessage({ nodeId, parentId: phone.id, childPublicKey: watchKey.pub, signedAt })),
    },
  });
  assert.equal(forged.status, 403);
  const enrolled = await api("/app/api/v2/devices/children", {
    token: phone.token,
    body: {
      name: "Alex's Watch",
      platform: "watchos",
      hardware: true,
      public_key: watchKey.pub,
      signed_at: signedAt,
      signature: signWith(phone.key, enrollMessage({ nodeId, parentId: phone.id, childPublicKey: watchKey.pub, signedAt })),
    },
  });
  assert.equal(enrolled.status, 200, JSON.stringify(enrolled.body));
  const watch = { token: enrolled.body.token, id: enrolled.body.id };
  const nested = await api("/app/api/v2/devices/children", { token: watch.token, body: { public_key: newKey().pub, signed_at: Date.now(), signature: "x" } });
  assert.equal(nested.status, 403, "watches can't enroll devices");
  const id = await revealRequest();
  const a = (await api("/app/api/v2/approvals?status=pending", { token: watch.token })).body.find((x: any) => x.id === id);
  const now = Date.now();
  const sig = signWith(
    watchKey,
    approvalMessage({
      nodeId: a.node_id,
      approvalId: a.id,
      decision: "approved",
      action: a.action,
      target: a.target,
      detailHash: a.detail_hash,
      signedAt: now,
    }),
  );
  const ok = await api(`/app/api/v2/approvals/${id}`, { token: watch.token, body: { decision: "approved", signed_at: now, signature: sig } });
  assert.equal(ok.body.decision_device, watch.id);
  const devices = await api("/app/api/v2/devices", { token: phone.token });
  assert.deepEqual(devices.body.map((d: any) => d.kind).sort(), ["phone", "watch"]);
  assert.ok(devices.body.every((d: any) => !("public_key" in d) && !("push_ticket" in d)));
  await api(`/app/api/v2/devices/${phone.id}`, { method: "DELETE", token: phone.token });
  const gone = await api("/app/api/v2/node", { token: watch.token });
  assert.equal(gone.status, 401, "removing the phone removes its watch");
});

test("push tickets are stored per device and policy 'never' re-enables the admin UI", async () => {
  const key = newKey();
  const code = (await api("/admin/api/pair", { cookie: admin, body: {} })).body.code;
  const nodeId = running.node.config.nodeId;
  const p = await api("/app/api/v2/pair", {
    body: { code, name: "Pixel", platform: "android", public_key: key.pub, signature: signWith(key, pairingMessage({ nodeId, code, publicKey: key.pub })) },
  });
  await api("/app/api/v2/push", { token: p.body.token, body: { ticket: "v1.opaque-ticket" } });
  assert.deepEqual(
    running.node.store.listPushTickets().map((t) => t.ticket),
    ["v1.opaque-ticket"],
  );
  const policy = (await api("/admin/api/policy", { cookie: admin })).body.policy;
  await api("/admin/api/policy", {
    method: "PUT",
    cookie: admin,
    body: { policy: { ...policy, approvals: { ...policy.approvals, deviceSignature: "never" } } },
  });
  const id = await revealRequest();
  const r = await api(`/admin/api/approvals/${id}`, { cookie: admin, body: { decision: "approved" } });
  assert.equal(r.body.status, "approved");
});
