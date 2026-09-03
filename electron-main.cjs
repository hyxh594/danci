const { app, BrowserWindow, Tray, Menu, globalShortcut, nativeImage, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const { pathToFileURL } = require("node:url");

// Keep exactly one source of truth for both development and packaged builds.
// The user requested D:\\danci as the single storage directory, so the
// executable location and code updates can never create another profile.
const desktopDataDir = "D:\\danci";
fsSync.mkdirSync(desktopDataDir, { recursive: true });
const runtimeDataDir = path.join(desktopDataDir, ".desktop-runtime");
app.setPath("userData", runtimeDataDir);
const statePath = path.join(desktopDataDir, "fuci-cet6-state.json");
const backupPath = path.join(desktopDataDir, "fuci-cet6-backup-latest.json");
const stateTempPath = `${statePath}.tmp`;
const backupTempPath = `${backupPath}.tmp`;
let stateWriteQueue = Promise.resolve();

function isValidPersistedState(parsed) {
  return Boolean(
    parsed &&
    Array.isArray(parsed.words) &&
    parsed.words.length &&
    parsed.progress && typeof parsed.progress === "object" && !Array.isArray(parsed.progress) &&
    Array.isArray(parsed.history) &&
    parsed.settings && typeof parsed.settings === "object"
  );
}

function readPersistedState() {
  for (const candidate of [statePath, backupPath, stateTempPath, backupTempPath]) {
    try {
      const raw = fsSync.readFileSync(candidate, "utf8");
      const parsed = JSON.parse(raw);
      if (isValidPersistedState(parsed)) return parsed;
    } catch {
      // Try the next known file. A partial write can safely fall back to the
      // rolling backup or a completed temporary file.
    }
  }
  return null;
}

async function writeFileSafely(targetPath, temporaryPath, serialized) {
  await fs.writeFile(temporaryPath, serialized, "utf8");
  try {
    await fs.rename(temporaryPath, targetPath);
  } catch (error) {
    // Windows may reject rename when the destination exists. The temporary
    // file is still complete, so copy it over and clean up afterwards.
    if (!['EEXIST', 'EPERM', 'ENOTEMPTY'].includes(error?.code)) throw error;
    await fs.copyFile(temporaryPath, targetPath);
    await fs.unlink(temporaryPath).catch(() => {});
  }
}

function queuePersistedState(state) {
  if (!state || typeof state !== "object") return;
  stateWriteQueue = stateWriteQueue
    .catch(() => {})
    .then(async () => {
      const timestamp = new Date().toISOString();
      const serialized = JSON.stringify({ ...state, savedAt: timestamp, exportedAt: timestamp }, null, 2);
      await writeFileSafely(statePath, stateTempPath, serialized);
      await writeFileSafely(backupPath, backupTempPath, serialized);
    })
    .catch((error) => console.error("自动备份失败:", error.message));
}

let mainWindow;
let tray;
let superMode = true;
let activeResize;

const limitsForMode = () => superMode
  ? { minWidth: 220, minHeight: 176, maxWidth: 1000, maxHeight: 1000 }
  : { minWidth: 300, minHeight: 400, maxWidth: 1000, maxHeight: 1000 };

function resizeWindowForMode(enabled, preferredSize) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  superMode = Boolean(enabled);

  // Super mode is a separate mini card. The renderer fills the window, while
  // the resize handles below still allow the user to choose another size.
  if (enabled) {
    mainWindow.setMinimumSize(220, 176);
    mainWindow.setMaximumSize(1000, 1000);
    mainWindow.setResizable(true);
    const width = Number(preferredSize?.width);
    const height = Number(preferredSize?.height);
    setWindowSize(Number.isFinite(width) ? width : 320, Number.isFinite(height) ? height : 190);
  } else {
    mainWindow.setMinimumSize(300, 400);
    mainWindow.setMaximumSize(1000, 1000);
    mainWindow.setResizable(true);
    setWindowSize(360, 560);
  }
}

function setWindowSize(width, height) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const bounds = mainWindow.getBounds();
  const next = { x: bounds.x, y: bounds.y, width: Math.round(width), height: Math.round(height) };
  // setBounds is reliable for frameless Windows windows and preserves the
  // current position while changing only the card dimensions.
  mainWindow.setBounds(next, false);
}

function createWindow() {
  const preloadPath = path.join(__dirname, "electron-preload.cjs");
  mainWindow = new BrowserWindow({
    width: 320,
    height: 190,
    useContentSize: true,
    minWidth: 220,
    minHeight: 176,
    maxWidth: 1000,
    maxHeight: 1000,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    show: true,
    backgroundColor: "#f6f7fb",
    preload: preloadPath,
    // This is a local file-only desktop app. Keep the preload bridge on the
    // page's world so the persistence API is available across Electron 44
    // portable/dev launches as well as packaged launches.
    webPreferences: { contextIsolation: false, nodeIntegration: true, sandbox: false, spellcheck: false }
  });
  // Explicitly show on launch as the app may be started from a hidden tray
  // process on Windows.
  mainWindow.showInactive();
  mainWindow.setTitle("浮词 · CET-6");
  mainWindow.once("ready-to-show", () => showWindow());
  // The mode is persisted in the renderer. Read it once after load so a
  // relaunch never reuses the old tall normal-mode window dimensions.
  mainWindow.webContents.once("did-finish-load", () => {
    const settings = readPersistedState()?.settings || {};
    resizeWindowForMode(Boolean(settings.superMode), settings.superSize || null);
    showWindow();
  });
  mainWindow.loadURL(pathToFileURL(path.join(__dirname, "index.html")).toString()).catch((error) => console.error("加载桌面页面失败:", error.message));
  mainWindow.on("close", (event) => {
    if (!app.isQuitting) { event.preventDefault(); hideWindow(); }
  });
}

ipcMain.on("fuci:set-super-mode", (_event, payload) => {
  const enabled = payload && typeof payload === "object" ? payload.enabled : payload;
  const preferredSize = payload && typeof payload === "object" ? payload.size : undefined;
  resizeWindowForMode(Boolean(enabled), preferredSize);
});

ipcMain.on("fuci:hide-window", () => {
  hideWindow();
});

ipcMain.on("fuci:load-state", (event) => {
  event.returnValue = readPersistedState();
});

ipcMain.on("fuci:state-status", (event) => {
  const exists = [statePath, backupPath, stateTempPath, backupTempPath].some((candidate) => fsSync.existsSync(candidate));
  event.returnValue = { exists, readable: Boolean(readPersistedState()) };
});

ipcMain.on("fuci:save-state", (_event, payload) => {
  let state;
  try { state = typeof payload === "string" ? JSON.parse(payload) : payload; } catch { return; }
  queuePersistedState(state);
});

ipcMain.on("fuci:fit-window", (_event, requested) => {
  if (!mainWindow || mainWindow.isDestroyed() || !requested) return;
  const limits = limitsForMode();
  const width = Math.max(limits.minWidth, Math.min(limits.maxWidth, Math.ceil(Number(requested.width) || 336)));
  const height = Math.max(limits.minHeight, Math.min(superMode ? 900 : limits.maxHeight, Math.ceil(Number(requested.height) || 190)));
  setWindowSize(width, height);
});

ipcMain.on("fuci:resize-start", (_event, payload) => {
  if (!mainWindow || mainWindow.isDestroyed() || !payload?.edge) return;
  activeResize = { ...payload, bounds: mainWindow.getBounds() };
});

ipcMain.on("fuci:resize-move", (_event, payload) => {
  if (!activeResize || !mainWindow || mainWindow.isDestroyed() || !payload) return;
  const { edge, screenX: startX, screenY: startY, bounds: start } = activeResize;
  const dx = Number(payload.screenX) - Number(startX);
  const dy = Number(payload.screenY) - Number(startY);
  const limits = limitsForMode();
  let { x, y, width, height } = start;
  if (edge.includes("e")) width = start.width + dx;
  if (edge.includes("s")) height = start.height + dy;
  if (edge.includes("w")) { width = start.width - dx; x = start.x + dx; }
  if (edge.includes("n")) { height = start.height - dy; y = start.y + dy; }
  if (width < limits.minWidth) { if (edge.includes("w")) x = start.x + start.width - limits.minWidth; width = limits.minWidth; }
  if (height < limits.minHeight) { if (edge.includes("n")) y = start.y + start.height - limits.minHeight; height = limits.minHeight; }
  width = Math.min(width, limits.maxWidth); height = Math.min(height, limits.maxHeight);
  mainWindow.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }, false);
});

ipcMain.on("fuci:resize-end", () => {
  if (activeResize && mainWindow && !mainWindow.isDestroyed() && superMode) {
    const bounds = mainWindow.getBounds();
    mainWindow.webContents.send("fuci:window-resized", { width: bounds.width, height: bounds.height });
  }
  activeResize = undefined;
});

function hideWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.hide();
  // A hidden tray window should not leave an empty taskbar entry behind.
  mainWindow.setSkipTaskbar(true);
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setSkipTaskbar(false);
  mainWindow.show();
  mainWindow.focus();
}

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) hideWindow();
  else showWindow();
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    showWindow();
  });

  app.whenReady().then(() => {
    // Do not asynchronously rewrite the state file before the renderer reads
    // it. That used to create a startup race where the renderer saw partial
    // JSON and immediately replaced valid progress with a fresh state.
    createWindow();
    const trayIcon = nativeImage.createFromDataURL("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");
    tray = new Tray(trayIcon);
    tray.setToolTip("浮词 · CET-6 背词器");
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "显示 / 隐藏悬浮窗", click: toggleWindow },
      { label: "退出浮词", click: () => { app.isQuitting = true; app.quit(); } }
    ]));
    tray.on("click", toggleWindow);
    globalShortcut.register("CommandOrControl+Shift+Space", toggleWindow);
  });
}

app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => { /* keep the tray app alive */ });
