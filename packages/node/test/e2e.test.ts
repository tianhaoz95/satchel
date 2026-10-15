import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Relay, FileVerifier, hashToken } from "../../relay/src/index.ts";
import { startNode, saveConfig, loadConfig, hashPassword, type RunningNode } from "../src/index.ts";

let tmp: string, vaultDir: string, dataDir: string;
let relay: Relay;
let running: RunningNode;
let pat: string;
let base: string;
const NODE_TOKEN = `satchel_node_${randomBytes(12).toString("hex")}`;

before(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "satchel-e2e-"));
  vaultDir = path.join(tmp, "vault");
  dataDir = path.join(tmp, "data");
  await mkdir(path.join(vaultDir, "Scans"), { recursive: true });
  await writeFile(path.join(vaultDir, "Scans", "scan_0001.txt"), "STATE OF CALIFORNIA DRIVER LICENSE\nDL D1234567\nEXP 12/01/2026\nALEX RIVERA\n");
  await writeFile(path.join(vaultDir, "Scans", "receipt.txt"), "Coffee 4.50");

  const nodesFile = path.join(tmp, "nodes.json");
  await writeFile(nodesFile, JSON.stringify({ nodes: [{ subdomain: "alex", token_sha256: hashToken(NODE_TOKEN) }] }));
  relay = new Relay({
    domain: "satchel.test",
    apiHost: "relay.satchel.test",
    publicPort: 0,
    controlPort: 0,
    host: "127.0.0.1",
    verifier: new FileVerifier(nodesFile),
    log: () => {},
  });
  await relay.start();

  const config = loadConfig(dataDir);
  config.roots = [{ name: "home", path: vaultDir }];
  config.owner = hashPassword("correct horse");
  config.listen = { host: "127.0.0.1", port: 0 };
  config.tlsPort = 0;
  config.relay = { control: `127.0.0.1:${relay.controlPort}`, token: NODE_TOKEN, insecure: true };
  saveConfig(dataDir, config);
  running = await startNode(dataDir, { log: () => {} });
  const addr = running.servers.http.address() as any;
  base = `http://127.0.0.1:${addr.port}`;
  pat = running.node.store.issueToken("pat", "pat", { label: "test agent", roots: ["*"], scopes: ["read", "write", "organize"] }, null);
  for (let i = 0; i < 50 && !running.node.config.publicHost; i++) await new Promise((r) => setTimeout(r, 100));
});

after(async () => {
  await running?.stop();
  await relay?.stop();
});

async function mcp(token: string) {
  const client = new Client({ name: "e2e", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res: any = await client.callTool({ name, arguments: args });
    const text = res.content[0].text as string;
    if (res.isError) throw new Error(text);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };
  return { client, call };
}

test("rejects requests without a token, advertising OAuth metadata", async () => {
  const res = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(res.status, 401);
  assert.match(res.headers.get("www-authenticate") ?? "", /resource_metadata=/);
  const meta = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
  assert.ok(meta.registration_endpoint);
});

test("agent workflow: discover, annotate, query, masking, redaction", async () => {
  const { call, client } = await mcp(pat);
  const tools = await client.listTools();
  assert.ok(tools.tools.length >= 15);
  const status = await call("vault_status");
  assert.equal(status.files, 2);
  assert.match(await call("get_conventions"), /VAULT\.md/);
  const unprocessed = await call("list_unprocessed");
  assert.equal(unprocessed.length, 2);
  const found = await call("search", { query: "driver license" });
  assert.equal(found.results[0].path, "home/Scans/scan_0001.txt");
  await call("set_metadata", {
    path: "home/Scans/scan_0001.txt",
    fields: { doc_type: "drivers_license", subject: "Alex", title: "California Driver License", expires_on: "2026-12-01", license_number: "D1234567" },
  });
  const record = await call("get_record", { path: "home/Scans/scan_0001.txt" });
  assert.equal(record.metadata.expires_on, "2026-12-01");
  assert.notEqual(record.metadata.license_number, "D1234567");
  assert.deepEqual(record.masked_fields, ["license_number"]);
  const text = await call("read_file", { path: "home/Scans/scan_0001.txt" });
  assert.doesNotMatch(text.text, /D1234567/);
  assert.equal(text.redactions, 1);
  const exp = await call("list_expiring", { within_days: 3650 });
  assert.equal(exp.items.length, 1);
  // search must not find documents by their masked values
  const leak = await call("search", { query: "D1234567", has_metadata: true });
  assert.ok(leak.results.every((r: any) => !JSON.stringify(r.metadata).includes("D1234567")));
  // sensitivity markers can only grow
  await call("set_metadata", { path: "home/Scans/scan_0001.txt", fields: { sensitive: ["subject"] } });
  await call("set_metadata", { path: "home/Scans/scan_0001.txt", fields: { sensitive: [] } });
  const again = await call("get_record", { path: "home/Scans/scan_0001.txt" });
  assert.ok(again.masked_fields.includes("subject"));
});

test("reveal needs the owner's approval and can be picked up once", async () => {
  const { call } = await mcp(pat);
  const pending = await call("reveal_field", { path: "home/Scans/scan_0001.txt", key: "license_number", reason: "Filling the DMV renewal form" });
  assert.equal(pending.status, "pending_approval");
  assert.equal((await call("check_approval", { request_id: pending.request_id })).status, "pending");
  await running.node.decide(pending.request_id, "approved", "test");
  const got = await call("check_approval", { request_id: pending.request_id });
  assert.equal(got.value, "D1234567");
  assert.equal((await call("check_approval", { request_id: pending.request_id })).status, "used");
  const audit = running.node.store.listAudit(50);
  assert.ok(audit.some((a) => a.revealed.includes("home/Scans/scan_0001.txt#license_number")));
});

test("deliver_to_user sends the value to the owner, not the agent", async () => {
  const { call } = await mcp(pat);
  const res = await call("deliver_to_user", { path: "home/Scans/scan_0001.txt", key: "license_number" });
  assert.equal(JSON.stringify(res).includes("D1234567"), false);
  assert.equal(running.node.store.listDeliveries()[0].value, "D1234567");
});

test("reorganization: plan, approve, journal, undo", async () => {
  const { call } = await mcp(pat);
  const to = "home/People/Alex/ID/2024-05 Driver License (exp 2026-12).txt";
  const plan = await call("propose_reorganization", { moves: [{ from: "home/Scans/scan_0001.txt", to }], reason: "Follow VAULT.md layout" });
  assert.equal(plan.status, "pending_approval");
  await running.node.decide(plan.request_id, "approved", "test");
  const abs = path.join(vaultDir, "People/Alex/ID/2024-05 Driver License (exp 2026-12).txt");
  assert.ok(existsSync(abs));
  assert.ok(existsSync(path.join(path.dirname(abs), ".2024-05 Driver License (exp 2026-12).txt.satchel.yaml")), "sidecar moved too");
  assert.equal((await call("get_record", { path: to })).metadata.doc_type, "drivers_license");
  const journal = await call("list_journal");
  const move = journal.find((e: any) => e.kind === "move");
  await call("undo", { entry_id: move.id });
  assert.ok(existsSync(path.join(vaultDir, "Scans/scan_0001.txt")));
  const lines = (await readFile(path.join(vaultDir, ".satchel/journal.jsonl"), "utf8")).trim().split("\n");
  assert.ok(lines.length >= 4);
});

test("scopes are enforced per connection", async () => {
  const readOnly = running.node.store.issueToken("pat", "pat", { label: "ro", roots: ["*"], scopes: ["read"] }, null);
  const { call } = await mcp(readOnly);
  await assert.rejects(call("set_metadata", { path: "home/Scans/receipt.txt", fields: { doc_type: "receipt" } }), /"write" permission/);
  const noRoots = running.node.store.issueToken("pat", "pat", { label: "none", roots: ["other"], scopes: ["read"] }, null);
  const c2 = await mcp(noRoots);
  assert.equal((await c2.call("search", { query: "" })).count, 0);
  await assert.rejects(c2.call("get_record", { path: "home/Scans/receipt.txt" }), /Not found/);
});

test("OAuth 2.1: dynamic registration, consent with password, PKCE token exchange", async () => {
  const reg = await (
    await fetch(`${base}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Test Agent", redirect_uris: ["http://127.0.0.1:9/cb"], token_endpoint_auth_method: "none" }),
    })
  ).json();
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authUrl = `${base}/authorize?response_type=code&client_id=${reg.client_id}&redirect_uri=${encodeURIComponent("http://127.0.0.1:9/cb")}&code_challenge=${challenge}&code_challenge_method=S256&state=xyz&scope=read%20write`;
  const consent = await (await fetch(authUrl)).text();
  assert.match(consent, /Test Agent/);
  const form = new URLSearchParams({
    client_id: reg.client_id,
    redirect_uri: "http://127.0.0.1:9/cb",
    state: "xyz",
    code_challenge: challenge,
    password: "correct horse",
    action: "allow",
  });
  form.append("roots", "home");
  form.append("scopes", "write");
  const wrong = await fetch(`${base}/oauth/consent`, {
    method: "POST",
    body: new URLSearchParams({ ...Object.fromEntries(form), password: "nope" }),
    redirect: "manual",
  });
  assert.equal(wrong.status, 401);
  const res = await fetch(`${base}/oauth/consent`, { method: "POST", body: form, redirect: "manual" });
  assert.equal(res.status, 302);
  const loc = new URL(res.headers.get("location")!);
  assert.equal(loc.searchParams.get("state"), "xyz");
  const tok = await (
    await fetch(`${base}/token`, {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: loc.searchParams.get("code")!,
        code_verifier: verifier,
        client_id: reg.client_id,
        redirect_uri: "http://127.0.0.1:9/cb",
      }),
    })
  ).json();
  assert.ok(tok.access_token, JSON.stringify(tok));
  const { call } = await mcp(tok.access_token);
  assert.deepEqual((await call("vault_status")).your_permissions, ["read", "write"]);
});

test("relay: TLS passthrough by SNI to the node, relay never holds the key", async () => {
  assert.equal(running.node.config.publicHost, "alex.satchel.test");
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "vault_status", arguments: {} } });
  const result: any = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: "127.0.0.1",
        port: relay.publicPort,
        servername: "alex.satchel.test",
        path: "/mcp",
        method: "POST",
        rejectUnauthorized: false,
        headers: {
          host: "alex.satchel.test",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${pat}`,
        },
      },
      (res) => {
        const cert = (res.socket as any).getPeerCertificate();
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, data, cert }));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
  assert.equal(result.status, 200, result.data);
  assert.match(result.data, /your_permissions/);
  // The certificate presented through the relay is the node's own
  assert.equal(result.cert.subject.CN, "alex.satchel.test");
  // Unknown subdomains are dropped
  await assert.rejects(
    new Promise((resolve, reject) => {
      const req = https.request(
        { host: "127.0.0.1", port: relay.publicPort, servername: "nobody.satchel.test", rejectUnauthorized: false, path: "/" },
        resolve,
      );
      req.on("error", reject);
      req.end();
    }),
  );
});
