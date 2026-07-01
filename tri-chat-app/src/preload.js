const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("triChat", {
  broadcastPrompt: (payload) => ipcRenderer.invoke("broadcast-prompt", payload),
  paneAction: (action) => ipcRenderer.invoke("pane-action", action),
  onPaneState: (callback) => {
    ipcRenderer.on("pane-state", (_event, state) => callback(state));
  }
});
