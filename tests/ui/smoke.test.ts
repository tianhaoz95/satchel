// Browser smoke tests: every page of the node admin UI, the phone PWA and the web app must render
// without uncaught errors. Needs `npx playwright install chromium` and a built web app (apps/web/dist).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdtempSync, statSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { startNode, type RunningNode } from "../../packages/node/src/index.ts";

const root = path.join(import.meta.dirname, "..", "..");
const webDist = path.join(root, "apps", "web", "dist");
let browser: Browser;
let running: RunningNode;
let nodeUrl: string;
let nodeUrlLocalhost: string;
let webServer: http.Server;
let webUrl: string;
let deviceToken: string;

before(async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "satchel-ui-"));
  const out = execFileSync(process.execPath, [path.join(root, "scripts", "demo-seed.ts"), dir], { env: { ...process.env, SATCHEL_PORT: "0" } }).toString();
  const seed = JSON.parse(out.slice(out.indexOf("{")));
  deviceToken = seed.device_token;
  running = await startNode(seed.data, { log: () => {} });
  nodeUrl = `http://127.0.0.1:${(running.servers.http.address() as any).port}`;
  nodeUrlLocalhost = nodeUrl.replace("127.0.0.1", "localhost");

  assert.ok(existsSync(path.join(webDist, "index.html")), "build the web app first: pnpm build:web");
  webServer = http.createServer((req, res) => {
    const p = path.join(webDist, decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname));
    const file = p.startsWith(webDist) && existsSync(p) && statSync(p).isFile() ? p : path.join(webDist, "index.html");
    const type =
      { ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".html": "text/html" }[path.extname(file)] ?? "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    createReadStream(file).pipe(res);
  });
  await new Promise<void>((r) => webServer.listen(0, "127.0.0.1", r));
  webUrl = `http://127.0.0.1:${(webServer.address() as any).port}`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await running?.stop();
  webServer?.close();
});

/** Opens a page that fails the test on any uncaught error or console error. */
async function guardedPage(opts: Parameters<Browser["newContext"]>[0] = {}): Promise<{ page: Page; errors: string[] }> {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  return { page, errors };
}

test("node admin UI: sign in and visit every page", async () => {
  const { page, errors } = await guardedPage();
  await page.goto(`${nodeUrl}/admin/`);
  await page.fill("input[name=password]", "demo");
  await page.click("button.primary");
  await page.waitForSelector(".shell");
  for (const hash of ["overview", "records", "approvals", "connections", "journal", "activity", "conventions", "security", "phone", "settings"]) {
    await page.goto(`${nodeUrl}/admin/#${hash}`);
    await page.waitForSelector(".main h1");
  }
  await page.goto(`${nodeUrl}/admin/#approvals`);
  await page.click("[data-ok] >> nth=0");
  await page.waitForSelector(".toast");
  assert.deepEqual(errors, []);
});

test("phone companion: tabs render for a paired device", async () => {
  const { page, errors } = await guardedPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript((t) => localStorage.setItem("satchel_device", t), deviceToken);
  for (const tab of ["approvals", "inbox", "upcoming", "capture"]) {
    await page.goto(`${nodeUrl}/app/#${tab}`);
    await page.waitForSelector(".screen h1");
  }
  await page.goto(`${nodeUrl}/app/#inbox`);
  await page.waitForSelector("[data-show]");
  assert.deepEqual(errors, []);
});

test("web app: landing, docs, sign in and create a node (demo mode)", async () => {
  const { page, errors } = await guardedPage();
  await page.goto(webUrl);
  await page.waitForSelector(".hero h1");
  for (const slug of ["introduction", "quick-start", "agents", "tools", "vault-md", "security", "self-hosting", "nas", "desktop-phone"]) {
    await page.goto(`${webUrl}/docs/${slug}`);
    await page.waitForSelector(".prose h1");
  }
  await page.goto(`${webUrl}/login`);
  await page.click("text=Continue with GitHub");
  await page.waitForURL("**/portal");
  await page.fill("input[placeholder='Home NAS']", "CI node");
  await page.fill("input[placeholder='alex']", "ci-node");
  await page.click("form button[type=submit]");
  await page.waitForSelector(".setup code");
  assert.match((await page.textContent(".setup code")) ?? "", /^satchel_node_/);
  assert.deepEqual(errors, []);
});

test("node admin UI: add a passkey, sign out, sign back in with it", async () => {
  // WebAuthn relying parties must be hostnames, so this test uses localhost instead of 127.0.0.1.
  const nodeUrl = nodeUrlLocalhost;
  const { page, errors } = await guardedPage();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true },
  });
  await page.goto(`${nodeUrl}/admin/`);
  await page.fill("input[name=password]", "demo");
  await page.click("button.primary");
  await page.waitForSelector(".shell");
  await page.goto(`${nodeUrl}/admin/#security`);
  await page.fill("#pkname", "CI authenticator");
  await page.click("#addpk");
  await page.waitForSelector("text=CI authenticator");
  await page.click("#logout");
  await page.waitForSelector("#passkey");
  await page.click("#passkey");
  await page.waitForSelector(".shell");
  assert.deepEqual(errors, []);
});
