const { existsSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");
const { spawn } = require("node:child_process");
const net = require("node:net");

const root = __dirname;
const electronBinary = join(root, "node_modules", "electron", "dist", "electron.exe");
const cachedElectron = join(process.env.LOCALAPPDATA || "", "electron", "Cache", "0398eab6ff3b10eeeae02ced94c086c2894afe98d8b58a4a1f6e485064ac1f7f", "electron-v42.3.3-win32-x64.zip");

if (!existsSync(electronBinary) && existsSync(cachedElectron)) {
  console.log("发现本机 Electron 缓存，正在解压桌面运行时…");
  mkdirSync(join(root, "node_modules", "electron", "dist"), { recursive: true });
  const unzip = spawn("tar.exe", ["-xf", cachedElectron, "-C", join(root, "node_modules", "electron", "dist")], { cwd: root, stdio: "inherit", windowsHide: true });
  unzip.on("exit", (code) => {
    if (code === 0 && existsSync(electronBinary)) launchDesktop();
    else openBrowser();
  });
} else if (existsSync(electronBinary)) {
  launchDesktop();
} else {
  fallback();
}

function launchDesktop() {
  const child = spawn(electronBinary, [root, "--disable-gpu", "--in-process-gpu"], { cwd: root, stdio: "inherit", windowsHide: true });
  child.on("exit", (code) => process.exit(code ?? 0));
}

function fallback() {
  console.log("未检测到 Electron 运行时，先启动浏览器版浮词（可直接使用全部功能）。");
  const probe = net.createConnection({ host: "127.0.0.1", port: 4173 });
  probe.once("connect", () => {
    probe.destroy();
    openBrowser();
  });
  probe.once("error", () => {
    probe.destroy();
    const server = spawn(process.execPath, [join(root, "server.mjs")], { cwd: root, stdio: "ignore", windowsHide: true, detached: true });
    server.unref();
    setTimeout(openBrowser, 250);
  });
}

function openBrowser() {
  spawn("explorer.exe", ["http://127.0.0.1:4173"], { cwd: root, windowsHide: true });
}
