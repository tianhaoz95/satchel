import { app, BrowserWindow, Menu, Notification, Tray, dialog, ipcMain, nativeImage, shell } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import { createOneTimeLogin, defaultDataDir, hashPassword, loadConfig, saveConfig, startNode, tunnelStatus, type RunningNode } from "@satchel/node";
import { Helpers } from "./helpers.ts";

const dataDir = process.env.SATCHEL_DATA_DIR ?? defaultDataDir();
const resources = app.isPackaged ? process.resourcesPath : path.join(import.meta.dirname, "..");
process.env.SATCHEL_UI_DIR ??= app.isPackaged
  ? path.join(process.resourcesPath, "ui")
  : path.join(import.meta.dirname, "..", "..", "..", "packages", "node", "ui");

let running: RunningNode | null = null;
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let helpers: Helpers | null = null;

const ICON = nativeImage
  .createFromDataURL(
    "data:image/svg+xml;base64," +
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect x="3" y="7" width="26" height="20" rx="4" fill="black"/><rect x="11" y="4" width="10" height="6" rx="2" fill="none" stroke="black" stroke-width="2"/></svg>',
      ).toString("base64"),
  )
  .resize({ width: 18, height: 18 });
ICON.setTemplateImage(true);

function localUrl() {
  const addr = running?.servers.http.address();
  const port = typeof addr === "object" && addr ? addr.port : 7710;
  // "localhost" rather than 127.0.0.1: passkeys (WebAuthn) need a hostname.
  return `http://localhost:${port}`;
}

async function openAdmin(hash = "overview") {
  if (!running) return showSetup();
  if (!win || win.isDestroyed()) {
    win = new BrowserWindow({
      width: 1240,
      height: 820,
      minWidth: 720,
      title: "Satchel",
      backgroundColor: "#fafaf9",
      webPreferences: { contextIsolation: true },
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url);
      return { action: "deny" };
    });
  }
  // A one-time login token: the desktop app signs in without retyping the owner password.
  await win.loadURL(`${localUrl()}/admin/?login=${createOneTimeLogin()}#${hash}`);
  win.show();
}

function showSetup() {
  win = new BrowserWindow({
    width: 560,
    height: 640,
    resizable: false,
    title: "Set up Satchel",
    backgroundColor: "#fafaf9",
    webPreferences: { preload: path.join(import.meta.dirname, "preload.cjs"), contextIsolation: true },
  });
  void win.loadFile(path.join(import.meta.dirname, "..", "assets", "setup.html"));
}

ipcMain.handle("choose-folder", async () => {
  const res = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
    message: "Choose the folder that holds (or will hold) your records",
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle("setup", async (_e, opts: { name: string; folder: string; password: string }) => {
  const config = loadConfig(dataDir);
  config.name = opts.name || config.name;
  config.roots = [{ name: "home", path: opts.folder }];
  config.owner = hashPassword(opts.password);
  saveConfig(dataDir, config);
  await boot();
  await openAdmin();
  return true;
});

function refreshTray() {
  if (!tray || !running) return;
  const pending = running.node.store.listApprovals("pending").length;
  const t = tunnelStatus();
  tray.setTitle(pending ? ` ${pending}` : "");
  tray.setToolTip(`Satchel: ${t.state === "online" ? `online at ${t.host}` : "local only"}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Satchel · ${running.node.config.name}`, enabled: false },
      { label: t.state === "online" ? `Online: ${t.host}` : t.state === "off" ? "Local only" : `Relay: ${t.state}`, enabled: false },
      { type: "separator" },
      { label: "Open Satchel", click: () => void openAdmin() },
      { label: pending ? `Approvals (${pending})` : "Approvals", click: () => void openAdmin("approvals") },
      { label: "Open folder", click: () => void shell.openPath(running!.node.config.roots[0].path) },
      { type: "separator" },
      { label: "Quit Satchel", click: () => app.quit() },
    ]),
  );
}

async function boot() {
  running = await startNode(dataDir);
  helpers = new Helpers(running.node, resources);
  running.node.on((event, data: any) => {
    refreshTray();
    if (event === "approval" && data?.status === "pending" && Notification.isSupported()) {
      const n = new Notification({ title: "Satchel: approval needed", body: `${data.client_name} wants to ${data.action.replace(/_/g, " ")}` });
      n.on("click", () => void openAdmin("approvals"));
      n.show();
    }
    if (event === "index") void helpers?.tick();
  });
  setInterval(() => void helpers?.tick(), 60_000);
  setInterval(refreshTray, 10_000);
  void helpers.tick();
  refreshTray();
}

app.whenReady().then(async () => {
  if (process.platform === "darwin") app.dock?.hide();
  tray = new Tray(ICON);
  const config = loadConfig(dataDir);
  if (config.roots.length && config.owner && existsSync(config.roots[0].path)) {
    await boot();
    if (!process.argv.includes("--hidden")) await openAdmin();
  } else {
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Set up Satchel…", click: showSetup },
        { label: "Quit", click: () => app.quit() },
      ]),
    );
    showSetup();
  }
});

app.on("window-all-closed", () => {
  // Keep running in the tray: the node serves agents even with no window open.
});
app.on("before-quit", () => void running?.stop());
