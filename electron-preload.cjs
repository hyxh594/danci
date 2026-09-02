const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("fuciDesktop", {
  loadState: () => ipcRenderer.sendSync("fuci:load-state"),
  saveState: (state) => ipcRenderer.send("fuci:save-state", JSON.stringify(state)),
  setSuperMode: (enabled, size) => ipcRenderer.send("fuci:set-super-mode", { enabled: Boolean(enabled), size: size || null }),
  hideWindow: () => ipcRenderer.send("fuci:hide-window"),
  fitToContent: (width, height) => ipcRenderer.send("fuci:fit-window", { width, height }),
  resizeStart: (edge, screenX, screenY) => ipcRenderer.send("fuci:resize-start", { edge, screenX, screenY }),
  resizeMove: (screenX, screenY) => ipcRenderer.send("fuci:resize-move", { screenX, screenY }),
  resizeEnd: () => ipcRenderer.send("fuci:resize-end"),
  onWindowResized: (callback) => ipcRenderer.on("fuci:window-resized", (_event, size) => callback(size))
});
