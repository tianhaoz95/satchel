import { sendApns } from "./apns.ts";
import { sendFcm, type ServiceAccount } from "./fcm.ts";
import { openTicket, sealTicket, type Target } from "./ticket.ts";

export type Env = {
  TICKET_KEY: string;
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
  APNS_PRIVATE_KEY?: string;
  APNS_TOPIC?: string;
  FCM_SERVICE_ACCOUNT?: string;
};

const KINDS = new Set(["approval", "delivery"]);
// Best-effort per-isolate limit; a ticket holder can wake a device at most this often.
const WAKES_PER_MINUTE = 30;
const recent = new Map<string, number[]>();

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });

/**
 * Satchel push gateway. Apps register their APNs/FCM token and get back a sealed ticket, which
 * they hand to their own node. Nodes wake devices with the ticket. The gateway never sees vault
 * content and nodes never see platform push tokens.
 */
export async function handle(req: Request, env: Env, fetcher: typeof fetch = fetch): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === "GET" && url.pathname === "/healthz") return json(200, { ok: true });
  if (req.method !== "POST") return json(405, { error: "POST only" });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "JSON body required" });
  }

  if (url.pathname === "/v1/register") {
    const platform = body.platform;
    if (!["apns", "apns-sandbox", "fcm"].includes(platform)) return json(400, { error: "platform must be apns, apns-sandbox or fcm" });
    const token = String(body.token ?? "");
    if (!/^[A-Za-z0-9:_\-.]{16,4096}$/.test(token)) return json(400, { error: "Invalid token" });
    const target: Target = { p: platform, t: token, topic: platform === "fcm" ? undefined : String(body.topic || env.APNS_TOPIC || "dev.satchel.ios") };
    return json(200, { ticket: await sealTicket(target, env.TICKET_KEY) });
  }

  if (url.pathname === "/v1/wake") {
    const kind = String(body.kind ?? "approval");
    if (!KINDS.has(kind)) return json(400, { error: "Unknown kind" });
    const ticket = String(body.ticket ?? "");
    const target = await openTicket(ticket, env.TICKET_KEY);
    if (!target) return json(400, { error: "Invalid ticket" });
    const now = Date.now();
    const hits = (recent.get(ticket) ?? []).filter((t) => now - t < 60_000);
    if (hits.length >= WAKES_PER_MINUTE) return json(429, { error: "Too many wakes" });
    recent.set(ticket, [...hits, now]);
    let result: "ok" | "gone" | "error";
    if (target.p === "fcm") {
      if (!env.FCM_SERVICE_ACCOUNT) return json(503, { error: "FCM not configured" });
      result = await sendFcm(JSON.parse(env.FCM_SERVICE_ACCOUNT) as ServiceAccount, target.t, kind, fetcher);
    } else {
      if (!env.APNS_KEY_ID || !env.APNS_TEAM_ID || !env.APNS_PRIVATE_KEY) return json(503, { error: "APNs not configured" });
      result = await sendApns(
        { keyId: env.APNS_KEY_ID, teamId: env.APNS_TEAM_ID, privateKeyPem: env.APNS_PRIVATE_KEY },
        { token: target.t, topic: target.topic ?? env.APNS_TOPIC ?? "dev.satchel.ios", sandbox: target.p === "apns-sandbox" },
        kind,
        fetcher,
      );
    }
    if (result === "gone") return json(410, { error: "Device token is no longer valid" });
    if (result === "error") return json(502, { error: "Push provider rejected the request" });
    return json(200, { ok: true });
  }
  return json(404, { error: "Not found" });
}

export default { fetch: (req: Request, env: Env) => handle(req, env) };
