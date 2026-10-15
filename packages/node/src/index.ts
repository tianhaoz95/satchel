import { SatchelNode } from "./node.ts";
import { startServers, type RunningServers } from "./server.ts";
import { TunnelClient } from "./tunnel.ts";
import { ensureCertificate } from "./certs.ts";

export { SatchelNode } from "./node.ts";
export { createApp, startServers } from "./server.ts";
export { buildMcpServer } from "./mcp.ts";
export { createOneTimeLogin } from "./admin.ts";
export { tunnelStatus } from "./tunnel.ts";
export * from "./config.ts";

export type RunningNode = { node: SatchelNode; servers: RunningServers; tunnel: TunnelClient | null; stop: () => Promise<void> };

/** Starts everything a node runs: index + watchers, local HTTP, TLS listener, relay tunnel. */
export async function startNode(dataDir: string, opts: { log?: (msg: string) => void } = {}): Promise<RunningNode> {
  const log = opts.log ?? ((m: string) => console.log(`[satchel] ${m}`));
  const node = new SatchelNode(dataDir);
  await node.start();
  const servers = await startServers(node);
  const httpAddr = servers.http.address();
  const port = typeof httpAddr === "object" && httpAddr ? httpAddr.port : node.config.listen.port;
  log(`admin UI and local MCP on http://${node.config.listen.host}:${port} (MCP at /mcp)`);
  let tunnel: TunnelClient | null = null;
  if (node.config.relay && servers.https) {
    const tlsAddr = servers.https.address();
    tunnel = new TunnelClient({
      relay: node.config.relay,
      localTlsPort: typeof tlsAddr === "object" && tlsAddr ? tlsAddr.port : node.config.tlsPort,
      nodeName: node.config.name,
      onReady: async (host) => {
        if (host !== node.config.publicHost) {
          node.saveConfig({ publicHost: host });
          const cert = await ensureCertificate(node, { force: true });
          servers.https!.setSecureContext({ key: cert.key, cert: cert.cert });
          log(`certificate for ${host}: ${cert.issuer}`);
        }
        log(`online at https://${host}/mcp`);
      },
    });
    tunnel.start();
  }
  return {
    node,
    servers,
    tunnel,
    stop: async () => {
      tunnel?.stop();
      await servers.close();
      node.stop();
    },
  };
}
