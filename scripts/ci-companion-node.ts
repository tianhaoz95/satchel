// Starts a throwaway node for client integration tests (Swift, Kotlin): one pending high-risk
// approval and a fresh pairing code. Prints the pairing link on the first line of stdout and keeps
// running until killed.   node scripts/ci-companion-node.ts [port]
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pairingLink } from "../packages/core/src/companion.ts";
import { buildMcpServer } from "../packages/node/src/mcp.ts";
import { hashPassword, loadConfig, saveConfig, startNode } from "../packages/node/src/index.ts";

const port = Number(process.argv[2] ?? 7799);
const dir = await mkdtemp(path.join(os.tmpdir(), "satchel-ci-node-"));
await mkdir(path.join(dir, "vault", "ID"), { recursive: true });
await writeFile(path.join(dir, "vault", "ID", "passport.txt"), "Passport 567123498");
const config = loadConfig(path.join(dir, "data"));
config.name = "CI node";
config.roots = [{ name: "home", path: path.join(dir, "vault") }];
config.owner = hashPassword("ci");
config.listen = { host: process.env.SATCHEL_CI_HOST ?? "127.0.0.1", port };
config.push = { gateway: null };
saveConfig(path.join(dir, "data"), config);

const running = await startNode(path.join(dir, "data"), { log: () => {} });
const node = running.node;
await node.vault.setMetadata("home/ID/passport.txt", { doc_type: "passport", title: "Passport", passport_number: "567123498" }, { actor: "ci" });
const server: any = buildMcpServer(node, { clientId: "ci-agent", clientName: "CI agent", grant: { label: "ci", roots: ["*"], scopes: ["read"] } });
await server._registeredTools.reveal_field.handler({ path: "home/ID/passport.txt", key: "passport_number", reason: "Integration test" }, {});
const host = process.env.SATCHEL_CI_PUBLIC_HOST ?? "127.0.0.1";
console.log(
  pairingLink({ url: `http://${host}:${port}`, code: node.store.createPairingCode(), nodeId: node.config.nodeId, nodeName: node.config.name, pin: null }),
);
process.on("SIGTERM", () => void running.stop().then(() => process.exit(0)));
process.on("SIGINT", () => void running.stop().then(() => process.exit(0)));
