// Launches the Electron desktop app against a data dir and screenshots its windows.
import { _electron as electron } from "playwright";
const [dataDir, emptyDir, out = "report/mvp/site/shots"] = process.argv.slice(2);
const appDir = "apps/desktop";

async function shot(dir: string, file: string, waitFor: string) {
  const app = await electron.launch({ args: [appDir], cwd: process.cwd(), env: { ...process.env, SATCHEL_DATA_DIR: dir } });
  const win = await app.firstWindow();
  await win.waitForSelector(waitFor, { timeout: 20_000 });
  await win.waitForTimeout(800);
  await win.screenshot({ path: `${out}/${file}` });
  const title = await win.title();
  await app.close();
  return title;
}
console.log(await shot(dataDir, "desktop-app.png", ".shell"));
console.log(await shot(emptyDir, "desktop-setup.png", "#f"));
