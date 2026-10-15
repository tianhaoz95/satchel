// Screenshots of the node admin UI and the phone companion against a running demo node.
import { chromium } from "playwright";
const base = process.argv[2] ?? "http://127.0.0.1:7790";
const deviceToken = process.argv[3];
const out = process.argv[4] ?? "report/mvp/site/shots";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 2, colorScheme: "light" });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.error("pageerror", e.message));
await page.goto(`${base}/admin/`);
await page.fill("input[name=password]", "demo");
await page.click("button.primary");
await page.waitForSelector(".shell");
const shots: Array<[string, string, (() => Promise<void>)?]> = [
  ["overview", "admin-overview"],
  ["records", "admin-records"],
  ["approvals", "admin-approvals"],
  ["connections", "admin-connections"],
  ["journal", "admin-journal"],
  ["activity", "admin-activity"],
  ["conventions", "admin-conventions"],
  ["security", "admin-security"],
  ["phone", "admin-phone", async () => { await page.click("#pair"); await page.waitForSelector(".qr svg"); }],
  ["settings", "admin-settings"],
];
for (const [hash, name, extra] of shots) {
  await page.goto(`${base}/admin/#${hash}`);
  await page.waitForTimeout(400);
  if (extra) await extra();
  await page.screenshot({ path: `${out}/${name}.png` });
}
await page.goto(`${base}/admin/#records`);
await page.waitForTimeout(300);
await page.click("tr.click >> nth=3");
await page.waitForSelector(".drawer");
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/admin-record.png` });

const dark = await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 2, colorScheme: "dark" });
await dark.addCookies(await ctx.cookies());
const dp = await dark.newPage();
await dp.goto(`${base}/admin/#overview`);
await dp.waitForTimeout(500);
await dp.screenshot({ path: `${out}/admin-overview-dark.png` });

const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: "light" });
await phone.addInitScript((t) => localStorage.setItem("satchel_device", t), deviceToken);
const pp = await phone.newPage();
pp.on("pageerror", (e) => console.error("pageerror", e.message));
for (const tab of ["approvals", "inbox", "upcoming", "capture"]) {
  await pp.goto(`${base}/app/#${tab}`);
  await pp.waitForTimeout(500);
  if (tab === "inbox") { await pp.click("[data-show]"); }
  await pp.screenshot({ path: `${out}/phone-${tab}.png` });
}
const pair = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true });
const p2 = await pair.newPage();
await p2.goto(`${base}/app/#pair=7F3A9C21B0`);
await p2.waitForTimeout(400);
await p2.screenshot({ path: `${out}/phone-pair.png` });
await browser.close();
console.log("done");
