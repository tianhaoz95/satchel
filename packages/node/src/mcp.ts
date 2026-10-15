import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { maskValue, sensitiveKeys, VaultError, type Grant } from "@satchel/core";
import type { Actor, SatchelNode } from "./node.ts";

const VERSION = "0.1.0";

const INSTRUCTIONS = `Satchel is the owner's personal records vault (IDs, vehicle papers, insurance, prescriptions...).
Start by calling get_conventions: VAULT.md holds the owner's naming rules and reminder habits.
Sensitive identifiers are masked. Prefer deliver_to_user when the owner only needs to read a value.
Actions that need the owner's approval return a request_id: tell the owner, then call check_approval.`;

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}
function fail(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Builds an MCP server bound to one caller. Every tool checks the caller's grant (roots + scopes)
 * and writes an audit row, including which sensitive fields (if any) were disclosed.
 */
export function buildMcpServer(node: SatchelNode, actor: Actor): McpServer {
  const server = new McpServer({ name: "satchel", version: VERSION }, { instructions: INSTRUCTIONS });
  const grant: Grant = actor.grant;
  const roots = () => node.allowedRoots(grant);
  const has = (scope: string) => grant.scopes.includes(scope);

  const tool = <S extends z.ZodRawShape>(
    name: string,
    def: { title: string; description: string; input: S; scope: string; readOnly?: boolean },
    fn: (args: z.objectOutputType<S, z.ZodTypeAny>, audit: { revealed: string[] }) => Promise<ToolResult>,
  ) => {
    server.registerTool(
      name,
      { title: def.title, description: def.description, inputSchema: def.input, annotations: { readOnlyHint: !!def.readOnly, openWorldHint: false } },
      (async (args: any) => {
        const audit = { revealed: [] as string[] };
        let result: ToolResult;
        if (!has(def.scope)) {
          result = fail(`This connection was not granted the "${def.scope}" permission. The owner can change it in the Satchel app.`);
        } else {
          try {
            result = await fn(args, audit);
          } catch (err: any) {
            result = fail(err instanceof VaultError ? err.message : `Error: ${err.message}`);
          }
        }
        node.store.audit({
          client_id: actor.clientId,
          client_name: actor.clientName,
          tool: name,
          args: summarizeArgs(args),
          revealed: audit.revealed,
          outcome: result.isError ? "error" : "ok",
        });
        node.emit("audit");
        return result;
      }) as any,
    );
  };

  const visible = (vpath: string) => {
    if (!node.canSee(grant, vpath)) throw new VaultError(`Not found: ${vpath}`);
    const entry = node.vault.get(vpath);
    if (!entry) throw new VaultError(`Not found: ${vpath}`);
    return entry;
  };

  tool(
    "vault_status",
    {
      title: "Vault status",
      description: "Overview of the vault: roots you can see, file counts, how many files still lack metadata, and when any agent last checked in.",
      input: {},
      scope: "read",
      readOnly: true,
    },
    async () => {
      const last = node.store.get("last_agent_query_at");
      const lastScan = node.store.get("last_scan_at");
      return ok({
        node: node.config.name,
        roots: node.config.roots.filter((r) => roots().includes(r.name)).map((r) => r.name),
        ...node.vault.stats(roots()),
        last_agent_activity: last ? new Date(Number(last)).toISOString() : null,
        last_index_scan: lastScan ? new Date(Number(lastScan)).toISOString() : null,
        today: new Date().toISOString().slice(0, 10),
        your_permissions: grant.scopes,
      });
    },
  );

  tool(
    "get_conventions",
    {
      title: "Read VAULT.md",
      description: "Returns VAULT.md for each visible root: the owner's instructions for naming, folder layout, metadata keys and reminders. Read this first.",
      input: { root: z.string().optional().describe("Only this root") },
      scope: "read",
      readOnly: true,
    },
    async ({ root }) => {
      const names = root ? [root].filter((r) => roots().includes(r)) : roots();
      const parts = [];
      for (const n of names) parts.push(`<!-- root: ${n} -->\n${await node.vault.getConventions(n)}`);
      return ok(parts.join("\n\n") || "No conventions found.");
    },
  );

  tool(
    "browse",
    {
      title: "Browse folders",
      description: "Lists folders with file counts, optionally under a path prefix such as 'home/Vehicles'.",
      input: { prefix: z.string().optional() },
      scope: "read",
      readOnly: true,
    },
    async ({ prefix }) => {
      const tree = node.vault.tree(roots());
      const rows = Object.entries(tree)
        .filter(([d]) => !prefix || d.startsWith(prefix))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([dir, files]) => ({ dir, files }));
      return ok(rows);
    },
  );

  tool(
    "search",
    {
      title: "Search records",
      description: "Full-text search over file names, metadata and extracted document text. Filters narrow by doc_type, subject or folder. Empty query lists files.",
      input: {
        query: z.string().default(""),
        doc_type: z.string().optional(),
        subject: z.string().optional(),
        path_prefix: z.string().optional(),
        has_metadata: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).default(20),
      },
      scope: "read",
      readOnly: true,
    },
    async (args) => {
      const results = node.vault.search(args.query, args, roots());
      return ok({ count: results.length, results: results.map((e) => node.present(e, grant)) });
    },
  );

  tool(
    "list_expiring",
    {
      title: "List expiring records",
      description:
        "Records whose expires_on / renew_by date (or other date keys you name) falls within the next N days. Also includes recently lapsed ones. Pure date query: deciding what deserves a reminder is up to you and VAULT.md.",
      input: {
        within_days: z.number().int().min(1).max(3650).default(90),
        include_past_days: z.number().int().min(0).max(3650).default(30),
        keys: z.array(z.string()).default(["expires_on", "renew_by"]),
      },
      scope: "read",
      readOnly: true,
    },
    async ({ within_days, include_past_days, keys }) => {
      const day = 86400_000;
      const before = new Date(Date.now() + within_days * day).toISOString().slice(0, 10);
      const after = new Date(Date.now() - include_past_days * day).toISOString().slice(0, 10);
      const today = new Date().toISOString().slice(0, 10);
      const rows = node.vault.queryDates({ keys, before, after }, roots());
      return ok({
        today,
        window: { from: after, to: before },
        items: rows.map((r) => ({
          date_key: r.key,
          date: r.date,
          days_left: Math.round((Date.parse(r.date) - Date.parse(today)) / day),
          ...node.present(r.file, grant),
        })),
      });
    },
  );

  tool(
    "query_dates",
    {
      title: "Query by date",
      description: "Generic date-range query over any date-like metadata key (keys ending in _on, _date or _by).",
      input: { keys: z.array(z.string()).min(1), before: z.string().optional(), after: z.string().optional(), limit: z.number().int().max(200).default(50) },
      scope: "read",
      readOnly: true,
    },
    async (args) => {
      const rows = node.vault.queryDates(args, roots());
      return ok(rows.map((r) => ({ date_key: r.key, date: r.date, ...node.present(r.file, grant) })));
    },
  );

  tool(
    "get_record",
    {
      title: "Get record",
      description: "Metadata and file info for one path. Sensitive fields are masked unless this connection has the reveal permission.",
      input: { path: z.string() },
      scope: "read",
      readOnly: true,
    },
    async ({ path }, audit) => {
      const entry = visible(path);
      const view = node.present(entry, grant);
      if (has("reveal") && entry.meta) audit.revealed.push(...[...sensitiveKeys(entry.meta, node.config.policy)].map((k) => `${path}#${k}`));
      return ok(view);
    },
  );

  tool(
    "read_file",
    {
      title: "Read file text",
      description: "Extracted text of a document (text files, PDFs, or OCR text added by a Satchel helper). Known sensitive values are redacted unless this connection has the reveal permission.",
      input: { path: z.string(), max_chars: z.number().int().min(100).max(100_000).default(20_000) },
      scope: "read",
      readOnly: true,
    },
    async ({ path, max_chars }, audit) => {
      const entry = visible(path);
      const { text, truncated } = await node.vault.readText(path, max_chars);
      if (!text) return ok({ path, text: null, note: "No text available yet. A Satchel helper (desktop app) can OCR images and scans." });
      if (has("reveal")) {
        audit.revealed.push(`${path}#text`);
        return ok({ path, truncated, text });
      }
      const red = node.redactText(text, entry.meta);
      return ok({ path, truncated, redactions: red.redactions, text: red.text });
    },
  );

  tool(
    "list_unprocessed",
    {
      title: "List files without metadata",
      description: "Files that have no metadata yet. Read them, then call set_metadata, so the vault stays searchable.",
      input: { limit: z.number().int().min(1).max(200).default(50) },
      scope: "read",
      readOnly: true,
    },
    async ({ limit }) => ok(node.vault.listUnprocessed(roots(), limit).map((e) => ({ path: e.vpath, size: e.size, has_text: e.hasText }))),
  );

  tool(
    "set_metadata",
    {
      title: "Set metadata",
      description:
        "Writes metadata into the file's sidecar (merged by default; a null value deletes a key). Well-known keys: doc_type, subject, title, issued_on, expires_on, renew_by, tags, notes, sensitive (list of keys to mask; can only grow). Dates as YYYY-MM-DD.",
      input: { path: z.string(), fields: z.record(z.any()), replace: z.boolean().default(false), reason: z.string().default("") },
      scope: "write",
    },
    async ({ path, fields, replace, reason }) => {
      visible(path);
      if (node.config.policy.approvals.metadata === "always") {
        const a = node.requestApproval(actor, "set_metadata", path, { path, fields, replace }, reason);
        return ok(pending(a.id));
      }
      const meta = await node.vault.setMetadata(path, fields, { replace, actor: actor.clientName });
      return ok({ path, saved_keys: Object.keys(meta) });
    },
  );

  tool(
    "propose_reorganization",
    {
      title: "Propose renames/moves",
      description:
        "Proposes a batch of moves/renames (paths include the root, e.g. 'home/Scans/img_001.pdf' -> 'home/Vehicles/2019 Honda Civic/Registration/2026-03 Registration (exp 2027-03).pdf'). Sidecars move with their files. The owner approves the whole plan; every move is journaled and can be undone.",
      input: {
        moves: z.array(z.object({ from: z.string(), to: z.string() })).min(1).max(500),
        reason: z.string().default(""),
      },
      scope: "organize",
    },
    async ({ moves, reason }) => {
      for (const m of moves) if (!node.canSee(grant, m.from) || !node.canSee(grant, m.to)) throw new VaultError(`Not found: ${m.from}`);
      const problems = node.vault.validateMoves(moves);
      if (problems.length) return fail(`Plan rejected:\n- ${problems.join("\n- ")}`);
      const planId = node.store.savePlan(actor.clientId, moves);
      if (node.config.policy.approvals.organize === "never") {
        const entries = await node.vault.applyMoves(moves, actor.clientName, planId);
        node.store.setPlanStatus(planId, "applied");
        return ok({ applied: entries.length });
      }
      const a = node.requestApproval(actor, "apply_plan", `${moves.length} file(s)`, { plan_id: planId, moves }, reason);
      return ok(pending(a.id));
    },
  );

  tool(
    "propose_conventions",
    {
      title: "Propose VAULT.md change",
      description: "Proposes a new full text for a root's VAULT.md. The owner reviews and approves it.",
      input: { root: z.string(), text: z.string().min(1), reason: z.string().default("") },
      scope: "organize",
    },
    async ({ root, text, reason }) => {
      if (!roots().includes(root)) throw new VaultError(`Unknown root "${root}"`);
      if (node.config.policy.approvals.conventions === "never") {
        await node.vault.setConventions(root, text, actor.clientName);
        return ok({ updated: true });
      }
      const a = node.requestApproval(actor, "update_conventions", `${root}/VAULT.md`, { root, text }, reason);
      return ok(pending(a.id));
    },
  );

  tool(
    "reveal_field",
    {
      title: "Reveal a sensitive field",
      description:
        "Asks the owner to approve showing you one unmasked sensitive value. Only use this when you must use the value yourself (e.g. to fill a form). If the owner just needs to read it, use deliver_to_user instead.",
      input: { path: z.string(), key: z.string(), reason: z.string().min(3) },
      scope: "read",
    },
    async ({ path, key, reason }, audit) => {
      const entry = visible(path);
      if (!entry.meta || entry.meta[key] == null) throw new VaultError(`No field "${key}" on ${path}`);
      if (has("reveal") || node.config.policy.approvals.reveal === "never") {
        audit.revealed.push(`${path}#${key}`);
        return ok({ path, key, value: entry.meta[key] });
      }
      const a = node.requestApproval(actor, "reveal_field", `${path}#${key}`, { path, key, preview: maskValue(entry.meta[key]) }, reason);
      return ok(pending(a.id));
    },
  );

  tool(
    "deliver_to_user",
    {
      title: "Send a value to the owner",
      description:
        "Sends a field's real value straight to the owner's phone or desktop app. You never see the value. Use this when the owner asks for a number they need to read or type somewhere.",
      input: { path: z.string(), key: z.string(), note: z.string().default("") },
      scope: "read",
    },
    async ({ path, key, note }) => {
      const entry = visible(path);
      if (!entry.meta || entry.meta[key] == null) throw new VaultError(`No field "${key}" on ${path}`);
      const title = `${entry.meta.title ?? entry.name}: ${key.replace(/_/g, " ")}`;
      node.deliver(actor, title, String(entry.meta[key]), note);
      return ok({ delivered: true, to: "owner's Satchel app", note: "The value was not included in this response." });
    },
  );

  tool(
    "check_approval",
    {
      title: "Check an approval",
      description: "Checks a pending approval. Once approved, returns the outcome (for reveal_field, the value; it can be picked up once).",
      input: { request_id: z.string() },
      scope: "read",
      readOnly: true,
    },
    async ({ request_id }, audit) => {
      const a = node.store.getApproval(request_id);
      if (!a || a.client_id !== actor.clientId) throw new VaultError("Unknown request_id");
      if (a.status === "pending") return ok({ status: "pending", message: "Still waiting for the owner. Ask them to check the Satchel app or their phone." });
      if (a.status === "denied" || a.status === "expired") return ok({ status: a.status });
      if (a.action === "reveal_field") {
        if (a.status === "used") return ok({ status: "used", message: "This value was already picked up. Ask again if you need it." });
        const entry = visible(String(a.detail.path));
        const key = String(a.detail.key);
        audit.revealed.push(`${a.detail.path}#${key}`);
        node.store.setApprovalResult(a.id, { picked_up: true }, "used");
        return ok({ status: "approved", path: a.detail.path, key, value: entry.meta?.[key] ?? null });
      }
      return ok({ status: a.status, result: a.result });
    },
  );

  tool(
    "list_journal",
    {
      title: "List recent changes",
      description: "The journal of moves, metadata edits and VAULT.md changes, newest first. Each entry can be undone.",
      input: { limit: z.number().int().min(1).max(500).default(50) },
      scope: "read",
      readOnly: true,
    },
    async ({ limit }) => {
      const entries = await node.vault.journalEntries(roots(), limit);
      return ok(entries.map(({ before, after, ...e }) => e));
    },
  );

  tool(
    "undo",
    {
      title: "Undo a change",
      description: "Reverses one journal entry (a move, a metadata edit, or a VAULT.md change). Refuses if the file changed since.",
      input: { entry_id: z.string() },
      scope: "organize",
    },
    async ({ entry_id }) => {
      const entry = await node.vault.undo(entry_id, actor.clientName);
      return ok({ undone: entry_id, journal_entry: entry.id });
    },
  );

  return server;
}

function pending(id: string) {
  return {
    status: "pending_approval",
    request_id: id,
    message: "The owner must approve this in the Satchel app or on their phone. Tell them, then call check_approval with this request_id.",
  };
}

/** Audit rows keep argument shapes, not bulk content (a VAULT.md body or a 500-move plan). */
function summarizeArgs(args: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "string") out[k] = v.length > 200 ? `${v.slice(0, 200)}… (${v.length} chars)` : v;
    else if (Array.isArray(v)) out[k] = v.length > 5 ? `[${v.length} items]` : v;
    else out[k] = v;
  }
  return out;
}
