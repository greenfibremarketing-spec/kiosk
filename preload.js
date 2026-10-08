const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("kiosk", {
  isKiosk: true,
  platform: process.platform,
  getConfig: () => ipcRenderer.invoke("get-config"),
  saveConfig: (cfg) => ipcRenderer.invoke("save-config", cfg),
  onSpeechHypothesis: (callback) => {
    const handler = (_e, text) => callback(text);
    ipcRenderer.on("stt-hypothesis", handler);
    return () => ipcRenderer.removeListener("stt-hypothesis", handler);
  },
  onSpeechFinal: (callback) => {
    const handler = (_e, text) => callback(text);
    ipcRenderer.on("stt-final", handler);
    return () => ipcRenderer.removeListener("stt-final", handler);
  },
  setSpeechMuted: (muted) => ipcRenderer.send("stt-mute", muted),
  sendPresenceState: (state) => ipcRenderer.send("presence-state", state),
});
