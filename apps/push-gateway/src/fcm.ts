import { b64url, pemToDer, utf8 } from "./b64.ts";

export type ServiceAccount = { project_id: string; client_email: string; private_key: string };

let cached: { token: string; exp: number; email: string } | null = null;

/** OAuth2 access token for FCM HTTP v1 via a signed service-account JWT (RS256). */
export async function fcmAccessToken(sa: ServiceAccount, fetcher: typeof fetch = fetch, now = Date.now()): Promise<string> {
  if (cached && cached.email === sa.client_email && cached.exp - 60_000 > now) return cached.token;
  const iat = Math.floor(now / 1000);
  const header = b64url(utf8(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = b64url(
    utf8(
      JSON.stringify({
        iss: sa.client_email,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: "https://oauth2.googleapis.com/token",
        iat,
        exp: iat + 3600,
      }),
    ),
  );
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(sa.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, utf8(`${header}.${claims}`));
  const res = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${b64url(sig)}` }),
  });
  if (!res.ok) throw new Error(`FCM token exchange failed: ${res.status}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: body.access_token, exp: now + body.expires_in * 1000, email: sa.client_email };
  return body.access_token;
}

export function resetFcmCache() {
  cached = null;
}

export async function sendFcm(sa: ServiceAccount, token: string, kind: string, fetcher: typeof fetch = fetch): Promise<"ok" | "gone" | "error"> {
  const res = await fetcher(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: "POST",
    headers: { authorization: `Bearer ${await fcmAccessToken(sa, fetcher)}`, "content-type": "application/json" },
    body: JSON.stringify({
      message: {
        token,
        // Data-only: the app shows a generic notification itself, so nothing readable passes through Google.
        data: { kind },
        android: { priority: "HIGH", ttl: "3600s" },
      },
    }),
  });
  if (res.ok) return "ok";
  if (res.status === 404) return "gone";
  const status = ((await res.json().catch(() => ({}))) as { error?: { status?: string } }).error?.status;
  return status === "NOT_FOUND" || status === "UNREGISTERED" ? "gone" : "error";
}
