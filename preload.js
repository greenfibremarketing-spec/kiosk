const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("kiosk", {
  isKiosk: true,
  platform: process.platform,
  getConfig: () => ipcRenderer.invoke("get-config"),
  saveConfig: (cfg) => ipcRenderer.invoke("save-config", cfg)
});
