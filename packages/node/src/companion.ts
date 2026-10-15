import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import express, { Router, type Request, type Response, type NextFunction } from "express";
import { enrollMessage, keyFingerprint, normalizePublicKey, pairingMessage, SIGNATURE_MAX_SKEW_MS, verifySignature, type Device } from "@satchel/core";
import { DecisionError, type SatchelNode } from "./node.ts";
import { isAdmin } from "./admin.ts";
import { tlsPin } from "./certs.ts";

const PLATFORMS = new Set(["ios", "android", "watchos", "wearos"]);

/** Maps decision errors to HTTP: missing/invalid signatures are 403, state conflicts 409. */
export function sendDecisionError(res: Response, err: unknown) {
  if (err instanceof DecisionError) {
    const status = err.code === "not_found" ? 404 : err.code === "already_decided" ? 409 : 403;
    return res.status(status).json({ error: err.message, code: err.code });
  }
  return res.status(500).json({ error: (err as Error).message });
}

const publicDevice = (d: Device) => ({
  id: d.id,
  name: d.name,
  platform: d.platform,
  kind: d.kind,
  parent_id: d.parent_id,
  hardware: d.hardware,
  signing: !!d.public_key,
  key_fingerprint: d.public_key ? keyFingerprint(d.public_key) : null,
  created_at: d.created_at,
  last_seen: d.last_seen,
  push: !!d.push_ticket,
});

/**
 * API for the phone companion (a PWA served by the node itself, reached through the tunnel).
 * Approvals, delivered secrets and captures flow phone <-> node directly; the hosted service
 * never sees them.
 */
export function companionRouter(node: SatchelNode): Router {
  const r = Router();
  r.use(express.json({ limit: "1mb" }));

  r.get("/vapid", (_req, res) => res.json({ publicKey: node.config.vapid?.publicKey ?? null, name: node.config.name }));

  r.post("/pair", (req, res) => {
    const { code, name } = req.body ?? {};
    if (!code || !node.store.consumePairingCode(String(code))) return res.status(400).json({ error: "Invalid or expired pairing code" });
    const device = node.store.addDevice(String(name || "Phone").slice(0, 60));
    node.emit("devices");
    res.json(device);
  });

  /**
   * v2 pairing for native apps: the app proves it holds the private key of the public key it
   * registers by signing the pairing message. The response carries the TLS pin for the app to verify.
   */
  r.post("/v2/pair", (req, res) => {
    const b = req.body ?? {};
    const code = String(b.code ?? "").toUpperCase();
    const platform = String(b.platform ?? "");
    const kind = b.kind === "watch" ? "watch" : "phone";
    if (!PLATFORMS.has(platform)) return res.status(400).json({ error: "Unknown platform" });
    let publicKey: string;
    try {
      publicKey = normalizePublicKey(String(b.public_key ?? ""));
    } catch (err: any) {
      return res.status(400).json({ error: `Invalid public key: ${err.message}` });
    }
    const message = pairingMessage({ nodeId: node.config.nodeId, code, publicKey });
    if (!verifySignature(publicKey, message, String(b.signature ?? ""))) return res.status(403).json({ error: "Key proof does not verify" });
    if (!node.store.consumePairingCode(code)) return res.status(400).json({ error: "Invalid or expired pairing code" });
    const device = node.store.addDevice(String(b.name || "Phone").slice(0, 60), {
      public_key: publicKey,
      platform: platform as Device["platform"],
      kind,
      hardware: !!b.hardware,
    });
    node.emit("devices");
    res.json({ ...device, node: { id: node.config.nodeId, name: node.config.name, pin: tlsPin(node.dataDir) } });
  });

  // Device token (Bearer) or an admin session (so the desktop can reuse these views).
  r.use((req: Request, res: Response, next: NextFunction) => {
    const auth = req.headers.authorization ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const device = token ? node.store.findDevice(token) : undefined;
    if (device) {
      (req as any).device = device;
      return next();
    }
    if (isAdmin(req)) {
      (req as any).device = { id: "admin", name: "desktop" };
      return next();
    }
    res.status(401).json({ error: "Not paired" });
  });

  r.get("/me", (req, res) => res.json({ device: (req as any).device, node: node.config.name }));

  r.get("/approvals", (_req, res) =>
    res.json(node.store.listApprovals(undefined, 50).map((a) => ({ ...a, requires_signature: node.requiresSignature(a.action) }))),
  );
  r.post("/approvals/:id", async (req, res) => {
    const decision = req.body?.decision === "approved" ? "approved" : "denied";
    try {
      res.json(await node.decide(String(req.params.id), decision, `owner (${(req as any).device.name})`));
    } catch (err) {
      sendDecisionError(res, err);
    }
  });

  // ---------------------------------------------------------------- v2 (native apps)

  const deviceOf = (req: Request): Device | undefined => {
    const d = (req as any).device;
    return d && d.id !== "admin" ? (d as Device) : undefined;
  };

  r.get("/v2/node", (req, res) => {
    const me = deviceOf(req);
    res.json({
      id: node.config.nodeId,
      name: node.config.name,
      pin: tlsPin(node.dataDir),
      policy: { device_signature: node.config.policy.approvals.deviceSignature },
      me: me ? publicDevice(me) : null,
      protocol: 2,
    });
  });

  /** Approvals with what the app shows and signs. Signing happens on-device after biometrics. */
  r.get("/v2/approvals", (req, res) => {
    const status = req.query.status ? String(req.query.status) : undefined;
    res.json(node.store.listApprovals(status as any, 50).map((a) => ({ ...a, ...node.signingInfo(a) })));
  });

  r.post("/v2/approvals/:id", async (req, res) => {
    const me = deviceOf(req);
    if (!me?.public_key) return res.status(403).json({ error: "This device can't sign decisions", code: "bad_signature" });
    const decision = req.body?.decision === "approved" ? "approved" : "denied";
    try {
      const a = await node.decide(String(req.params.id), decision, me.name, {
        device: me,
        signedAt: Number(req.body?.signed_at),
        signature: String(req.body?.signature ?? ""),
      });
      res.json(a && { ...a, ...node.signingInfo(a) });
    } catch (err) {
      sendDecisionError(res, err);
    }
  });

  r.get("/v2/devices", (req, res) => {
    const me = deviceOf(req);
    res.json(
      node.store
        .listDevices()
        .filter((d) => me && (d.id === me.id || d.parent_id === me.id))
        .map(publicDevice),
    );
  });

  /**
   * A phone enrolls its watch. The watch generated its own hardware key; the phone countersigns
   * the watch's public key with its own key (after biometrics) so the node knows the owner vouched.
   */
  r.post("/v2/devices/children", (req, res) => {
    const me = deviceOf(req);
    if (!me?.public_key || me.kind !== "phone") return res.status(403).json({ error: "Only a paired phone can enroll a watch" });
    const b = req.body ?? {};
    let child: string;
    try {
      child = normalizePublicKey(String(b.public_key ?? ""));
    } catch (err: any) {
      return res.status(400).json({ error: `Invalid public key: ${err.message}` });
    }
    const signedAt = Number(b.signed_at);
    if (!Number.isFinite(signedAt) || Math.abs(Date.now() - signedAt) > SIGNATURE_MAX_SKEW_MS) return res.status(403).json({ error: "Stale enrollment" });
    const message = enrollMessage({ nodeId: node.config.nodeId, parentId: me.id, childPublicKey: child, signedAt });
    if (!verifySignature(me.public_key, message, String(b.signature ?? ""))) return res.status(403).json({ error: "Enrollment signature does not verify" });
    const platform = b.platform === "wearos" ? "wearos" : "watchos";
    const device = node.store.addDevice(String(b.name || "Watch").slice(0, 60), {
      public_key: child,
      platform,
      kind: "watch",
      parent_id: me.id,
      hardware: !!b.hardware,
    });
    node.emit("devices");
    res.json({ ...device, node: { id: node.config.nodeId, name: node.config.name, pin: tlsPin(node.dataDir) } });
  });

  r.delete("/v2/devices/:id", (req, res) => {
    const me = deviceOf(req);
    const target = node.store.getDevice(String(req.params.id));
    if (!me || !target || (target.id !== me.id && target.parent_id !== me.id)) return res.status(404).json({ error: "Not found" });
    node.store.removeDevice(target.id);
    node.emit("devices");
    res.json({ ok: true });
  });

  /** Registers (or clears) the opaque push-gateway ticket for this device. The node never sees APNs/FCM tokens. */
  r.post("/v2/push", (req, res) => {
    const me = deviceOf(req);
    if (!me) return res.status(403).json({ error: "Not a device" });
    const ticket = req.body?.ticket ? String(req.body.ticket).slice(0, 2048) : null;
    node.store.setPushTicket(me.id, ticket);
    res.json({ ok: true });
  });

  r.get("/deliveries", (_req, res) => res.json(node.store.listDeliveries()));
  r.post("/deliveries/:id/seen", (req, res) => {
    node.store.markDeliverySeen(String(req.params.id));
    res.json({ ok: true });
  });

  r.post("/push", (req, res) => {
    const sub = req.body?.subscription;
    if (!sub?.endpoint) return res.status(400).json({ error: "Missing subscription" });
    node.store.savePushSub((req as any).device.id, sub);
    res.json({ ok: true });
  });

  r.get("/upcoming", (_req, res) => {
    const rows = node.vault.queryDates(
      {
        keys: ["expires_on", "renew_by"],
        after: new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10),
        before: new Date(Date.now() + 180 * 86400_000).toISOString().slice(0, 10),
        limit: 20,
      },
      ["*"],
    );
    res.json(
      rows.map((u) => ({ key: u.key, date: u.date, path: u.file.vpath, title: u.file.meta?.title ?? u.file.name, subject: u.file.meta?.subject ?? null })),
    );
  });

  /** Capture: a photo or PDF from the phone lands in the inbox folder, ready for an agent to file. */
  r.post("/capture", express.raw({ type: "*/*", limit: "25mb" }), async (req, res) => {
    const inbox = node.inboxRoot();
    if (!inbox) return res.status(400).json({ error: "No roots configured" });
    const original = String(req.headers["x-filename"] ?? "capture.jpg")
      .replace(/[/\\]/g, "_")
      .slice(0, 120);
    const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
    const rel = `${inbox.folder}/${stamp} ${original}`;
    const vpath = `${inbox.root}/${rel}`;
    const abs = node.absPath(vpath);
    await mkdir(path.dirname(abs), { recursive: true });
    if (existsSync(abs)) return res.status(409).json({ error: "Exists" });
    await writeFile(abs, req.body as Buffer);
    await node.vault.indexPath(vpath);
    const note = String(req.headers["x-note"] ?? "").slice(0, 500);
    if (note) await node.vault.setMetadata(vpath, { notes: note }, { actor: `owner (${(req as any).device.name})` });
    node.emit("index");
    res.json({ path: vpath });
  });

  return r;
}
