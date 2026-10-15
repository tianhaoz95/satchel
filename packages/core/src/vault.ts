import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Journal } from "./journal.ts";
import { dateFields, isSidecar, readSidecar, removeSidecar, sidecarPath, writeSidecar } from "./sidecar.ts";
import { mergeMetadata } from "./mask.ts";
import { DEFAULT_CONVENTIONS } from "./conventions.ts";
import type { Store } from "./store.ts";
import type { FileEntry, JournalEntry, Metadata, RootConfig } from "./types.ts";

const TEXT_EXT = new Set([".txt", ".md", ".markdown", ".csv", ".json", ".yaml", ".yml", ".eml", ".html", ".htm"]);
const MAX_TEXT = 200_000;

export class VaultError extends Error {}

export type SearchFilters = {
  doc_type?: string;
  subject?: string;
  path_prefix?: string;
  has_metadata?: boolean;
  limit?: number;
};

export type Move = { from: string; to: string };

export class Vault {
  readonly roots: RootConfig[];
  readonly store: Store;
  readonly textDir: string;
  private journals = new Map<string, Journal>();
  private scanning: Promise<void> | null = null;
  /** Keys whose values must stay out of the search index (set by the node from its security policy). */
  sensitiveKeys: (meta: Metadata) => Set<string> = (m) => new Set((m.sensitive as string[] | undefined) ?? []);

  constructor(roots: RootConfig[], store: Store, dataDir: string) {
    this.roots = roots;
    this.store = store;
    this.textDir = path.join(dataDir, "text");
    for (const r of roots) {
      if (!/^[a-z0-9][a-z0-9_-]*$/i.test(r.name)) throw new VaultError(`Invalid root name "${r.name}"`);
      this.journals.set(r.name, new Journal(r.path));
    }
  }

  // ---------------------------------------------------------------- paths

  root(name: string): RootConfig {
    const r = this.roots.find((x) => x.name === name);
    if (!r) throw new VaultError(`Unknown root "${name}"`);
    return r;
  }

  /** Resolves "<root>/<rel>" to an absolute path, refusing anything that escapes the root. */
  resolve(vpath: string): { root: RootConfig; rel: string; abs: string } {
    const clean = vpath.replace(/\\/g, "/").replace(/^\/+/, "");
    const [rootName, ...rest] = clean.split("/");
    const root = this.root(rootName);
    const rel = path.posix.normalize(rest.join("/"));
    if (rel.startsWith("..") || path.posix.isAbsolute(rel)) throw new VaultError(`Path escapes root: ${vpath}`);
    if (rel.split("/").some((seg) => seg === ".satchel" || isSidecar(seg))) throw new VaultError(`Reserved path: ${vpath}`);
    const abs = path.join(root.path, rel);
    if (!abs.startsWith(path.resolve(root.path))) throw new VaultError(`Path escapes root: ${vpath}`);
    return { root, rel: rel === "." ? "" : rel, abs };
  }

  journal(rootName: string): Journal {
    return this.journals.get(rootName)!;
  }

  // ---------------------------------------------------------------- indexing

  async init(): Promise<void> {
    for (const r of this.roots) {
      await mkdir(r.path, { recursive: true });
      const conv = path.join(r.path, "VAULT.md");
      if (!existsSync(conv)) await writeFile(conv, DEFAULT_CONVENTIONS, "utf8");
    }
    await mkdir(this.textDir, { recursive: true });
  }

  /** Full rescan. Unchanged files (same size + mtime) are not re-hashed. */
  scan(): Promise<void> {
    if (!this.scanning) {
      this.scanning = this.doScan().finally(() => {
        this.scanning = null;
      });
    }
    return this.scanning;
  }

  private async doScan(): Promise<void> {
    const seen = new Set<string>();
    for (const r of this.roots) {
      for await (const abs of walk(r.path)) {
        const rel = path.relative(r.path, abs).split(path.sep).join("/");
        const vpath = `${r.name}/${rel}`;
        seen.add(vpath);
        await this.indexFile(r, rel, abs);
      }
    }
    const all = this.store.db.prepare("select vpath from files").all() as Array<{ vpath: string }>;
    for (const { vpath } of all) if (!seen.has(vpath)) this.unindex(vpath);
    this.store.set("last_scan_at", String(Date.now()));
  }

  async indexPath(vpath: string): Promise<void> {
    const { root, rel, abs } = this.resolve(vpath);
    if (existsSync(abs)) await this.indexFile(root, rel, abs);
    else this.unindex(vpath);
  }

  private unindex(vpath: string) {
    const db = this.store.db;
    db.prepare("delete from files where vpath = ?").run(vpath);
    db.prepare("delete from dates where vpath = ?").run(vpath);
    db.prepare("delete from fts where vpath = ?").run(vpath);
  }

  private async indexFile(root: RootConfig, rel: string, abs: string, force = false): Promise<void> {
    const st = await stat(abs);
    const vpath = `${root.name}/${rel}`;
    const db = this.store.db;
    const prev = db.prepare("select size, mtime_ms, sha256 from files where vpath = ?").get(vpath) as any;
    const meta = await readSidecar(abs);
    const metaJson = meta ? JSON.stringify(meta) : null;
    const unchanged = prev && prev.size === st.size && prev.mtime_ms === st.mtimeMs;
    const sha = unchanged ? prev.sha256 : await hashFile(abs);
    const text = await this.extractText(abs, sha);
    if (unchanged && !force) {
      const cur = db.prepare("select meta, has_text from files where vpath = ?").get(vpath) as any;
      if (cur.meta === metaJson && cur.has_text === (text ? 1 : 0)) return;
    }
    db.prepare(
      `insert into files(vpath, root, rel, name, size, mtime_ms, sha256, meta, has_text, indexed_at)
       values(?,?,?,?,?,?,?,?,?,?)
       on conflict(vpath) do update set size=excluded.size, mtime_ms=excluded.mtime_ms, sha256=excluded.sha256,
       meta=excluded.meta, has_text=excluded.has_text, indexed_at=excluded.indexed_at`,
    ).run(vpath, root.name, rel, path.basename(rel), st.size, st.mtimeMs, sha, metaJson, text ? 1 : 0, Date.now());
    db.prepare("delete from dates where vpath = ?").run(vpath);
    if (meta) for (const d of dateFields(meta)) db.prepare("insert into dates(vpath, key, value) values(?,?,?)").run(vpath, d.key, d.value);
    db.prepare("delete from fts where vpath = ?").run(vpath);
    db.prepare("insert into fts(vpath, name, meta, body) values(?,?,?,?)").run(
      vpath,
      rel.replace(/[/_.-]/g, " "),
      meta ? flattenForSearch(meta, this.sensitiveKeys(meta)) : "",
      text ? text.slice(0, MAX_TEXT) : "",
    );
  }

  // ---------------------------------------------------------------- text

  private textCachePath(sha: string) {
    return path.join(this.textDir, `${sha}.txt`);
  }

  /** Text for search and `read_file`: plain text files directly, PDFs via unpdf, images via helper OCR cache. */
  async extractText(abs: string, sha: string): Promise<string | null> {
    const cached = this.textCachePath(sha);
    if (existsSync(cached)) return readFile(cached, "utf8");
    const ext = path.extname(abs).toLowerCase();
    let text: string | null = null;
    if (TEXT_EXT.has(ext)) {
      text = (await readFile(abs, "utf8")).slice(0, MAX_TEXT);
    } else if (ext === ".pdf") {
      try {
        const { extractText, getDocumentProxy } = await import("unpdf");
        const pdf = await getDocumentProxy(new Uint8Array(await readFile(abs)));
        const res = await extractText(pdf, { mergePages: true });
        text = String(res.text).trim() || null;
      } catch {
        text = null;
      }
    }
    if (text) await writeFile(cached, text, "utf8");
    return text;
  }

  /** Helpers (desktop OCR, phone capture) store extracted text for files Satchel can't read itself. */
  async putText(vpath: string, text: string): Promise<void> {
    const entry = this.get(vpath);
    if (!entry) throw new VaultError(`Not found: ${vpath}`);
    await writeFile(this.textCachePath(entry.sha256), text, "utf8");
    const { root, rel, abs } = this.resolve(vpath);
    await this.indexFile(root, rel, abs, true);
  }

  async readText(vpath: string, maxChars = 20_000): Promise<{ text: string | null; truncated: boolean }> {
    const entry = this.get(vpath);
    if (!entry) throw new VaultError(`Not found: ${vpath}`);
    const { abs } = this.resolve(vpath);
    const text = await this.extractText(abs, entry.sha256);
    if (!text) return { text: null, truncated: false };
    return { text: text.slice(0, maxChars), truncated: text.length > maxChars };
  }

  // ---------------------------------------------------------------- queries

  get(vpath: string): FileEntry | undefined {
    const row = this.store.db.prepare("select * from files where vpath = ?").get(vpath) as any;
    return row ? rowToEntry(row) : undefined;
  }

  search(query: string, filters: SearchFilters, allowedRoots: string[]): FileEntry[] {
    const limit = Math.min(filters.limit ?? 20, 100);
    const words = query.match(/[\p{L}\p{N}]+/gu) ?? [];
    const params: any[] = [];
    let sql: string;
    if (words.length) {
      const match = words.map((w) => `"${w}"*`).join(" ");
      sql = "select f.* from fts join files f on f.vpath = fts.vpath where fts match ?";
      params.push(match);
    } else {
      sql = "select f.* from files f where 1=1";
    }
    sql += rootClause(allowedRoots, params);
    if (filters.path_prefix) {
      sql += " and f.vpath like ? escape '\\'";
      params.push(escapeLike(filters.path_prefix) + "%");
    }
    if (filters.has_metadata !== undefined) sql += filters.has_metadata ? " and f.meta is not null" : " and f.meta is null";
    if (filters.doc_type) {
      sql += " and json_extract(f.meta, '$.doc_type') = ?";
      params.push(filters.doc_type);
    }
    if (filters.subject) {
      sql += " and lower(json_extract(f.meta, '$.subject')) = lower(?)";
      params.push(filters.subject);
    }
    sql += words.length ? " order by rank limit ?" : " order by f.vpath limit ?";
    params.push(limit);
    return (this.store.db.prepare(sql).all(...params) as any[]).map(rowToEntry);
  }

  /** Generic date query over indexed `*_on` / `*_date` / `*_by` keys. */
  queryDates(opts: { keys: string[]; before?: string; after?: string; limit?: number }, allowedRoots: string[]) {
    const params: any[] = [...opts.keys];
    let sql = `select d.key, d.value, f.* from dates d join files f on f.vpath = d.vpath where d.key in (${opts.keys.map(() => "?").join(",")})`;
    if (opts.before) {
      sql += " and d.value <= ?";
      params.push(opts.before);
    }
    if (opts.after) {
      sql += " and d.value >= ?";
      params.push(opts.after);
    }
    sql += rootClause(allowedRoots, params);
    sql += " order by d.value limit ?";
    params.push(Math.min(opts.limit ?? 50, 200));
    return (this.store.db.prepare(sql).all(...params) as any[]).map((r) => ({ key: r.key as string, date: r.value as string, file: rowToEntry(r) }));
  }

  listUnprocessed(allowedRoots: string[], limit = 50): FileEntry[] {
    const params: any[] = [];
    let sql = "select f.* from files f where (f.meta is null or json_extract(f.meta, '$.doc_type') is null)";
    sql += rootClause(allowedRoots, params);
    sql += " order by f.indexed_at desc limit ?";
    params.push(limit);
    return (this.store.db.prepare(sql).all(...params) as any[]).map(rowToEntry);
  }

  stats(allowedRoots: string[]) {
    const params: any[] = [];
    const where = "where 1=1" + rootClause(allowedRoots, params);
    const row = this.store.db
      .prepare(`select count(*) as files, sum(case when meta is not null then 1 else 0 end) as with_meta, sum(has_text) as with_text from files f ${where}`)
      .get(...params) as any;
    return { files: row.files ?? 0, with_metadata: row.with_meta ?? 0, with_text: row.with_text ?? 0 };
  }

  tree(allowedRoots: string[]): Record<string, number> {
    const params: any[] = [];
    const rows = this.store.db.prepare(`select rel, root from files f where 1=1 ${rootClause(allowedRoots, params)}`).all(...params) as any[];
    const dirs: Record<string, number> = {};
    for (const r of rows) {
      const dir = `${r.root}/${path.posix.dirname(r.rel)}`.replace(/\/\.$/, "");
      dirs[dir] = (dirs[dir] ?? 0) + 1;
    }
    return dirs;
  }

  // ---------------------------------------------------------------- writes

  async setMetadata(vpath: string, patch: Metadata, opts: { replace?: boolean; actor: string }): Promise<Metadata> {
    const { root, abs } = this.resolve(vpath);
    if (!existsSync(abs)) throw new VaultError(`Not found: ${vpath}`);
    const before = await readSidecar(abs);
    const after = mergeMetadata(before, patch, !!opts.replace);
    await writeSidecar(abs, after);
    await this.journal(root.name).append({ kind: "metadata", actor: opts.actor, to: vpath, before, after });
    await this.indexPath(vpath);
    return after;
  }

  async getConventions(rootName: string): Promise<string> {
    const r = this.root(rootName);
    try {
      return await readFile(path.join(r.path, "VAULT.md"), "utf8");
    } catch {
      return "";
    }
  }

  async setConventions(rootName: string, text: string, actor: string): Promise<void> {
    const r = this.root(rootName);
    const before = await this.getConventions(rootName);
    await writeFile(path.join(r.path, "VAULT.md"), text, "utf8");
    await this.journal(rootName).append({ kind: "conventions", actor, before, after: text });
  }

  /** Checks a set of moves without touching disk. Returns human-readable problems. */
  validateMoves(moves: Move[]): string[] {
    const problems: string[] = [];
    const targets = new Set<string>();
    for (const m of moves) {
      try {
        const from = this.resolve(m.from);
        const to = this.resolve(m.to);
        if (from.root.name !== to.root.name) problems.push(`${m.from}: moves across roots are not supported`);
        if (!existsSync(from.abs)) problems.push(`${m.from}: source does not exist`);
        if (existsSync(to.abs)) problems.push(`${m.to}: destination already exists`);
        if (targets.has(m.to)) problems.push(`${m.to}: two moves target the same path`);
        if (!to.rel || to.rel.endsWith("/")) problems.push(`${m.to}: destination must be a file path`);
        targets.add(m.to);
      } catch (err: any) {
        problems.push(err.message);
      }
    }
    return problems;
  }

  /** Applies moves (file + sidecar), journaling each so it can be undone. */
  async applyMoves(moves: Move[], actor: string, planId?: string): Promise<JournalEntry[]> {
    const problems = this.validateMoves(moves);
    if (problems.length) throw new VaultError(problems.join("; "));
    const done: JournalEntry[] = [];
    for (const m of moves) done.push(await this.moveOne(m.from, m.to, actor, planId));
    return done;
  }

  private async moveOne(fromV: string, toV: string, actor: string, planId?: string, undoes?: string): Promise<JournalEntry> {
    const from = this.resolve(fromV);
    const to = this.resolve(toV);
    const sha = await hashFile(from.abs);
    await mkdir(path.dirname(to.abs), { recursive: true });
    await rename(from.abs, to.abs);
    if (existsSync(sidecarPath(from.abs))) await rename(sidecarPath(from.abs), sidecarPath(to.abs));
    const entry = await this.journal(from.root.name).append({
      kind: undoes ? "undo" : "move",
      actor,
      from: fromV,
      to: toV,
      sha256: sha,
      plan: planId,
      undoes,
    });
    await this.indexPath(fromV);
    await this.indexPath(toV);
    return entry;
  }

  async journalEntries(allowedRoots: string[], limit = 200): Promise<Array<JournalEntry & { root: string; undone: boolean }>> {
    const out: Array<JournalEntry & { root: string; undone: boolean }> = [];
    for (const r of this.roots) {
      if (!allowedRoots.includes("*") && !allowedRoots.includes(r.name)) continue;
      const j = this.journal(r.name);
      const undone = await j.undone();
      for (const e of await j.list()) out.push({ ...e, root: r.name, undone: undone.has(e.id) });
    }
    return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  }

  /** Reverses a move or metadata change. Refuses if the file changed since (hash mismatch). */
  async undo(entryId: string, actor: string): Promise<JournalEntry> {
    for (const r of this.roots) {
      const j = this.journal(r.name);
      const entry = (await j.list()).find((e) => e.id === entryId);
      if (!entry) continue;
      if ((await j.undone()).has(entryId)) throw new VaultError("Already undone");
      if (entry.kind === "move") {
        const cur = this.resolve(entry.to!);
        if (!existsSync(cur.abs)) throw new VaultError(`${entry.to} no longer exists`);
        if ((await hashFile(cur.abs)) !== entry.sha256) throw new VaultError(`${entry.to} was modified after the move; undo it by hand`);
        if (existsSync(this.resolve(entry.from!).abs)) throw new VaultError(`${entry.from} is occupied again`);
        return this.moveOne(entry.to!, entry.from!, actor, undefined, entry.id);
      }
      if (entry.kind === "metadata") {
        const { abs } = this.resolve(entry.to!);
        if (entry.before) await writeSidecar(abs, entry.before as Metadata);
        else await removeSidecar(abs);
        await this.indexPath(entry.to!);
        return j.append({ kind: "undo", actor, to: entry.to, undoes: entry.id });
      }
      if (entry.kind === "conventions") {
        await writeFile(path.join(r.path, "VAULT.md"), String(entry.before ?? ""), "utf8");
        return j.append({ kind: "undo", actor, undoes: entry.id });
      }
      throw new VaultError("This entry cannot be undone");
    }
    throw new VaultError(`Journal entry not found: ${entryId}`);
  }
}

// ------------------------------------------------------------------ helpers

async function* walk(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "@eaDir" || e.name === "#recycle") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.isFile() && e.name !== "VAULT.md") yield full;
  }
}

export function hashFile(abs: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(abs)
      .on("data", (c) => h.update(c))
      .on("end", () => resolve(h.digest("hex")))
      .on("error", reject);
  });
}

function rowToEntry(r: any): FileEntry {
  return {
    vpath: r.vpath,
    root: r.root,
    rel: r.rel,
    name: r.name,
    size: r.size,
    mtimeMs: r.mtime_ms,
    sha256: r.sha256,
    meta: r.meta ? JSON.parse(r.meta) : null,
    hasText: !!r.has_text,
  };
}

function rootClause(allowedRoots: string[], params: any[]): string {
  if (allowedRoots.includes("*")) return "";
  if (!allowedRoots.length) return " and 0";
  params.push(...allowedRoots);
  return ` and f.root in (${allowedRoots.map(() => "?").join(",")})`;
}

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => "\\" + c);
}

function flattenForSearch(meta: Metadata, hidden: Set<string>): string {
  return Object.entries(meta)
    .filter(([k]) => k !== "sensitive" && !hidden.has(k))
    .map(([k, v]) => `${k.replace(/_/g, " ")} ${Array.isArray(v) ? v.join(" ") : typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" ");
}
