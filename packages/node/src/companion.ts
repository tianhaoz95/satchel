import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import express, { Router, type Request, type Response, type NextFunction } from "express";
import type { SatchelNode } from "./node.ts";
import { isAdmin } from "./admin.ts";

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

  r.get("/approvals", (_req, res) => res.json(node.store.listApprovals(undefined, 50)));
  r.post("/approvals/:id", async (req, res) => {
    const decision = req.body?.decision === "approved" ? "approved" : "denied";
    res.json(await node.decide(String(req.params.id), decision, `owner (${(req as any).device.name})`));
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
      { keys: ["expires_on", "renew_by"], after: new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10), before: new Date(Date.now() + 180 * 86400_000).toISOString().slice(0, 10), limit: 20 },
      ["*"],
    );
    res.json(rows.map((u) => ({ key: u.key, date: u.date, path: u.file.vpath, title: u.file.meta?.title ?? u.file.name, subject: u.file.meta?.subject ?? null })));
  });

  /** Capture: a photo or PDF from the phone lands in the inbox folder, ready for an agent to file. */
  r.post("/capture", express.raw({ type: "*/*", limit: "25mb" }), async (req, res) => {
    const inbox = node.inboxRoot();
    if (!inbox) return res.status(400).json({ error: "No roots configured" });
    const original = String(req.headers["x-filename"] ?? "capture.jpg").replace(/[/\\]/g, "_").slice(0, 120);
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
