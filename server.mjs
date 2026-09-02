import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8" };
createServer(async (req, res) => {
  try {
    const requestPath = decodeURIComponent((req.url || "/").split("?")[0]);
    const safePath = normalize(join(root, requestPath === "/" ? "index.html" : requestPath));
    if (!safePath.startsWith(root)) throw new Error("forbidden");
    const body = await readFile(safePath);
    res.writeHead(200, { "Content-Type": types[extname(safePath)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(body);
  } catch { res.writeHead(404); res.end("Not found"); }
}).listen(4173, "127.0.0.1", () => console.log("浮词已启动: http://127.0.0.1:4173"));
