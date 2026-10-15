import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type NodeRow = {
  id: string;
  name: string;
  subdomain: string;
  created_at: string;
  revoked_at: string | null;
  online: boolean;
  last_seen_at: string | null;
  reported_name: string | null;
};
export type User = { id: string; email: string };

export const RELAY_CONTROL = import.meta.env.VITE_RELAY_CONTROL || "tunnel.satchel.dev:7443";
export const RELAY_DOMAIN = import.meta.env.VITE_RELAY_DOMAIN || "satchel.dev";
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const SUBDOMAIN_RE = /^[a-z0-9]([a-z0-9-]{1,30}[a-z0-9])$/;

/** Node tokens are generated in the browser; only their SHA-256 hash is ever stored. */
export async function newNodeToken(): Promise<{ token: string; hash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const token =
    "satchel_node_" +
    btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { token, hash };
}

export interface Backend {
  demo: boolean;
  user(): Promise<User | null>;
  onAuth(fn: (u: User | null) => void): () => void;
  signInWithEmail(email: string): Promise<void>;
  signInWithGitHub(): Promise<void>;
  signOut(): Promise<void>;
  listNodes(): Promise<NodeRow[]>;
  createNode(name: string, subdomain: string, tokenHash: string): Promise<NodeRow>;
  rotateToken(id: string, tokenHash: string): Promise<void>;
  revokeNode(id: string): Promise<void>;
  deleteAccount(): Promise<void>;
}

class SupabaseBackend implements Backend {
  demo = false;
  sb: SupabaseClient;
  constructor(sb: SupabaseClient) {
    this.sb = sb;
  }
  async user() {
    const { data } = await this.sb.auth.getUser();
    return data.user ? { id: data.user.id, email: data.user.email ?? "" } : null;
  }
  onAuth(fn: (u: User | null) => void) {
    const { data } = this.sb.auth.onAuthStateChange((_e, s) => fn(s?.user ? { id: s.user.id, email: s.user.email ?? "" } : null));
    return () => data.subscription.unsubscribe();
  }
  async signInWithEmail(email: string) {
    const { error } = await this.sb.auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}/portal` } });
    if (error) throw error;
  }
  async signInWithGitHub() {
    const { error } = await this.sb.auth.signInWithOAuth({ provider: "github", options: { redirectTo: `${location.origin}/portal` } });
    if (error) throw error;
  }
  async signOut() {
    await this.sb.auth.signOut();
  }
  async listNodes() {
    const { data, error } = await this.sb.from("nodes").select("id,name,subdomain,created_at,revoked_at,online,last_seen_at,reported_name").order("created_at");
    if (error) throw error;
    return data as NodeRow[];
  }
  async createNode(name: string, subdomain: string, token_sha256: string) {
    const { data, error } = await this.sb.from("nodes").insert({ name, subdomain, token_sha256 }).select().single();
    if (error) throw new Error(error.code === "23505" ? "That subdomain is taken." : error.message);
    return data as NodeRow;
  }
  async rotateToken(id: string, token_sha256: string) {
    const { error } = await this.sb.rpc("rotate_node_token", { node_id: id, new_hash: token_sha256 });
    if (error) throw error;
  }
  async revokeNode(id: string) {
    const { error } = await this.sb.from("nodes").update({ revoked_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
  }
  async deleteAccount() {
    const { error } = await this.sb.rpc("delete_my_account");
    if (error) throw error;
    await this.sb.auth.signOut();
  }
}

/** Demo mode (no Supabase configured): everything lives in this browser's localStorage. */
class DemoBackend implements Backend {
  demo = true;
  private fns = new Set<(u: User | null) => void>();
  private read<T>(k: string, d: T): T {
    try {
      return JSON.parse(localStorage.getItem(k) ?? "null") ?? d;
    } catch {
      return d;
    }
  }
  private write(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  }
  async user() {
    return this.read<User | null>("demo_user", null);
  }
  onAuth(fn: (u: User | null) => void) {
    this.fns.add(fn);
    return () => void this.fns.delete(fn);
  }
  private emit(u: User | null) {
    for (const f of this.fns) f(u);
  }
  async signInWithEmail(email: string) {
    const u = { id: "demo", email };
    this.write("demo_user", u);
    this.emit(u);
  }
  async signInWithGitHub() {
    return this.signInWithEmail("you@example.com");
  }
  async signOut() {
    localStorage.removeItem("demo_user");
    this.emit(null);
  }
  async listNodes() {
    return this.read<NodeRow[]>("demo_nodes", []);
  }
  async createNode(name: string, subdomain: string) {
    const nodes = await this.listNodes();
    if (nodes.some((n) => n.subdomain === subdomain) || ["www", "relay", "tunnel", "api", "app"].includes(subdomain))
      throw new Error("That subdomain is taken.");
    const row: NodeRow = {
      id: crypto.randomUUID(),
      name,
      subdomain,
      created_at: new Date().toISOString(),
      revoked_at: null,
      online: false,
      last_seen_at: null,
      reported_name: null,
    };
    this.write("demo_nodes", [...nodes, row]);
    return row;
  }
  async rotateToken() {}
  async revokeNode(id: string) {
    this.write(
      "demo_nodes",
      (await this.listNodes()).map((n) => (n.id === id ? { ...n, revoked_at: new Date().toISOString(), online: false } : n)),
    );
  }
  async deleteAccount() {
    localStorage.removeItem("demo_nodes");
    await this.signOut();
  }
}

export const backend: Backend = url && anon ? new SupabaseBackend(createClient(url, anon)) : new DemoBackend();
