#!/usr/bin/env node
import { parseArgs } from "node:util";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { defaultDataDir, hashPassword, loadConfig, saveConfig } from "./config.ts";
import { SatchelNode } from "./node.ts";
import { buildMcpServer } from "./mcp.ts";
import { startNode } from "./index.ts";

const HELP = `satchel – your records, readable by any AI agent, carried by you.

Usage:
  satchel init --root home=~/Documents/Records [--root nas=/Volumes/NAS/Records] [--name "My Mac"] [--password ...]
  satchel serve                         run the node (admin UI, MCP, relay tunnel)
  satchel connect --relay HOST:PORT --token NODE_TOKEN [--insecure] [--api URL]
  satchel token --label "Claude Code" [--scopes read,write,organize] [--roots home]
  satchel stdio --token PAT             MCP over stdio (for clients that launch a command)
  satchel status

Options:
  --data DIR    data directory (default: ${defaultDataDir()}, or $SATCHEL_DATA_DIR)
`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      data: { type: "string" },
      root: { type: "string", multiple: true },
      name: { type: "string" },
      password: { type: "string" },
      relay: { type: "string" },
      token: { type: "string" },
      api: { type: "string" },
      insecure: { type: "boolean" },
      label: { type: "string" },
      scopes: { type: "string" },
      roots: { type: "string" },
      port: { type: "string" },
      host: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const cmd = positionals[0];
  const dataDir = path.resolve(values.data ?? defaultDataDir());
  if (!cmd || values.help) return void process.stdout.write(HELP);

  if (cmd === "init") {
    const config = loadConfig(dataDir);
    if (values.root?.length) {
      config.roots = values.root.map((spec) => {
        const i = spec.indexOf("=");
        if (i < 1) throw new Error(`--root expects name=path, got "${spec}"`);
        const p = spec.slice(i + 1).replace(/^~(?=$|\/)/, process.env.HOME ?? "~");
        return { name: spec.slice(0, i), path: path.resolve(p) };
      });
    }
    if (values.name) config.name = values.name;
    if (values.port) config.listen.port = Number(values.port);
    if (values.host) config.listen.host = values.host;
    const password = values.password ?? process.env.SATCHEL_PASSWORD ?? (config.owner ? null : await ask("Owner password: "));
    if (password) config.owner = hashPassword(password);
    if (!config.roots.length) throw new Error("Add at least one --root name=path");
    saveConfig(dataDir, config);
    const node = new SatchelNode(dataDir);
    await node.vault.init();
    await node.vault.scan();
    const stats = node.vault.stats(["*"]);
    node.stop();
    console.log(
      `Initialized ${dataDir}\nRoots: ${config.roots.map((r) => `${r.name} → ${r.path}`).join(", ")}\nIndexed ${stats.files} files. Run "satchel serve" next.`,
    );
    return;
  }

  if (cmd === "connect") {
    if (!values.relay || !values.token) throw new Error("satchel connect --relay HOST:PORT --token NODE_TOKEN");
    const config = loadConfig(dataDir);
    config.relay = { control: values.relay, token: values.token, insecure: !!values.insecure, api: values.api };
    config.publicHost = null;
    saveConfig(dataDir, config);
    console.log(`Relay set to ${values.relay}. Restart "satchel serve" to connect.`);
    return;
  }

  if (cmd === "token") {
    const node = new SatchelNode(dataDir);
    const scopes = Array.from(
      new Set([
        "read",
        ...(values.scopes ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      ]),
    );
    const roots = values.roots ? values.roots.split(",").map((s) => s.trim()) : ["*"];
    const token = node.store.issueToken("pat", "pat", { label: values.label ?? "Personal token", roots, scopes }, null);
    node.stop();
    console.log(token);
    return;
  }

  if (cmd === "stdio") {
    const token = values.token ?? process.env.SATCHEL_TOKEN;
    if (!token) throw new Error("satchel stdio needs --token (create one with `satchel token`)");
    const node = new SatchelNode(dataDir);
    await node.start();
    const row = node.store.findToken(token);
    if (row?.kind !== "pat") throw new Error("Invalid token");
    const server = buildMcpServer(node, { clientId: `pat:${row.hash}`, clientName: row.label, grant: row.grant });
    await server.connect(new StdioServerTransport());
    return;
  }

  if (cmd === "status") {
    const node = new SatchelNode(dataDir);
    const c = node.config;
    console.log(
      JSON.stringify(
        {
          dataDir,
          name: c.name,
          roots: c.roots,
          local: `http://${c.listen.host}:${c.listen.port}`,
          relay: c.relay?.control ?? null,
          publicHost: c.publicHost,
          ...node.vault.stats(["*"]),
        },
        null,
        2,
      ),
    );
    node.stop();
    return;
  }

  if (cmd === "serve") {
    const config = loadConfig(dataDir);
    if (!config.roots.length || !config.owner) throw new Error(`Not initialized. Run: satchel init --root home=~/Records --data ${dataDir}`);
    const running = await startNode(dataDir);
    const shutdown = async () => {
      await running.stop();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    return;
  }

  process.stdout.write(HELP);
  process.exitCode = 1;
}

async function ask(q: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question(q);
  rl.close();
  return a;
}

main().catch((err) => {
  console.error(`satchel: ${err.message}`);
  process.exit(1);
});
