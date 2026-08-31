// contextIsolation is on (see main.cjs's BrowserWindow webPreferences), so the
// renderer (plain web app in src/server/public) has no Node/Electron access
// by default — this exposes the one thing it needs: a way to ask the main
// process to bring the app window back to the front after an external OAuth
// tab finishes (see the accounts-connect polling in app.js).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ceoAgent", {
  focusWindow: () => ipcRenderer.send("focus-main-window"),
});
