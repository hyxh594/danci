const { existsSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");
const { spawn } = require("node:child_process");

const root = __dirname;
const electronBinary = join(root, "node_modules", "electron", "dist", "electron.exe");
const cachedElectron = join(process.env.LOCALAPPDATA || "", "electron", "Cache", "0398eab6ff3b10eeeae02ced94c086c2894afe98d8b58a4a1f6e485064ac1f7f", "electron-v42.3.3-win32-x64.zip");

if (!existsSync(electronBinary) && existsSync(cachedElectron)) {
  console.log("发现本机 Electron 缓存，正在解压桌面运行时…");
  mkdirSync(join(root, "node_modules", "electron", "dist"), { recursive: true });
  const unzip = spawn("tar.exe", ["-xf", cachedElectron, "-C", join(root, "node_modules", "electron", "dist")], { cwd: root, stdio: "inherit", windowsHide: true });
  unzip.on("exit", (code) => {
    if (code === 0 && existsSync(electronBinary)) launchDesktop();
    else fail("Electron 缓存解压失败");
  });
} else if (existsSync(electronBinary)) {
  launchDesktop();
} else {
  fail("未检测到 Electron 运行时，请先执行 npm install");
}

function launchDesktop() {
  // Some Windows installations refuse to launch Electron's renderer under
  // the sandbox (ERR_FAILED / renderer process launch-failed). This is a
  // local, single-purpose desktop app, so disable that sandbox to keep the
  // bundled page reliable.
  const child = spawn(electronBinary, [root, "--no-sandbox", "--disable-gpu", "--in-process-gpu"], { cwd: root, stdio: "inherit", windowsHide: true });
  child.on("exit", (code) => process.exit(code ?? 0));
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}
