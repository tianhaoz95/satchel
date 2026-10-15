import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";

/**
 * Node-local state: the search index (a rebuildable cache) plus auth, approvals and audit.
 * Lives in the node's data directory, never inside the vault, so agents can't touch it.
 */
export type Grant = {
  /** Root names this client may see, or ["*"]. */
  roots: string[];
  /** read | write | organize | reveal */
  scopes: string[];
  label: string;
};

export type TokenRow = {
  hash: string;
  kind: "access" | "refresh" | "pat";
  client_id: string;
  label: string;
  grant: Grant;
  expires_at: number | null;
  created_at: number;
  last_used_at: number | null;
};

export type Approval = {
  id: string;
  client_id: string;
  client_name: string;
  action: string;
  target: string;
  detail: Record<string, unknown>;
  reason: string;
  status: "pending" | "approved" | "denied" | "expired" | "used";
  created_at: number;
  decided_at: number | null;
  decided_by: string | null;
  /** Outcome of the approved action (executed on approval for side effects, on pickup for reveals). */
  result: unknown;
};

export type AuditRow = {
  id: number;
  at: number;
  client_id: string;
  client_name: string;
  tool: string;
  args: Record<string, unknown>;
  revealed: string[];
  outcome: string;
};

export type Delivery = {
  id: string;
  at: number;
  client_name: string;
  title: string;
  value: string;
  note: string;
  seen: number;
};

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const newToken = (prefix: string) => `${prefix}_${randomBytes(24).toString("base64url")}`;

const SCHEMA = `
create table if not exists files (
  vpath text primary key, root text not null, rel text not null, name text not null,
  size integer not null, mtime_ms real not null, sha256 text not null,
  meta text, has_text integer not null default 0, indexed_at integer not null
);
create table if not exists dates (vpath text not null, key text not null, value text not null);
create index if not exists dates_kv on dates(key, value);
create virtual table if not exists fts using fts5(vpath unindexed, name, meta, body);
create table if not exists kv (k text primary key, v text not null);
create table if not exists oauth_clients (client_id text primary key, info text not null, created_at integer not null);
create table if not exists tokens (
  hash text primary key, kind text not null, client_id text not null, label text not null,
  grant_json text not null, expires_at integer, created_at integer not null, last_used_at integer
);
create table if not exists auth_codes (
  code text primary key, client_id text not null, grant_json text not null, challenge text not null,
  redirect_uri text not null, resource text, expires_at integer not null
);
create table if not exists approvals (
  id text primary key, client_id text not null, client_name text not null, action text not null,
  target text not null, detail text not null, reason text not null, status text not null,
  created_at integer not null, decided_at integer, decided_by text, result text
);
create table if not exists plans (id text primary key, client_id text not null, moves text not null, status text not null, created_at integer not null);
create table if not exists audit (
  id integer primary key autoincrement, at integer not null, client_id text not null, client_name text not null,
  tool text not null, args text not null, revealed text not null, outcome text not null
);
create table if not exists deliveries (id text primary key, at integer not null, client_name text not null, title text not null, value text not null, note text not null, seen integer not null default 0);
create table if not exists devices (id text primary key, name text not null, token_hash text not null, created_at integer not null, last_seen integer);
create table if not exists push_subs (endpoint text primary key, device_id text not null, sub text not null);
create table if not exists pairing (code text primary key, expires_at integer not null);
`;

export class Store {
  readonly db: DatabaseSync;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, "satchel.sqlite"));
    this.db.exec("pragma journal_mode = wal;");
    this.db.exec(SCHEMA);
  }

  close() {
    this.db.close();
  }

  // ---- kv
  get(k: string): string | undefined {
    const row = this.db.prepare("select v from kv where k = ?").get(k) as { v: string } | undefined;
    return row?.v;
  }
  set(k: string, v: string) {
    this.db.prepare("insert into kv(k, v) values(?, ?) on conflict(k) do update set v = excluded.v").run(k, v);
  }

  // ---- OAuth clients
  getClient(id: string): any | undefined {
    const row = this.db.prepare("select info from oauth_clients where client_id = ?").get(id) as { info: string } | undefined;
    return row ? JSON.parse(row.info) : undefined;
  }
  saveClient(info: { client_id: string }) {
    this.db
      .prepare("insert into oauth_clients(client_id, info, created_at) values(?, ?, ?) on conflict(client_id) do update set info = excluded.info")
      .run(info.client_id, JSON.stringify(info), Date.now());
  }
  clientName(id: string): string {
    if (id.startsWith("pat:")) return this.getToken(id.slice(4))?.label ?? id;
    return this.getClient(id)?.client_name ?? id;
  }

  // ---- tokens (only hashes are stored)
  issueToken(kind: TokenRow["kind"], clientId: string, grant: Grant, ttlSeconds: number | null): string {
    const token = newToken(kind === "pat" ? "satchel_pat" : kind === "access" ? "satchel_at" : "satchel_rt");
    this.db
      .prepare("insert into tokens(hash, kind, client_id, label, grant_json, expires_at, created_at) values(?,?,?,?,?,?,?)")
      .run(sha256(token), kind, clientId, grant.label, JSON.stringify(grant), ttlSeconds ? Date.now() + ttlSeconds * 1000 : null, Date.now());
    return token;
  }
  findToken(token: string): TokenRow | undefined {
    const row = this.db.prepare("select * from tokens where hash = ?").get(sha256(token)) as any;
    if (!row) return undefined;
    if (row.expires_at && row.expires_at < Date.now()) return undefined;
    this.db.prepare("update tokens set last_used_at = ? where hash = ?").run(Date.now(), row.hash);
    return this.rowToToken(row);
  }
  getToken(hash: string): TokenRow | undefined {
    const row = this.db.prepare("select * from tokens where hash = ?").get(hash) as any;
    return row ? this.rowToToken(row) : undefined;
  }
  private rowToToken(row: any): TokenRow {
    return { ...row, grant: JSON.parse(row.grant_json) };
  }
  revokeToken(token: string) {
    this.db.prepare("delete from tokens where hash = ?").run(sha256(token));
  }
  revokeByHash(hash: string) {
    this.db.prepare("delete from tokens where hash = ?").run(hash);
  }
  revokeClient(clientId: string) {
    this.db.prepare("delete from tokens where client_id = ?").run(clientId);
  }
  /** One row per connected client (OAuth client or personal access token), newest grant wins. */
  listConnections(): Array<{ client_id: string; name: string; kind: string; grant: Grant; last_used_at: number | null; created_at: number; hash: string }> {
    const rows = this.db
      .prepare("select * from tokens where kind in ('pat','refresh') or (kind = 'access' and client_id not in (select client_id from tokens where kind = 'refresh')) order by created_at desc")
      .all() as any[];
    const seen = new Set<string>();
    const out = [];
    for (const r of rows) {
      const key = r.kind === "pat" ? `pat:${r.hash}` : r.client_id;
      if (seen.has(key)) continue;
      seen.add(key);
      const t = this.rowToToken(r);
      const used = this.db.prepare("select max(last_used_at) as m from tokens where client_id = ?").get(r.client_id) as any;
      out.push({
        client_id: r.client_id,
        name: r.kind === "pat" ? r.label : this.clientName(r.client_id),
        kind: r.kind === "pat" ? "token" : "oauth",
        grant: t.grant,
        last_used_at: r.kind === "pat" ? r.last_used_at : used?.m ?? null,
        created_at: r.created_at,
        hash: r.hash,
      });
    }
    return out;
  }

  // ---- auth codes
  saveCode(code: string, clientId: string, grant: Grant, challenge: string, redirectUri: string, resource?: string) {
    this.db
      .prepare("insert into auth_codes(code, client_id, grant_json, challenge, redirect_uri, resource, expires_at) values(?,?,?,?,?,?,?)")
      .run(sha256(code), clientId, JSON.stringify(grant), challenge, redirectUri, resource ?? null, Date.now() + 5 * 60_000);
  }
  getCode(code: string): { client_id: string; grant: Grant; challenge: string; redirect_uri: string; resource: string | null } | undefined {
    const row = this.db.prepare("select * from auth_codes where code = ? and expires_at > ?").get(sha256(code), Date.now()) as any;
    return row ? { ...row, grant: JSON.parse(row.grant_json) } : undefined;
  }
  deleteCode(code: string) {
    this.db.prepare("delete from auth_codes where code = ?").run(sha256(code));
  }

  // ---- approvals
  createApproval(a: Omit<Approval, "id" | "status" | "created_at" | "decided_at" | "decided_by" | "result">): Approval {
    const row: Approval = { ...a, id: randomUUID(), status: "pending", created_at: Date.now(), decided_at: null, decided_by: null, result: null };
    this.db
      .prepare("insert into approvals(id, client_id, client_name, action, target, detail, reason, status, created_at) values(?,?,?,?,?,?,?,?,?)")
      .run(row.id, row.client_id, row.client_name, row.action, row.target, JSON.stringify(row.detail), row.reason, row.status, row.created_at);
    return row;
  }
  getApproval(id: string): Approval | undefined {
    const row = this.db.prepare("select * from approvals where id = ?").get(id) as any;
    return row ? this.rowToApproval(row) : undefined;
  }
  listApprovals(status?: Approval["status"], limit = 100): Approval[] {
    const rows = status
      ? this.db.prepare("select * from approvals where status = ? order by created_at desc limit ?").all(status, limit)
      : this.db.prepare("select * from approvals order by created_at desc limit ?").all(limit);
    return (rows as any[]).map((r) => this.rowToApproval(r));
  }
  decideApproval(id: string, status: "approved" | "denied", by: string): Approval | undefined {
    this.db.prepare("update approvals set status = ?, decided_at = ?, decided_by = ? where id = ? and status = 'pending'").run(status, Date.now(), by, id);
    return this.getApproval(id);
  }
  /** Approvals are short-lived: an unanswered request expires after a day. */
  expireApprovals(maxAgeMs = 24 * 3600_000) {
    this.db.prepare("update approvals set status = 'expired' where status = 'pending' and created_at < ?").run(Date.now() - maxAgeMs);
  }
  setApprovalResult(id: string, result: unknown, status?: Approval["status"]) {
    if (status) this.db.prepare("update approvals set result = ?, status = ? where id = ?").run(JSON.stringify(result ?? null), status, id);
    else this.db.prepare("update approvals set result = ? where id = ?").run(JSON.stringify(result ?? null), id);
  }
  private rowToApproval(r: any): Approval {
    return { ...r, detail: JSON.parse(r.detail), result: r.result ? JSON.parse(r.result) : null };
  }

  // ---- reorganization plans
  savePlan(clientId: string, moves: Array<{ from: string; to: string }>): string {
    const id = randomUUID();
    this.db.prepare("insert into plans(id, client_id, moves, status, created_at) values(?,?,?,?,?)").run(id, clientId, JSON.stringify(moves), "proposed", Date.now());
    return id;
  }
  getPlan(id: string): { id: string; client_id: string; moves: Array<{ from: string; to: string }>; status: string } | undefined {
    const row = this.db.prepare("select * from plans where id = ?").get(id) as any;
    return row ? { ...row, moves: JSON.parse(row.moves) } : undefined;
  }
  setPlanStatus(id: string, status: string) {
    this.db.prepare("update plans set status = ? where id = ?").run(status, id);
  }

  // ---- audit
  audit(row: Omit<AuditRow, "id" | "at">) {
    this.db
      .prepare("insert into audit(at, client_id, client_name, tool, args, revealed, outcome) values(?,?,?,?,?,?,?)")
      .run(Date.now(), row.client_id, row.client_name, row.tool, JSON.stringify(row.args), JSON.stringify(row.revealed), row.outcome);
    this.set("last_agent_query_at", String(Date.now()));
  }
  listAudit(limit = 200, clientId?: string): AuditRow[] {
    const rows = clientId
      ? this.db.prepare("select * from audit where client_id = ? order by id desc limit ?").all(clientId, limit)
      : this.db.prepare("select * from audit order by id desc limit ?").all(limit);
    return (rows as any[]).map((r) => ({ ...r, args: JSON.parse(r.args), revealed: JSON.parse(r.revealed) }));
  }

  // ---- deliveries (secrets sent to the owner's devices, never to the model)
  addDelivery(d: Omit<Delivery, "id" | "at" | "seen">): Delivery {
    const row: Delivery = { ...d, id: randomUUID(), at: Date.now(), seen: 0 };
    this.db.prepare("insert into deliveries(id, at, client_name, title, value, note, seen) values(?,?,?,?,?,?,0)").run(row.id, row.at, row.client_name, row.title, row.value, row.note);
    return row;
  }
  listDeliveries(limit = 50): Delivery[] {
    return this.db.prepare("select * from deliveries order by at desc limit ?").all(limit) as any[];
  }
  markDeliverySeen(id: string) {
    this.db.prepare("update deliveries set seen = 1 where id = ?").run(id);
  }
  /** Delivered secrets are wiped after 24 hours. */
  purgeDeliveries(maxAgeMs = 24 * 3600_000) {
    this.db.prepare("delete from deliveries where at < ?").run(Date.now() - maxAgeMs);
  }

  // ---- companion devices
  createPairingCode(): string {
    const code = randomBytes(5).toString("hex").toUpperCase();
    this.db.prepare("insert into pairing(code, expires_at) values(?, ?)").run(code, Date.now() + 10 * 60_000);
    return code;
  }
  consumePairingCode(code: string): boolean {
    const row = this.db.prepare("select * from pairing where code = ? and expires_at > ?").get(code.toUpperCase(), Date.now());
    this.db.prepare("delete from pairing where code = ?").run(code.toUpperCase());
    return !!row;
  }
  addDevice(name: string): { id: string; token: string } {
    const id = randomUUID();
    const token = newToken("satchel_dev");
    this.db.prepare("insert into devices(id, name, token_hash, created_at) values(?,?,?,?)").run(id, name, sha256(token), Date.now());
    return { id, token };
  }
  findDevice(token: string): { id: string; name: string } | undefined {
    const row = this.db.prepare("select id, name from devices where token_hash = ?").get(sha256(token)) as any;
    if (row) this.db.prepare("update devices set last_seen = ? where id = ?").run(Date.now(), row.id);
    return row;
  }
  listDevices(): Array<{ id: string; name: string; created_at: number; last_seen: number | null }> {
    return this.db.prepare("select id, name, created_at, last_seen from devices order by created_at desc").all() as any[];
  }
  removeDevice(id: string) {
    this.db.prepare("delete from devices where id = ?").run(id);
    this.db.prepare("delete from push_subs where device_id = ?").run(id);
  }
  savePushSub(deviceId: string, sub: { endpoint: string }) {
    this.db.prepare("insert into push_subs(endpoint, device_id, sub) values(?,?,?) on conflict(endpoint) do update set sub = excluded.sub").run(sub.endpoint, deviceId, JSON.stringify(sub));
  }
  listPushSubs(): Array<{ endpoint: string; sub: any }> {
    return (this.db.prepare("select endpoint, sub from push_subs").all() as any[]).map((r) => ({ endpoint: r.endpoint, sub: JSON.parse(r.sub) }));
  }
  removePushSub(endpoint: string) {
    this.db.prepare("delete from push_subs where endpoint = ?").run(endpoint);
  }
}
