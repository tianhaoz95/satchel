import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("satchel", {
  chooseFolder: () => ipcRenderer.invoke("choose-folder"),
  setup: (opts: { name: string; folder: string; password: string }) => ipcRenderer.invoke("setup", opts),
});
