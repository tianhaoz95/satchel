import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { DEFAULT_POLICY, type RootConfig, type SecurityPolicy } from "@satchel/core";

export type RelayConfig = {
  /** Control endpoint of the relay, e.g. "relay.satchel.dev:7443". */
  control: string;
  /** Node token issued by the relay operator (hosted portal or self-hosted relay). */
  token: string;
  /** HTTPS base of the relay's API (ACME DNS helper). Defaults to https://<control host>. */
  api?: string;
  /** Use plain TCP for the control channel (local development only). */
  insecure?: boolean;
  /** Extra CA for the relay control channel (self-hosted relays with private certs). */
  caFile?: string;
};

export type NodeConfig = {
  nodeId: string;
  name: string;
  roots: RootConfig[];
  policy: SecurityPolicy;
  owner: { salt: string; hash: string } | null;
  /** Local HTTP listener (loopback by default) for the admin UI and local agents. */
  listen: { host: string; port: number };
  /** Local TLS listener the tunnel forwards to; TLS is terminated here, never at the relay. */
  tlsPort: number;
  relay: RelayConfig | null;
  /** Public hostname assigned by the relay, e.g. "alice.satchel.dev". Filled in on first connect. */
  publicHost: string | null;
  /** Folder (vault path) where phone captures land. */
  inbox: string | null;
  vapid: { publicKey: string; privateKey: string; subject: string } | null;
  helpers: { ocr: boolean; llm: { url: string; model: string } | null };
};

export function defaultDataDir(): string {
  if (process.env.SATCHEL_DATA_DIR) return process.env.SATCHEL_DATA_DIR;
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "Satchel");
  if (process.platform === "win32") return path.join(process.env.APPDATA ?? os.homedir(), "Satchel");
  return path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"), "satchel");
}

export function loadConfig(dataDir: string): NodeConfig {
  const file = path.join(dataDir, "config.json");
  const base: NodeConfig = {
    nodeId: randomUUID(),
    name: os.hostname(),
    roots: [],
    policy: DEFAULT_POLICY,
    owner: null,
    listen: { host: "127.0.0.1", port: 7710 },
    tlsPort: 7711,
    relay: null,
    publicHost: null,
    inbox: null,
    vapid: null,
    helpers: { ocr: process.platform === "darwin", llm: null },
  };
  if (!existsSync(file)) return base;
  const saved = JSON.parse(readFileSync(file, "utf8"));
  return { ...base, ...saved, policy: { ...DEFAULT_POLICY, ...saved.policy, approvals: { ...DEFAULT_POLICY.approvals, ...saved.policy?.approvals } } };
}

export function saveConfig(dataDir: string, config: NodeConfig) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path.join(dataDir, "config.json"), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

export function hashPassword(password: string): { salt: string; hash: string } {
  const salt = randomBytes(16).toString("hex");
  return { salt, hash: scryptSync(password, salt, 32).toString("hex") };
}

export function checkPassword(owner: NodeConfig["owner"], password: string): boolean {
  if (!owner) return false;
  const got = scryptSync(password, owner.salt, 32);
  return timingSafeEqual(got, Buffer.from(owner.hash, "hex"));
}
