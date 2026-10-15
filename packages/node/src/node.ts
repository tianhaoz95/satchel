import { watch, type FSWatcher } from "node:fs";
import path from "node:path";
import webpush from "web-push";
import { maskMetadata, sensitiveKeys, Store, Vault, type Approval, type FileEntry, type Grant, type Metadata } from "@satchel/core";
import { loadConfig, saveConfig, type NodeConfig } from "./config.ts";

export type Actor = { clientId: string; clientName: string; grant: Grant };

/**
 * The running node: config + vault + store, plus the approval executor and push notifications.
 * Everything that touches files or secrets goes through here so the MCP layer, the admin UI and
 * the companion app share one set of rules.
 */
export class SatchelNode {
  readonly dataDir: string;
  config: NodeConfig;
  readonly store: Store;
  vault: Vault;
  private watchers: FSWatcher[] = [];
  private timers: NodeJS.Timeout[] = [];
  private stopped = false;
  private listeners = new Set<(event: string, data?: unknown) => void>();

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.config = loadConfig(dataDir);
    this.store = new Store(dataDir);
    this.vault = this.makeVault();
  }

  private makeVault(): Vault {
    const v = new Vault(this.config.roots, this.store, this.dataDir);
    v.sensitiveKeys = (m) => sensitiveKeys(m, this.config.policy);
    return v;
  }

  saveConfig(patch: Partial<NodeConfig>) {
    const rootsChanged = patch.roots && JSON.stringify(patch.roots) !== JSON.stringify(this.config.roots);
    this.config = { ...this.config, ...patch };
    saveConfig(this.dataDir, this.config);
    if (rootsChanged) {
      this.vault = this.makeVault();
      void this.start();
    }
  }

  async start() {
    this.stopWatching();
    await this.vault.init();
    await this.vault.scan();
    if (!this.config.vapid) {
      const keys = webpush.generateVAPIDKeys();
      this.saveConfig({ vapid: { ...keys, subject: "mailto:owner@satchel.invalid" } });
    }
    for (const r of this.config.roots) {
      try {
        let pending: NodeJS.Timeout | null = null;
        const w = watch(r.path, { recursive: true }, () => {
          if (pending) clearTimeout(pending);
          pending = setTimeout(() => {
            if (!this.stopped) void this.vault.scan().then(() => this.emit("index"), () => {});
          }, 750);
        });
        this.watchers.push(w);
      } catch {
        // Some network filesystems don't support watching; the periodic rescan covers them.
      }
    }
    this.timers.push(setInterval(() => void this.vault.scan().catch(() => {}), 5 * 60_000));
    this.timers.push(
      setInterval(() => {
        this.store.expireApprovals();
        this.store.purgeDeliveries();
      }, 60_000),
    );
  }

  private stopWatching() {
    for (const w of this.watchers) w.close();
    for (const t of this.timers) clearInterval(t);
    this.watchers = [];
    this.timers = [];
  }

  stop() {
    this.stopped = true;
    this.stopWatching();
    this.store.close();
  }

  on(fn: (event: string, data?: unknown) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(event: string, data?: unknown) {
    for (const fn of this.listeners) fn(event, data);
  }

  // ------------------------------------------------------------- views

  allowedRoots(grant: Grant): string[] {
    return grant.roots.includes("*") ? this.config.roots.map((r) => r.name) : grant.roots;
  }

  canSee(grant: Grant, vpath: string): boolean {
    const root = vpath.split("/")[0];
    return this.allowedRoots(grant).includes(root);
  }

  /** What an agent gets to see of a file: metadata masked unless the grant has `reveal`. */
  present(entry: FileEntry, grant: Grant) {
    const reveal = grant.scopes.includes("reveal");
    const masked = entry.meta && !reveal ? maskMetadata(entry.meta, this.config.policy) : null;
    return {
      path: entry.vpath,
      name: entry.name,
      size: entry.size,
      modified: new Date(entry.mtimeMs).toISOString(),
      has_text: entry.hasText,
      metadata: masked ? masked.meta : entry.meta,
      masked_fields: masked?.masked.length ? masked.masked : undefined,
    };
  }

  /**
   * Best-effort redaction of document text: every sensitive value recorded in the sidecar is
   * replaced wherever it appears. Values nobody has recorded yet can still leak; that is the
   * documented limit of this layer.
   */
  redactText(text: string, meta: Metadata | null): { text: string; redactions: number } {
    if (!meta) return { text, redactions: 0 };
    let redactions = 0;
    let out = text;
    for (const key of sensitiveKeys(meta, this.config.policy)) {
      const v = meta[key];
      if (v == null) continue;
      const value = String(v).trim();
      if (value.length < 4) continue;
      const loose = value.split("").map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s-]?");
      out = out.replace(new RegExp(loose, "gi"), () => {
        redactions++;
        return `[${key} redacted]`;
      });
    }
    return { text: out, redactions };
  }

  // ------------------------------------------------------------- approvals

  requestApproval(actor: Actor, action: string, target: string, detail: Record<string, unknown>, reason: string): Approval {
    const a = this.store.createApproval({ client_id: actor.clientId, client_name: actor.clientName, action, target, detail, reason });
    this.emit("approval", a);
    void this.push({ title: "Approval needed", body: `${actor.clientName} wants to ${describeAction(action)}`, tag: a.id, url: "/app/#approvals" });
    return a;
  }

  /** Called from the admin UI or the phone. Side-effecting actions run immediately on approval. */
  async decide(id: string, decision: "approved" | "denied", by: string): Promise<Approval | undefined> {
    const a = this.store.decideApproval(id, decision, by);
    if (!a || a.status !== "approved") {
      this.emit("approval", a);
      return a;
    }
    const actor = `${a.client_name} (approved by ${by})`;
    try {
      if (a.action === "apply_plan") {
        const plan = this.store.getPlan(String(a.detail.plan_id));
        if (!plan) throw new Error("Plan not found");
        const entries = await this.vault.applyMoves(plan.moves, actor, plan.id);
        this.store.setPlanStatus(plan.id, "applied");
        this.store.setApprovalResult(id, { applied: entries.length, journal: entries.map((e) => e.id) });
      } else if (a.action === "update_conventions") {
        await this.vault.setConventions(String(a.detail.root), String(a.detail.text), actor);
        this.store.setApprovalResult(id, { updated: true });
      } else if (a.action === "set_metadata") {
        const meta = await this.vault.setMetadata(String(a.detail.path), a.detail.fields as Metadata, { replace: !!a.detail.replace, actor });
        this.store.setApprovalResult(id, { updated: true, keys: Object.keys(meta) });
      }
    } catch (err: any) {
      this.store.setApprovalResult(id, { error: err.message }, "used");
    }
    const final = this.store.getApproval(id);
    this.emit("approval", final);
    return final;
  }

  // ------------------------------------------------------------- deliveries + push

  deliver(actor: Actor, title: string, value: string, note: string) {
    const d = this.store.addDelivery({ client_name: actor.clientName, title, value, note });
    this.emit("delivery", { id: d.id });
    void this.push({ title: "Satchel", body: `${actor.clientName} sent you ${title}`, tag: d.id, url: "/app/#inbox" });
    return d;
  }

  /** Web Push payloads are end-to-end encrypted to the device; they still never carry secret values. */
  async push(payload: { title: string; body: string; tag: string; url: string }) {
    const v = this.config.vapid;
    if (!v) return;
    for (const { endpoint, sub } of this.store.listPushSubs()) {
      try {
        await webpush.sendNotification(sub, JSON.stringify(payload), { vapidDetails: v, TTL: 3600 });
      } catch (err: any) {
        if (err.statusCode === 404 || err.statusCode === 410) this.store.removePushSub(endpoint);
      }
    }
  }

  inboxRoot(): { root: string; folder: string } | null {
    if (this.config.inbox) {
      const [root, ...rest] = this.config.inbox.split("/");
      return { root, folder: rest.join("/") || "Inbox" };
    }
    const first = this.config.roots[0];
    return first ? { root: first.name, folder: "Inbox" } : null;
  }

  absPath(vpath: string) {
    return this.vault.resolve(vpath).abs;
  }

  basename(vpath: string) {
    return path.posix.basename(vpath);
  }
}

export function describeAction(action: string): string {
  return (
    {
      reveal_field: "see a sensitive field",
      apply_plan: "reorganize files",
      update_conventions: "change VAULT.md",
      set_metadata: "edit metadata",
    }[action] ?? action
  );
}
