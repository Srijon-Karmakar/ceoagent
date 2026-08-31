// CommonJS on purpose (.cjs extension), regardless of the root package.json's
// "type": "module". electron-updater's CJS shape is the path of least
// friction for the main process.
const { app, BrowserWindow, dialog, Menu, shell, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

Menu.setApplicationMenu(null);

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

app.on("second-instance", () => {
  if (!focusMainWindow() && app.isReady()) createWindow();
});

let serverPort = process.env.PORT ? Number(process.env.PORT) : 3000;
let serverStarted = false;
let serverProcess = null;
let isQuitting = false;
let mainWindow = null;

function logPath() {
  return path.join(app.getPath("userData"), "electron-main.log");
}

function log(message) {
  try {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.appendFileSync(logPath(), `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // Logging must never block startup.
  }
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
  return true;
}

// Renderer asks for this once its accounts-connect polling (app.js) sees an
// OAuth connection finish in the external browser tab, so the user lands
// back on the app without having to alt-tab manually.
ipcMain.on("focus-main-window", () => focusMainWindow());

function startupHtml(message) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>CEO Agent OS</title>
    <style>
      html, body {
        height: 100%;
        margin: 0;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f7f7f4;
        color: #1f2428;
      }
      body {
        display: grid;
        place-items: center;
      }
      main {
        width: min(420px, calc(100vw - 48px));
      }
      h1 {
        margin: 0 0 10px;
        font-size: 22px;
        font-weight: 650;
      }
      p {
        margin: 0;
        color: #5d656b;
        line-height: 1.5;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>CEO Agent OS</h1>
      <p>${message}</p>
    </main>
  </body>
</html>`)}`;
}

function loadApp() {
  if (!mainWindow || mainWindow.isDestroyed() || !serverStarted) return;
  mainWindow.loadURL(`http://127.0.0.1:${serverPort}/`).catch((err) => {
    log(`Failed to load app window: ${err instanceof Error ? err.stack || err.message : String(err)}`);
  });
}

function createWindow() {
  if (focusMainWindow()) return;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "CEO Agent OS",
    backgroundColor: "#ffffff",
    show: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // OAuth connect links (Gmail, LinkedIn, etc.) open with target="_blank" —
  // Google and others block sign-in from an embedded webview like this
  // BrowserWindow, so route those out to the user's real OS browser instead
  // of letting Electron create a second in-app window for them.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  let loadAttempts = 0;
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    if (!serverStarted) return;
    if (loadAttempts++ < 20) {
      setTimeout(loadApp, 500);
      return;
    }
    dialog.showErrorBox(
      "CEO Agent OS failed to load",
      `The local app window could not connect to the server on port ${serverPort}.\n\n${errorDescription || errorCode}`,
    );
    app.quit();
  });

  mainWindow.loadURL(startupHtml("Starting the local server..."));
  loadApp();
}

function stopServerProcess() {
  if (!serverProcess || serverProcess.killed) return;
  try {
    serverProcess.kill();
  } catch (err) {
    log(`Failed to stop server process: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function startServerProcess(port) {
  const serverEntry = path.join(app.getAppPath(), "dist", "server", "index.js");

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverEntry], {
      cwd: app.getAppPath(),
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        CEO_AGENT_SERVER_CHILD: "1",
        CEO_AGENT_PARENT_PID: String(process.pid),
        CEO_AGENT_DATA_DIR: app.getPath("userData"),
        PORT: String(port),
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    serverProcess = child;
    let settled = false;
    let output = "";

    const timeout = setTimeout(() => {
      const err = new Error("The local server did not finish starting within 45 seconds.");
      err.code = "STARTUP_TIMEOUT";
      err.output = output;
      stopServerProcess();
      finish(reject, err);
    }, 45000);

    function finish(fn, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn(value);
    }

    function handleOutput(data, stream) {
      const text = data.toString();
      output += text;
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) log(`[server:${stream}] ${line}`);
      }
      const match = output.match(/CEO Agent OS running at http:\/\/localhost:(\d+)/);
      if (match) finish(resolve, Number(match[1]));
    }

    child.stdout.on("data", (data) => handleOutput(data, "stdout"));
    child.stderr.on("data", (data) => handleOutput(data, "stderr"));
    child.once("error", (err) => {
      err.output = output;
      finish(reject, err);
    });
    child.once("exit", (code, signal) => {
      if (isQuitting || settled) return;
      const err = new Error(`The local server exited before startup (code ${code ?? "none"}, signal ${signal ?? "none"}).`);
      err.code = "STARTUP_EXIT";
      err.output = output;
      finish(reject, err);
    });
  });
}

async function startServerWithFallback() {
  try {
    return await startServerProcess(serverPort);
  } catch (err) {
    const canRetryOnFreePort =
      !process.env.PORT &&
      serverPort === 3000 &&
      err?.output &&
      /EADDRINUSE|address already in use/i.test(err.output);

    if (!canRetryOnFreePort) throw err;
    log("Port 3000 is in use; retrying the local server on a free port.");
    return await startServerProcess(0);
  }
}

function setupAutoUpdate() {
  if (!app.isPackaged) return;
  const { autoUpdater } = require("electron-updater");

  autoUpdater.on("error", (err) => {
    log(`Auto-update error: ${err instanceof Error ? err.stack || err.message : String(err)}`);
  });
  autoUpdater.on("update-downloaded", () => {
    dialog
      .showMessageBox(mainWindow, {
        type: "info",
        buttons: ["Restart now", "Later"],
        title: "Update ready",
        message: "A new version of CEO Agent OS has been downloaded. Restart to apply it?",
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
  });

  autoUpdater.checkForUpdatesAndNotify();
  setInterval(() => autoUpdater.checkForUpdatesAndNotify(), 4 * 60 * 60 * 1000);
}

app.whenReady().then(async () => {
  process.env.CEO_AGENT_DATA_DIR = app.getPath("userData");
  log("Electron app starting.");
  createWindow();

  try {
    serverPort = await startServerWithFallback();
    serverStarted = true;
    log(`Server ready on port ${serverPort}.`);
    loadApp();
  } catch (err) {
    const output = err?.output ? `\n\nServer output:\n${String(err.output).slice(-2000)}` : "";
    log(`Startup failed: ${err instanceof Error ? err.stack || err.message : String(err)}${output}`);
    dialog.showErrorBox("CEO Agent OS failed to start", `${err instanceof Error ? err.message : String(err)}${output}`);
    app.quit();
    return;
  }

  setupAutoUpdate();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  isQuitting = true;
  stopServerProcess();
});
