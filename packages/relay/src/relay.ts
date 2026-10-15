import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";
import { randomBytes } from "node:crypto";
import { onLines, parseSni, readLine, send, PROTOCOL_VERSION } from "@satchel/core";
import type { NodeIdentity, TokenVerifier } from "./verifier.ts";
import type { DnsProvider } from "./dns.ts";

export type RelayOptions = {
  /** Base domain; nodes are reachable at <subdomain>.<domain>. */
  domain: string;
  /** Hostname of the relay's own API (served on the public port, routed by SNI), e.g. relay.satchel.dev. */
  apiHost: string;
  publicPort: number;
  controlPort: number;
  host?: string;
  /** TLS for the control channel and the relay's own API. Omit for plain-TCP local development. */
  tls?: { key: string | Buffer; cert: string | Buffer };
  verifier: TokenVerifier;
  dns?: DnsProvider;
  maxStreamsPerNode?: number;
  log?: (msg: string) => void;
};

type Session = { id: NodeIdentity; control: net.Socket; name: string; streams: number; bytesIn: number; bytesOut: number; since: number };
type Pending = { visitor: net.Socket; head: Buffer; session: Session; timer: NodeJS.Timeout };

/**
 * A multi-tenant TLS passthrough relay.
 *
 * Visitors (AI agents' MCP clients) connect to https://<sub>.<domain>. The relay reads only the
 * SNI field of the TLS ClientHello, asks that node (over its outbound control connection) to open
 * a data connection, then splices the two sockets. TLS terminates on the node: the relay forwards
 * ciphertext and cannot read or alter requests.
 */
export class Relay {
  readonly opts: RelayOptions;
  readonly sessions = new Map<string, Session>();
  private pending = new Map<string, Pending>();
  private publicServer: net.Server | null = null;
  private controlServer: net.Server | null = null;
  private apiServer: http.Server | https.Server | null = null;
  private log: (m: string) => void;

  constructor(opts: RelayOptions) {
    this.opts = opts;
    this.log = opts.log ?? ((m) => console.log(`[relay] ${m}`));
  }

  async start() {
    const api = (req: http.IncomingMessage, res: http.ServerResponse) => void this.handleApi(req, res);
    this.apiServer = this.opts.tls ? https.createServer({ key: this.opts.tls.key, cert: this.opts.tls.cert }, api) : http.createServer(api);

    this.publicServer = net.createServer((sock) => this.onVisitor(sock));
    this.controlServer = this.opts.tls
      ? tls.createServer({ key: this.opts.tls.key, cert: this.opts.tls.cert }, (sock) => void this.onControl(sock))
      : net.createServer((sock) => void this.onControl(sock));
    const host = this.opts.host ?? "0.0.0.0";
    await new Promise<void>((r) => this.publicServer!.listen(this.opts.publicPort, host, r));
    await new Promise<void>((r) => this.controlServer!.listen(this.opts.controlPort, host, r));
    this.log(`public :${this.address(this.publicServer)} control :${this.address(this.controlServer)} domain *.${this.opts.domain}`);
  }

  address(s: net.Server | null) {
    const a = s?.address();
    return typeof a === "object" && a ? a.port : 0;
  }
  get publicPort() {
    return this.address(this.publicServer);
  }
  get controlPort() {
    return this.address(this.controlServer);
  }

  async stop() {
    for (const s of this.sessions.values()) s.control.destroy();
    for (const p of this.pending.values()) p.visitor.destroy();
    await Promise.all([this.publicServer, this.controlServer].map((s) => new Promise((r) => (s ? s.close(r) : r(null)))));
    this.apiServer?.close();
  }

  // ------------------------------------------------------------- visitors

  private onVisitor(sock: net.Socket) {
    let head = Buffer.alloc(0);
    const timer = setTimeout(() => sock.destroy(), 10_000);
    sock.on("error", () => {});
    const onData = (chunk: Buffer) => {
      head = Buffer.concat([head, chunk]);
      const { host, complete } = parseSni(head);
      if (!complete && head.length < 16_384) return;
      sock.off("data", onData);
      clearTimeout(timer);
      sock.pause();
      if (!host) return sock.destroy();
      if (host === this.opts.apiHost) {
        sock.unshift(head);
        this.apiServer!.emit("connection", sock);
        sock.resume();
        return;
      }
      const suffix = `.${this.opts.domain}`;
      const sub = host.endsWith(suffix) ? host.slice(0, -suffix.length) : null;
      const session = sub ? this.sessions.get(sub) : undefined;
      if (!session) return sock.destroy();
      if (session.streams >= (this.opts.maxStreamsPerNode ?? 64)) return sock.destroy();
      const id = randomBytes(16).toString("hex");
      const t = setTimeout(() => {
        this.pending.delete(id);
        sock.destroy();
      }, 10_000);
      this.pending.set(id, { visitor: sock, head, session, timer: t });
      send(session.control, { t: "open", id });
    };
    sock.on("data", onData);
  }

  // ------------------------------------------------------------- nodes

  private async onControl(sock: net.Socket) {
    sock.on("error", () => {});
    let first;
    try {
      first = await readLine(sock);
    } catch {
      return sock.destroy();
    }
    if (first.t === "data") return this.onData(sock, first.id);
    if (first.t !== "hello") return sock.destroy();
    if (first.v !== PROTOCOL_VERSION) {
      send(sock, { t: "error", message: `Unsupported protocol version ${first.v}` });
      return sock.end();
    }
    let id: NodeIdentity | null = null;
    try {
      id = await this.opts.verifier.verify(first.token);
    } catch (err: any) {
      this.log(`verify failed: ${err.message}`);
    }
    if (!id) {
      send(sock, { t: "error", message: "Unknown or revoked node token" });
      return sock.end();
    }
    const previous = this.sessions.get(id.subdomain);
    if (previous) previous.control.destroy();
    const session: Session = { id, control: sock, name: String(first.node ?? ""), streams: 0, bytesIn: 0, bytesOut: 0, since: Date.now() };
    this.sessions.set(id.subdomain, session);
    sock.setKeepAlive(true, 30_000);
    sock.resume();
    send(sock, { t: "ready", host: `${id.subdomain}.${this.opts.domain}` });
    this.log(`node online: ${id.subdomain}`);
    void this.opts.verifier.reportOnline(id, true, { name: session.name }).catch(() => {});
    let lastSeen = Date.now();
    onLines(sock, (msg) => {
      lastSeen = Date.now();
      if (msg.t === "ping") send(sock, { t: "pong" });
    });
    const ping = setInterval(() => {
      if (Date.now() - lastSeen > 90_000) sock.destroy();
      else send(sock, { t: "ping" });
    }, 30_000);
    sock.on("close", () => {
      clearInterval(ping);
      if (this.sessions.get(id!.subdomain) === session) {
        this.sessions.delete(id!.subdomain);
        this.log(`node offline: ${id!.subdomain}`);
        void this.opts.verifier.reportOnline(id!, false, {}).catch(() => {});
      }
    });
  }

  private onData(sock: net.Socket, id: string) {
    const p = this.pending.get(id);
    if (!p) return sock.destroy();
    this.pending.delete(id);
    clearTimeout(p.timer);
    const s = p.session;
    s.streams++;
    sock.write(p.head);
    // Count bytes for quotas/abuse limits; content is TLS ciphertext and is never inspected.
    p.visitor.on("data", (c: Buffer) => (s.bytesIn += c.length));
    sock.on("data", (c: Buffer) => (s.bytesOut += c.length));
    const close = () => {
      p.visitor.destroy();
      sock.destroy();
    };
    p.visitor.on("close", close);
    sock.on("close", () => {
      close();
      s.streams = Math.max(0, s.streams - 1);
    });
    sock.on("error", close);
    p.visitor.pipe(sock).pipe(p.visitor);
    p.visitor.resume();
  }

  // ------------------------------------------------------------- relay API

  private async handleApi(req: http.IncomingMessage, res: http.ServerResponse) {
    const json = (code: number, body: unknown) => {
      res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url ?? "/", "http://relay");
    if (url.pathname === "/healthz") return json(200, { ok: true });
    if (url.pathname === "/v1/status") return json(200, { domain: this.opts.domain, nodes_online: this.sessions.size, protocol: PROTOCOL_VERSION });
    if (url.pathname === "/v1/acme/txt" && (req.method === "POST" || req.method === "DELETE")) {
      if (!this.opts.dns) return json(501, { error: "This relay has no DNS automation; use a self-signed or your own certificate." });
      const token = String(req.headers.authorization ?? "").replace(/^Bearer /, "");
      const id = token ? await this.opts.verifier.verify(token).catch(() => null) : null;
      if (!id) return json(401, { error: "Unknown node token" });
      const body = await readBody(req);
      const value = String(JSON.parse(body || "{}").value ?? "");
      if (!/^[A-Za-z0-9_-]{20,100}$/.test(value)) return json(400, { error: "Bad value" });
      const name = `_acme-challenge.${id.subdomain}.${this.opts.domain}`;
      if (req.method === "POST") await this.opts.dns.setTxt(name, value);
      else await this.opts.dns.removeTxt(name, value);
      return json(200, { ok: true, name });
    }
    json(404, { error: "Not found" });
  }
}

function readBody(req: http.IncomingMessage, max = 4096): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (c) => {
      data += c;
      if (data.length > max) req.destroy(new Error("too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
