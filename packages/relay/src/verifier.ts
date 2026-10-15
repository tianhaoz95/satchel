import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

export type NodeIdentity = { subdomain: string; nodeId: string };

/** Decides which subdomain a node token may claim. The relay never learns anything else about a node. */
export interface TokenVerifier {
  verify(token: string): Promise<NodeIdentity | null>;
  reportOnline(id: NodeIdentity, online: boolean, info: { name?: string; streams?: number }): Promise<void>;
}

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/**
 * Self-hosted mode: a JSON file mapping token hashes to subdomains, e.g.
 *   { "nodes": [ { "subdomain": "home", "token_sha256": "…" } ] }
 * Generate an entry with `satchel-relay add-node <subdomain>`.
 */
export class FileVerifier implements TokenVerifier {
  readonly file: string;
  constructor(file: string) {
    this.file = file;
  }
  private load(): Array<{ subdomain: string; token_sha256: string }> {
    if (!existsSync(this.file)) return [];
    return JSON.parse(readFileSync(this.file, "utf8")).nodes ?? [];
  }
  async verify(token: string) {
    const h = hashToken(token);
    const row = this.load().find((n) => n.token_sha256 === h);
    return row ? { subdomain: row.subdomain, nodeId: row.subdomain } : null;
  }
  async reportOnline() {}
}

/**
 * Hosted mode: node tokens are created in the web portal and stored (hashed) in Supabase.
 * The relay uses the service role only to look up hashes and to flip the online flag.
 */
export class SupabaseVerifier implements TokenVerifier {
  private client: any;
  private cache = new Map<string, { id: NodeIdentity | null; until: number }>();
  constructor(client: any) {
    this.client = client;
  }
  static async create(url: string, serviceKey: string) {
    const { createClient } = await import("@supabase/supabase-js");
    return new SupabaseVerifier(createClient(url, serviceKey, { auth: { persistSession: false } }));
  }
  async verify(token: string) {
    const h = hashToken(token);
    const hit = this.cache.get(h);
    if (hit && hit.until > Date.now()) return hit.id;
    const { data, error } = await this.client.from("nodes").select("id, subdomain").eq("token_sha256", h).is("revoked_at", null).maybeSingle();
    if (error) throw new Error(error.message);
    const id = data ? { subdomain: data.subdomain as string, nodeId: data.id as string } : null;
    this.cache.set(h, { id, until: Date.now() + 60_000 });
    return id;
  }
  async reportOnline(id: NodeIdentity, online: boolean, info: { name?: string; streams?: number }) {
    await this.client
      .from("nodes")
      .update({ online, last_seen_at: new Date().toISOString(), ...(info.name ? { reported_name: info.name } : {}) })
      .eq("id", id.nodeId);
  }
}
