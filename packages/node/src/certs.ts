import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { X509Certificate } from "node:crypto";
import path from "node:path";
import { generate } from "selfsigned";
import type { SatchelNode } from "./node.ts";

export type CertPair = { key: string; cert: string; issuer: "acme" | "self-signed" };

const RENEW_BEFORE_MS = 20 * 86400_000;

/**
 * The node holds the TLS certificate for its public hostname, so the relay can only forward
 * encrypted bytes. With a relay that offers the ACME DNS-01 helper, the node gets a real Let's
 * Encrypt certificate (the private key is generated here and never leaves the machine); otherwise
 * it falls back to a self-signed certificate for local testing.
 */
export async function ensureCertificate(node: SatchelNode, opts: { force?: boolean } = {}): Promise<CertPair> {
  const host = node.config.publicHost ?? "localhost";
  const dir = path.join(node.dataDir, "tls");
  const keyFile = path.join(dir, "key.pem");
  const certFile = path.join(dir, "cert.pem");
  if (!opts.force && existsSync(keyFile) && existsSync(certFile)) {
    const cert = readFileSync(certFile, "utf8");
    const x = new X509Certificate(cert);
    const valid = Date.parse(x.validTo) - Date.now() > RENEW_BEFORE_MS;
    if (valid && x.checkHost(host)) return { key: readFileSync(keyFile, "utf8"), cert, issuer: x.issuer === x.subject ? "self-signed" : "acme" };
  }
  await mkdir(dir, { recursive: true, mode: 0o700 });
  let pair: CertPair | null = null;
  const api = node.config.relay && relayApiBase(node.config.relay.control, node.config.relay.api);
  if (api && node.config.publicHost && process.env.SATCHEL_ACME !== "off") {
    try {
      pair = await acmeCertificate(host, api, node.config.relay!.token, path.join(dir, "account.pem"));
    } catch (err: any) {
      console.warn(`[satchel] ACME certificate failed (${err.message}); using a self-signed certificate`);
    }
  }
  if (!pair) {
    const pems = await generate([{ name: "commonName", value: host }], {
      keySize: 2048,
      algorithm: "sha256",
      extensions: [
        {
          name: "subjectAltName",
          altNames: [
            { type: 2, value: host },
            { type: 2, value: "localhost" },
            { type: 7, ip: "127.0.0.1" },
          ],
        },
      ],
    } as any);
    pair = { key: pems.private, cert: pems.cert, issuer: "self-signed" };
  }
  await writeFile(keyFile, pair.key, { mode: 0o600 });
  await writeFile(certFile, pair.cert);
  return pair;
}

function relayApiBase(control: string, explicit?: string): string | null {
  if (explicit) return explicit.replace(/\/$/, "");
  if (process.env.SATCHEL_RELAY_API) return process.env.SATCHEL_RELAY_API.replace(/\/$/, "");
  const host = control.split(":")[0];
  if (host === "localhost" || host === "127.0.0.1") return null;
  return `https://${host}`;
}

async function acmeCertificate(host: string, api: string, nodeToken: string, accountKeyFile: string): Promise<CertPair> {
  const acme = (await import("acme-client")).default;
  let accountKey: Buffer;
  if (existsSync(accountKeyFile)) accountKey = readFileSync(accountKeyFile);
  else {
    accountKey = await acme.crypto.createPrivateKey();
    await writeFile(accountKeyFile, accountKey, { mode: 0o600 });
  }
  const client = new acme.Client({
    directoryUrl: process.env.SATCHEL_ACME_STAGING ? acme.directory.letsencrypt.staging : acme.directory.letsencrypt.production,
    accountKey,
  });
  const [key, csr] = await acme.crypto.createCsr({ altNames: [host] });
  const call = async (method: string, value: string) => {
    const res = await fetch(`${api}/v1/acme/txt`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${nodeToken}` },
      body: JSON.stringify({ value }),
    });
    if (!res.ok) throw new Error(`relay DNS helper returned ${res.status}`);
  };
  const cert = await client.auto({
    csr,
    termsOfServiceAgreed: true,
    challengePriority: ["dns-01"],
    challengeCreateFn: async (_authz, _challenge, keyAuthorization) => {
      await call("POST", keyAuthorization);
      await new Promise((r) => setTimeout(r, 15_000)); // DNS propagation
    },
    challengeRemoveFn: async (_authz, _challenge, keyAuthorization) => call("DELETE", keyAuthorization),
  });
  return { key: key.toString(), cert, issuer: "acme" };
}
