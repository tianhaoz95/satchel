import { existsSync } from "node:fs";
import os from "node:os";

/** Where a phone should reach this node, and whether that works away from home. */
export type PairingAddress = {
  url: string;
  /** "relay": public HTTPS address, works anywhere. "lan": home network only, plain HTTP. */
  scope: "relay" | "lan";
  /** How the LAN address was chosen, for the admin UI. */
  source: "relay" | "configured" | "request" | "mdns" | "ip" | "none";
  /** Problems that will stop a phone from reaching the node (shown before the QR code). */
  warnings: string[];
};

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost", "[::1]"]);
export const isLoopback = (host: string) => LOOPBACK.has(host.toLowerCase()) || host.startsWith("127.");

/** Private IPv4 addresses of this machine (Wi-Fi/Ethernet), most likely home networks first. */
export function lanIPv4(): string[] {
  const out: string[] = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      if (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) out.push(a.address);
    }
  }
  const rank = (ip: string) => (ip.startsWith("192.168.") ? 0 : ip.startsWith("10.") ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b));
}

/** The machine's mDNS name (macOS and most Linux desktops answer `<name>.local`). */
export function mdnsName(): string | null {
  const h = os.hostname();
  if (!h || h === "localhost") return null;
  if (h.endsWith(".local")) return h;
  return h.includes(".") ? null : `${h}.local`;
}

const inContainer = () => existsSync("/.dockerenv") || existsSync("/run/.containerenv");

/**
 * Picks the address a phone scanning the pairing QR code should use.
 *
 * With a relay that's the public HTTPS name. Without one, it must be an address on the home
 * network, never "localhost" (that would point the phone at itself). In order of preference:
 * an explicitly configured LAN URL, the address the admin page was opened with (if it isn't
 * loopback), the machine's `.local` name, then a LAN IP. Inside Docker the container's own
 * addresses aren't reachable, so only the first two apply there.
 */
export function pairingAddress(opts: {
  publicHost: string | null;
  lanUrl: string | null;
  listenHost: string;
  port: number;
  requestHost: string | undefined;
}): PairingAddress {
  if (opts.publicHost) return { url: `https://${opts.publicHost}`, scope: "relay", source: "relay", warnings: [] };
  const warnings: string[] = [];
  if (isLoopback(opts.listenHost)) {
    warnings.push(
      `This node only accepts connections from this computer (it listens on ${opts.listenHost}). Turn on "Reachable on my home network" in Settings, or connect a relay, before pairing a phone.`,
    );
  }
  const reqHost = opts.requestHost ?? "";
  const reqName = reqHost.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  let url: string | null = null;
  let source: PairingAddress["source"] = "none";
  if (opts.lanUrl) {
    url = opts.lanUrl.replace(/\/$/, "");
    source = "configured";
  } else if (reqName && !isLoopback(reqName)) {
    url = `http://${reqHost}`;
    source = "request";
  } else if (!inContainer()) {
    const name = mdnsName();
    const ip = lanIPv4()[0];
    if (name) {
      url = `http://${name}:${opts.port}`;
      source = "mdns";
    } else if (ip) {
      url = `http://${ip}:${opts.port}`;
      source = "ip";
    }
  }
  if (!url) {
    warnings.push(
      "Couldn't work out this node's address on your network. Set it under Settings → Home network address (for example http://nas.local:7710), or open this page using that address.",
    );
    url = `http://${reqHost || `localhost:${opts.port}`}`;
  }
  if (source === "ip") {
    warnings.push(
      "Using a raw IP address: Android only allows unencrypted connections to .local names, so set a .local address in Settings for Android phones.",
    );
  }
  return { url, scope: "lan", source, warnings };
}
