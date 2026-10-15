import { b64url, pemToDer, utf8 } from "./b64.ts";

export type ApnsConfig = { keyId: string; teamId: string; privateKeyPem: string };

let cached: { jwt: string; at: number; keyId: string } | null = null;

/** ES256 provider token, cached for 50 minutes (Apple accepts tokens up to an hour old). */
export async function apnsJwt(cfg: ApnsConfig, now = Date.now()): Promise<string> {
  if (cached && cached.keyId === cfg.keyId && now - cached.at < 50 * 60_000) return cached.jwt;
  const header = b64url(utf8(JSON.stringify({ alg: "ES256", kid: cfg.keyId })));
  const claims = b64url(utf8(JSON.stringify({ iss: cfg.teamId, iat: Math.floor(now / 1000) })));
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(cfg.privateKeyPem), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, utf8(`${header}.${claims}`));
  const jwt = `${header}.${claims}.${b64url(sig)}`;
  cached = { jwt, at: now, keyId: cfg.keyId };
  return jwt;
}

export function resetApnsCache() {
  cached = null;
}

/** Generic, content-free alert: the app loads details from the owner's node. */
export function apnsPayload(kind: string) {
  return {
    aps: {
      alert: { title: "Satchel", body: kind === "delivery" ? "You have something new in your inbox" : "Something needs your approval" },
      sound: "default",
      "thread-id": "satchel",
      category: kind === "delivery" ? "DELIVERY" : "APPROVAL",
    },
    kind,
  };
}

/** Returns "ok", "gone" (token no longer valid) or "error". */
export async function sendApns(
  cfg: ApnsConfig,
  target: { token: string; topic: string; sandbox: boolean },
  kind: string,
  fetcher: typeof fetch = fetch,
): Promise<"ok" | "gone" | "error"> {
  const host = target.sandbox ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
  const res = await fetcher(`${host}/3/device/${encodeURIComponent(target.token)}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${await apnsJwt(cfg)}`,
      "apns-topic": target.topic,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-expiration": String(Math.floor(Date.now() / 1000) + 3600),
      "content-type": "application/json",
    },
    body: JSON.stringify(apnsPayload(kind)),
  });
  if (res.ok) return "ok";
  if (res.status === 410) return "gone";
  const reason = ((await res.json().catch(() => ({}))) as { reason?: string }).reason;
  return reason === "BadDeviceToken" || reason === "Unregistered" ? "gone" : "error";
}
