import type { Socket } from "node:net";

/**
 * Tunnel wire protocol between a node and a relay.
 *
 * Control connection (node -> relay, one per node):
 *   node:  {"t":"hello","v":1,"token":"<node token>","node":"<display name>"}
 *   relay: {"t":"ready","host":"alice.satchel.dev"} | {"t":"error","message":"..."}
 *   relay: {"t":"open","id":"<stream id>"}      a visitor connected to alice.satchel.dev
 *   both:  {"t":"ping"} / {"t":"pong"}
 *
 * Data connection (node -> relay, one per visitor connection):
 *   node:  {"t":"data","id":"<stream id>"}\n  followed by raw bytes in both directions.
 *
 * The relay forwards the visitor's TLS bytes untouched (it routes on the SNI in the ClientHello)
 * and the node terminates TLS, so the relay never sees plaintext.
 */
export const PROTOCOL_VERSION = 1;

export type ControlMessage =
  | { t: "hello"; v: number; token: string; node?: string }
  | { t: "ready"; host: string }
  | { t: "error"; message: string }
  | { t: "open"; id: string }
  | { t: "data"; id: string }
  | { t: "ping" }
  | { t: "pong" };

export function send(sock: Socket, msg: ControlMessage) {
  sock.write(`${JSON.stringify(msg)}\n`);
}

/** Reads one JSON line; any bytes after the newline are pushed back onto the socket. */
export function readLine(sock: Socket, maxBytes = 8192, timeoutMs = 10_000): Promise<ControlMessage> {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => done(new Error("timeout waiting for handshake")), timeoutMs);
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      const nl = buf.indexOf(10);
      if (nl === -1) {
        if (buf.length > maxBytes) done(new Error("handshake too large"));
        return;
      }
      const line = buf.subarray(0, nl).toString("utf8");
      const rest = buf.subarray(nl + 1);
      sock.pause();
      if (rest.length) sock.unshift(rest);
      try {
        done(null, JSON.parse(line));
      } catch {
        done(new Error("bad handshake"));
      }
    };
    const onErr = (e: Error) => done(e);
    const onClose = () => done(new Error("closed during handshake"));
    function done(err: Error | null, msg?: ControlMessage) {
      clearTimeout(timer);
      sock.off("data", onData);
      sock.off("error", onErr);
      sock.off("close", onClose);
      if (err) reject(err);
      else resolve(msg!);
    }
    sock.on("data", onData);
    sock.on("error", onErr);
    sock.on("close", onClose);
  });
}

/** Line-delimited JSON reader for the long-lived control connection. */
export function onLines(sock: Socket, fn: (msg: ControlMessage) => void) {
  let buf = "";
  sock.setEncoding("utf8");
  sock.on("data", (chunk: string) => {
    buf += chunk;
    for (let nl = buf.indexOf("\n"); nl !== -1; nl = buf.indexOf("\n")) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      try {
        fn(JSON.parse(line));
      } catch {
        // ignore malformed control lines
      }
    }
    if (buf.length > 65536) sock.destroy();
  });
}

/** Extracts the SNI host name from a TLS ClientHello, or null if incomplete / absent. */
export function parseSni(buf: Buffer): { host: string | null; complete: boolean } {
  // TLS record header: type(1)=22 handshake, version(2), length(2)
  if (buf.length < 5) return { host: null, complete: false };
  if (buf[0] !== 22) return { host: null, complete: true };
  const recLen = buf.readUInt16BE(3);
  if (buf.length < 5 + recLen) return { host: null, complete: false };
  let p = 5;
  if (buf[p] !== 1) return { host: null, complete: true }; // ClientHello
  p += 4; // handshake type + length
  p += 2 + 32; // client version + random
  const sidLen = buf[p];
  p += 1 + sidLen;
  const csLen = buf.readUInt16BE(p);
  p += 2 + csLen;
  const cmLen = buf[p];
  p += 1 + cmLen;
  if (p + 2 > 5 + recLen) return { host: null, complete: true };
  const extEnd = p + 2 + buf.readUInt16BE(p);
  p += 2;
  while (p + 4 <= extEnd) {
    const type = buf.readUInt16BE(p);
    const len = buf.readUInt16BE(p + 2);
    p += 4;
    if (type === 0) {
      // server_name extension: list length(2), then entries of type(1) len(2) name
      let q = p + 2;
      while (q + 3 <= p + len) {
        const nameType = buf[q];
        const nameLen = buf.readUInt16BE(q + 1);
        if (nameType === 0)
          return {
            host: buf
              .subarray(q + 3, q + 3 + nameLen)
              .toString("ascii")
              .toLowerCase(),
            complete: true,
          };
        q += 3 + nameLen;
      }
    }
    p += len;
  }
  return { host: null, complete: true };
}
