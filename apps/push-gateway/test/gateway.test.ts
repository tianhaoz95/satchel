import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { handle, type Env } from "../src/index.ts";
import { resetApnsCache } from "../src/apns.ts";
import { resetFcmCache } from "../src/fcm.ts";
import { openTicket } from "../src/ticket.ts";

const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const env: Env = {
  TICKET_KEY: Buffer.alloc(32, 7).toString("base64"),
  APNS_KEY_ID: "ABC123DEFG",
  APNS_TEAM_ID: "TEAM123456",
  APNS_PRIVATE_KEY: ec.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  APNS_TOPIC: "dev.satchel.ios",
  FCM_SERVICE_ACCOUNT: JSON.stringify({
    project_id: "satchel-test",
    client_email: "push@satchel-test.iam.gserviceaccount.com",
    private_key: rsa.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  }),
};
const post = (path: string, body: unknown) =>
  new Request(`https://push.satchel.dev${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const APNS_TOKEN = "a".repeat(64);

beforeEach(() => {
  resetApnsCache();
  resetFcmCache();
});

async function register(platform: string, token: string) {
  const res = await handle(post("/v1/register", { platform, token }), env);
  assert.equal(res.status, 200);
  return ((await res.json()) as { ticket: string }).ticket;
}

test("tickets hide the device token and can't be forged", async () => {
  const ticket = await register("apns", APNS_TOKEN);
  assert.ok(!ticket.includes(APNS_TOKEN));
  assert.deepEqual(await openTicket(ticket, env.TICKET_KEY), { p: "apns", t: APNS_TOKEN, topic: "dev.satchel.ios" });
  const tampered = `${ticket.slice(0, -2)}${ticket.endsWith("A") ? "B" : "A"}A`;
  assert.equal(await openTicket(tampered, env.TICKET_KEY), null);
  assert.equal(await openTicket(ticket, Buffer.alloc(32, 9).toString("base64")), null);
  const res = await handle(post("/v1/wake", { ticket: tampered, kind: "approval" }), env);
  assert.equal(res.status, 400);
});

test("APNs wake sends a content-free alert with a valid ES256 provider token", async () => {
  const ticket = await register("apns-sandbox", APNS_TOKEN);
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fake: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init! });
    return new Response("", { status: 200 });
  };
  const res = await handle(post("/v1/wake", { ticket, kind: "approval" }), env, fake);
  assert.equal(res.status, 200);
  assert.equal(calls[0].url, `https://api.sandbox.push.apple.com/3/device/${APNS_TOKEN}`);
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers["apns-topic"], "dev.satchel.ios");
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.kind, "approval");
  assert.doesNotMatch(JSON.stringify(body), /passport|reveal|agent/i);
  const [h, c, s] = headers.authorization.replace("bearer ", "").split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url").toString()), { alg: "ES256", kid: "ABC123DEFG" });
  assert.equal(JSON.parse(Buffer.from(c, "base64url").toString()).iss, "TEAM123456");
  assert.ok(verify("sha256", Buffer.from(`${h}.${c}`), { key: ec.publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url")));
});

test("APNs 410 surfaces as 410 so the node drops the ticket", async () => {
  const ticket = await register("apns", APNS_TOKEN);
  const res = await handle(
    post("/v1/wake", { ticket, kind: "delivery" }),
    env,
    async () => new Response(JSON.stringify({ reason: "Unregistered" }), { status: 410 }),
  );
  assert.equal(res.status, 410);
});

test("FCM wake exchanges a service-account JWT and sends a data-only message", async () => {
  const ticket = await register("fcm", "fcm-token-0123456789:abcdef");
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fake: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init! });
    if (String(url).includes("oauth2")) return new Response(JSON.stringify({ access_token: "ya29.test", expires_in: 3600 }));
    return new Response("{}");
  };
  const res = await handle(post("/v1/wake", { ticket, kind: "approval" }), env, fake);
  assert.equal(res.status, 200);
  const assertion = new URLSearchParams(String(calls[0].init.body)).get("assertion")!;
  const [h, c, s] = assertion.split(".");
  assert.ok(verify("sha256", Buffer.from(`${h}.${c}`), rsa.publicKey, Buffer.from(s, "base64url")));
  assert.equal(calls[1].url, "https://fcm.googleapis.com/v1/projects/satchel-test/messages:send");
  const msg = JSON.parse(String(calls[1].init.body)).message;
  assert.deepEqual(msg.data, { kind: "approval" });
  assert.equal(msg.notification, undefined);
});

test("input validation and rate limiting", async () => {
  assert.equal((await handle(post("/v1/register", { platform: "sms", token: "x".repeat(20) }), env)).status, 400);
  assert.equal((await handle(post("/v1/register", { platform: "fcm", token: "bad token!" }), env)).status, 400);
  const ticket = await register("fcm", "fcm-token-rate-limit-000000");
  const ok: typeof fetch = async (url) =>
    String(url).includes("oauth2") ? new Response(JSON.stringify({ access_token: "t", expires_in: 3600 })) : new Response("{}");
  let last = 0;
  for (let i = 0; i < 31; i++) last = (await handle(post("/v1/wake", { ticket, kind: "approval" }), env, ok)).status;
  assert.equal(last, 429);
});
