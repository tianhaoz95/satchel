import { b64url, fromB64, fromB64url, utf8 } from "./b64.ts";

/** What a ticket hides from the node: the platform push token. */
export type Target = { p: "apns" | "apns-sandbox" | "fcm"; t: string; topic?: string };

async function key(secretB64: string): Promise<CryptoKey> {
  const raw = fromB64(secretB64);
  if (raw.length !== 32) throw new Error("TICKET_KEY must be 32 bytes, base64");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Tickets are AES-256-GCM sealed targets: opaque to nodes, unforgeable without the gateway key. */
export async function sealTicket(target: Target, secretB64: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: utf8("satchel-ticket-v1") }, await key(secretB64), utf8(JSON.stringify(target))),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return `v1.${b64url(out)}`;
}

export async function openTicket(ticket: string, secretB64: string): Promise<Target | null> {
  if (!ticket.startsWith("v1.")) return null;
  try {
    const bytes = fromB64url(ticket.slice(3));
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, 12), additionalData: utf8("satchel-ticket-v1") },
      await key(secretB64),
      bytes.slice(12),
    );
    return JSON.parse(new TextDecoder().decode(pt));
  } catch {
    return null;
  }
}
