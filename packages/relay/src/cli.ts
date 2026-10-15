#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { Relay } from "./relay.ts";
import { FileVerifier, SupabaseVerifier, hashToken, type TokenVerifier } from "./verifier.ts";
import { CloudflareDns } from "./dns.ts";

const env = process.env;
const cmd = process.argv[2] ?? "serve";

if (cmd === "add-node") {
  const sub = process.argv[3];
  if (!sub || !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(sub)) {
    console.error("usage: satchel-relay add-node <subdomain>");
    process.exit(1);
  }
  const file = env.SATCHEL_RELAY_NODES_FILE ?? "nodes.json";
  const data = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { nodes: [] };
  const token = `satchel_node_${randomBytes(24).toString("base64url")}`;
  data.nodes = data.nodes.filter((n: any) => n.subdomain !== sub);
  data.nodes.push({ subdomain: sub, token_sha256: hashToken(token), created_at: new Date().toISOString() });
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  console.log(token);
} else if (cmd === "serve") {
  const domain = env.SATCHEL_RELAY_DOMAIN ?? "localhost";
  let verifier: TokenVerifier;
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) verifier = await SupabaseVerifier.create(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  else verifier = new FileVerifier(env.SATCHEL_RELAY_NODES_FILE ?? "nodes.json");
  const relay = new Relay({
    domain,
    apiHost: env.SATCHEL_RELAY_API_HOST ?? `relay.${domain}`,
    publicPort: Number(env.SATCHEL_RELAY_PUBLIC_PORT ?? 443),
    controlPort: Number(env.SATCHEL_RELAY_CONTROL_PORT ?? 7443),
    tls: env.SATCHEL_RELAY_TLS_CERT && env.SATCHEL_RELAY_TLS_KEY ? { cert: readFileSync(env.SATCHEL_RELAY_TLS_CERT), key: readFileSync(env.SATCHEL_RELAY_TLS_KEY) } : undefined,
    verifier,
    dns: env.CLOUDFLARE_ZONE_ID && env.CLOUDFLARE_API_TOKEN ? new CloudflareDns(env.CLOUDFLARE_ZONE_ID, env.CLOUDFLARE_API_TOKEN) : undefined,
  });
  await relay.start();
  const stop = async () => {
    await relay.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} else {
  console.log("usage: satchel-relay [serve|add-node <subdomain>]");
}
