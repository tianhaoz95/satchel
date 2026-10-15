import { randomBytes } from "node:crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import QRCode from "qrcode";
import { pairingLink, DEFAULT_POLICY, type Grant, keyFingerprint, sensitiveKeys, VaultError } from "@satchel/core";
import { checkPassword } from "./config.ts";
import type { SatchelNode } from "./node.ts";
import { tunnelStatus } from "./tunnel.ts";
import { tlsPin } from "./certs.ts";
import { sendDecisionError } from "./companion.ts";

const sessions = new Map<string, number>();
const oneTimeLogins = new Map<string, number>();
const failures = new Map<string, { count: number; until: number }>();
const SESSION_MS = 12 * 3600_000;

/** Used by the desktop app to open the admin UI without asking for the password it already holds. */
export function createOneTimeLogin(): string {
  const t = randomBytes(24).toString("base64url");
  oneTimeLogins.set(t, Date.now() + 60_000);
  return t;
}

function cookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
}

function startSession(req: Request, res: Response) {
  const sid = randomBytes(24).toString("base64url");
  sessions.set(sid, Date.now() + SESSION_MS);
  const secure = req.protocol === "https" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `satchel_admin=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure}`);
}

export function isAdmin(req: Request): boolean {
  const sid = cookie(req, "satchel_admin");
  const exp = sid ? sessions.get(sid) : undefined;
  return !!exp && exp > Date.now();
}

export function adminRouter(node: SatchelNode): Router {
  const r = Router();
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown> | unknown) => async (req: Request, res: Response) => {
    try {
      const out = await fn(req, res);
      if (!res.headersSent) res.json(out ?? { ok: true });
    } catch (err: any) {
      res.status(err instanceof VaultError ? 400 : 500).json({ error: err.message });
    }
  };

  r.get("/session", (req, res) => res.json({ authenticated: isAdmin(req), initialized: !!node.config.owner, name: node.config.name }));

  r.post("/login", (req, res) => {
    const ip = req.socket.remoteAddress ?? "?";
    const f = failures.get(ip);
    if (f && f.until > Date.now()) return res.status(429).json({ error: "Too many attempts. Wait a minute." });
    const { password, token } = req.body ?? {};
    const okToken = token && (oneTimeLogins.get(token) ?? 0) > Date.now();
    if (token) oneTimeLogins.delete(token);
    if (!okToken && !checkPassword(node.config.owner, String(password ?? ""))) {
      const count = (f?.count ?? 0) + 1;
      failures.set(ip, { count, until: count >= 5 ? Date.now() + 60_000 : 0 });
      return res.status(401).json({ error: "Wrong password" });
    }
    failures.delete(ip);
    startSession(req, res);
    res.json({ ok: true });
  });

  r.post("/logout", (req, res) => {
    const sid = cookie(req, "satchel_admin");
    if (sid) sessions.delete(sid);
    res.setHeader("Set-Cookie", "satchel_admin=; Path=/; Max-Age=0");
    res.json({ ok: true });
  });

  r.use((req: Request, res: Response, next: NextFunction) => {
    if (!isAdmin(req)) return res.status(401).json({ error: "Not signed in" });
    // Same-origin check for state-changing requests (SameSite=Strict already blocks most CSRF).
    if (req.method !== "GET" && req.headers.origin && new URL(req.headers.origin).host !== req.get("host"))
      return res.status(403).json({ error: "Bad origin" });
    next();
  });

  const all: Grant = { roots: ["*"], scopes: ["read", "write", "organize", "reveal"], label: "owner" };

  r.get(
    "/overview",
    wrap(() => {
      const last = node.store.get("last_agent_query_at");
      const upcoming = node.vault.queryDates(
        {
          keys: ["expires_on", "renew_by"],
          after: new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10),
          before: new Date(Date.now() + 365 * 86400_000).toISOString().slice(0, 10),
          limit: 12,
        },
        ["*"],
      );
      return {
        name: node.config.name,
        roots: node.config.roots,
        stats: node.vault.stats(["*"]),
        connections: node.store.listConnections().length,
        pending: node.store.listApprovals("pending").length,
        devices: node.store.listDevices().length,
        last_agent_activity: last ? Number(last) : null,
        public_url: node.config.publicHost ? `https://${node.config.publicHost}` : null,
        local_url: `http://${node.config.listen.host}:${node.config.listen.port}`,
        tunnel: tunnelStatus(),
        upcoming: upcoming.map((u) => ({
          key: u.key,
          date: u.date,
          path: u.file.vpath,
          title: u.file.meta?.title ?? u.file.name,
          subject: u.file.meta?.subject ?? null,
        })),
      };
    }),
  );

  r.get(
    "/files",
    wrap((req) => {
      const q = String(req.query.q ?? "");
      const prefix = req.query.prefix ? String(req.query.prefix) : undefined;
      const has = req.query.has_metadata === undefined ? undefined : req.query.has_metadata === "true";
      return node.vault.search(q, { path_prefix: prefix, has_metadata: has, limit: 100 }, ["*"]).map((e) => ({
        ...node.present(e, all),
        sensitive: e.meta ? [...sensitiveKeys(e.meta, node.config.policy)] : [],
      }));
    }),
  );

  r.get(
    "/file",
    wrap(async (req) => {
      const vpath = String(req.query.path);
      const e = node.vault.get(vpath);
      if (!e) throw new VaultError("Not found");
      const { text } = await node.vault.readText(vpath, 4000);
      return { ...node.present(e, all), sensitive: e.meta ? [...sensitiveKeys(e.meta, node.config.policy)] : [], text };
    }),
  );

  r.get("/file/raw", (req, res) => {
    try {
      res.sendFile(node.absPath(String(req.query.path)));
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  r.put(
    "/file/meta",
    wrap(async (req) => node.vault.setMetadata(String(req.body.path), req.body.fields ?? {}, { replace: !!req.body.replace, actor: "owner" })),
  );

  r.post(
    "/file/text",
    wrap(async (req) => node.vault.putText(String(req.body.path), String(req.body.text ?? ""))),
  );

  r.post(
    "/rescan",
    wrap(async () => node.vault.scan()),
  );

  r.get(
    "/tree",
    wrap(() => node.vault.tree(["*"])),
  );

  // ---- connections (OAuth clients and personal access tokens)
  r.get(
    "/connections",
    wrap(() => node.store.listConnections()),
  );
  r.post(
    "/tokens",
    wrap((req) => {
      const { label, roots, scopes } = req.body ?? {};
      const grant: Grant = {
        label: String(label || "Personal token"),
        roots: Array.isArray(roots) && roots.length ? roots.map(String) : ["*"],
        scopes: Array.from(new Set(["read", ...(Array.isArray(scopes) ? scopes.map(String) : [])])),
      };
      const token = node.store.issueToken("pat", "pat", grant, null);
      return { token, grant };
    }),
  );
  r.delete(
    "/connections/:id",
    wrap((req) => {
      const id = String(req.params.id);
      if (id.startsWith("pat:")) node.store.revokeByHash(id.slice(4));
      else node.store.revokeClient(id);
      return { ok: true };
    }),
  );

  // ---- approvals
  r.get(
    "/approvals",
    wrap((req) =>
      node.store
        .listApprovals(req.query.status ? (String(req.query.status) as any) : undefined)
        .map((a) => ({ ...a, requires_signature: a.status === "pending" && node.requiresSignature(a.action) })),
    ),
  );
  r.post("/approvals/:id", async (req, res) => {
    try {
      res.json(await node.decide(String(req.params.id), req.body?.decision === "approved" ? "approved" : "denied", "owner (admin UI)"));
    } catch (err) {
      sendDecisionError(res, err);
    }
  });

  // ---- journal, audit, conventions, policy
  r.get(
    "/journal",
    wrap(() => node.vault.journalEntries(["*"], 300)),
  );
  r.post(
    "/journal/:id/undo",
    wrap(async (req) => node.vault.undo(String(req.params.id), "owner")),
  );
  r.get(
    "/audit",
    wrap((req) => node.store.listAudit(300, req.query.client ? String(req.query.client) : undefined)),
  );
  r.get(
    "/conventions",
    wrap(async (req) => ({ text: await node.vault.getConventions(String(req.query.root ?? node.config.roots[0]?.name)) })),
  );
  r.put(
    "/conventions",
    wrap(async (req) => node.vault.setConventions(String(req.body.root), String(req.body.text), "owner")),
  );
  r.get(
    "/policy",
    wrap(() => ({ policy: node.config.policy, defaults: DEFAULT_POLICY })),
  );
  r.put(
    "/policy",
    wrap((req) => {
      const p = req.body?.policy;
      if (!p || !Array.isArray(p.sensitivePatterns)) throw new VaultError("Invalid policy");
      for (const pat of p.sensitivePatterns) new RegExp(pat);
      if (p.approvals?.deviceSignature && !["when_paired", "always", "never"].includes(p.approvals.deviceSignature))
        throw new VaultError("Invalid deviceSignature");
      node.saveConfig({ policy: { sensitivePatterns: p.sensitivePatterns.map(String), approvals: { ...node.config.policy.approvals, ...p.approvals } } });
      return node.config.policy;
    }),
  );

  // ---- settings
  r.get(
    "/settings",
    wrap(() => ({
      name: node.config.name,
      roots: node.config.roots,
      inbox: node.config.inbox,
      relay: node.config.relay ? { control: node.config.relay.control } : null,
      publicHost: node.config.publicHost,
      helpers: node.config.helpers,
    })),
  );
  r.put(
    "/settings",
    wrap((req) => {
      const b = req.body ?? {};
      const patch: any = {};
      if (typeof b.name === "string") patch.name = b.name;
      if (Array.isArray(b.roots)) patch.roots = b.roots.map((x: any) => ({ name: String(x.name), path: String(x.path) }));
      if (b.inbox !== undefined) patch.inbox = b.inbox ? String(b.inbox) : null;
      if (b.helpers) patch.helpers = b.helpers;
      node.saveConfig(patch);
      return { ok: true };
    }),
  );

  // ---- companion devices
  r.get(
    "/devices",
    wrap(() =>
      node.store
        .listDevices()
        .map(({ push_ticket, public_key, ...d }) => ({
          ...d,
          signing: !!public_key,
          push: !!push_ticket,
          key_fingerprint: public_key ? keyFingerprint(public_key) : null,
        })),
    ),
  );
  r.delete(
    "/devices/:id",
    wrap((req) => node.store.removeDevice(String(req.params.id))),
  );
  r.post(
    "/pair",
    wrap(async (req) => {
      const code = node.store.createPairingCode();
      const base = node.config.publicHost ? `https://${node.config.publicHost}` : `${req.protocol}://${req.get("host")}`;
      const pin = tlsPin(node.dataDir);
      // Native apps scan the satchel:// link (it carries the TLS pin); the PWA link is a read-only fallback.
      const link = pairingLink({ url: base, code, nodeId: node.config.nodeId, nodeName: node.config.name, pin: node.config.publicHost ? pin : null });
      const pwa = `${base}/app/#pair=${code}`;
      return { code, link, pwa, pin, url: pwa, qr: await QRCode.toString(link, { type: "svg", margin: 1 }) };
    }),
  );
  r.get(
    "/deliveries",
    wrap(() => node.store.listDeliveries().map((d) => ({ ...d, value: undefined }))),
  );

  // ---- live updates for the UI
  r.get("/events", (req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(": ok\n\n");
    const off = node.on((event) => res.write(`event: ${event}\ndata: {}\n\n`));
    const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
    req.on("close", () => {
      off();
      clearInterval(ping);
    });
  });

  return r;
}
