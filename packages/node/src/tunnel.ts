import net from "node:net";
import tls from "node:tls";
import { readFileSync } from "node:fs";
import { onLines, readLine, send, PROTOCOL_VERSION } from "@satchel/core";
import type { RelayConfig } from "./config.ts";

export type TunnelState = {
  state: "off" | "connecting" | "online" | "error";
  host: string | null;
  error: string | null;
  since: number | null;
  streams: number;
};

let status: TunnelState = { state: "off", host: null, error: null, since: null, streams: 0 };
export const tunnelStatus = () => status;

/**
 * Keeps an outbound control connection to the relay (works behind NAT, no port forwarding), and
 * for each visitor opens a data connection that is spliced to the node's local TLS port.
 */
export class TunnelClient {
  readonly relay: RelayConfig;
  readonly localTlsPort: number;
  readonly nodeName: string;
  readonly onReady: (host: string) => void | Promise<void>;
  private control: net.Socket | null = null;
  private stopped = false;
  private backoff = 1000;
  private pingTimer: NodeJS.Timeout | null = null;

  constructor(opts: { relay: RelayConfig; localTlsPort: number; nodeName: string; onReady: (host: string) => void | Promise<void> }) {
    this.relay = opts.relay;
    this.localTlsPort = opts.localTlsPort;
    this.nodeName = opts.nodeName;
    this.onReady = opts.onReady;
  }

  start() {
    this.stopped = false;
    void this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.control?.destroy();
    status = { ...status, state: "off", since: null };
  }

  private dial(): Promise<net.Socket> {
    const [host, portStr] = this.relay.control.split(":");
    const port = Number(portStr || 7443);
    return new Promise((resolve, reject) => {
      const sock = this.relay.insecure
        ? net.connect({ host, port }, () => resolve(sock))
        : tls.connect({ host, port, servername: host, ca: this.relay.caFile ? readFileSync(this.relay.caFile) : undefined }, () => resolve(sock));
      sock.once("error", reject);
      sock.setKeepAlive(true, 30_000);
    });
  }

  private async connect() {
    if (this.stopped) return;
    status = { ...status, state: "connecting", error: null };
    try {
      const sock = await this.dial();
      this.control = sock;
      send(sock, { t: "hello", v: PROTOCOL_VERSION, token: this.relay.token, node: this.nodeName });
      const reply = await readLine(sock);
      if (reply.t === "error") throw new Error(reply.message);
      if (reply.t !== "ready") throw new Error("unexpected relay reply");
      sock.resume();
      this.backoff = 1000;
      status = { state: "online", host: reply.host, error: null, since: Date.now(), streams: 0 };
      await this.onReady(reply.host);
      let lastPong = Date.now();
      onLines(sock, (msg) => {
        if (msg.t === "open") void this.openStream(msg.id);
        else if (msg.t === "ping") send(sock, { t: "pong" });
        else if (msg.t === "pong") lastPong = Date.now();
      });
      this.pingTimer = setInterval(() => {
        if (Date.now() - lastPong > 75_000) sock.destroy(new Error("relay stopped answering"));
        else send(sock, { t: "ping" });
      }, 25_000);
      await new Promise<void>((resolve) => {
        sock.on("close", () => resolve());
        sock.on("error", (e) => {
          status = { ...status, error: e.message };
        });
      });
      if (this.pingTimer) clearInterval(this.pingTimer);
      if (!this.stopped) status = { ...status, state: "connecting" };
    } catch (err: any) {
      status = { ...status, state: "error", error: err.message };
    }
    if (this.stopped) return;
    const wait = this.backoff;
    this.backoff = Math.min(this.backoff * 2, 60_000);
    setTimeout(() => void this.connect(), wait + Math.random() * 500);
  }

  private async openStream(id: string) {
    try {
      const upstream = await this.dial();
      send(upstream, { t: "data", id });
      const local = net.connect({ host: "127.0.0.1", port: this.localTlsPort });
      status = { ...status, streams: status.streams + 1 };
      const done = () => {
        upstream.destroy();
        local.destroy();
      };
      local.on("close", () => {
        status = { ...status, streams: Math.max(0, status.streams - 1) };
      });
      upstream.on("error", done);
      local.on("error", done);
      upstream.pipe(local).pipe(upstream);
    } catch {
      // the relay times out the visitor on its side
    }
  }
}
