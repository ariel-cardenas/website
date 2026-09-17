/** Small local-only static server for previewing and browser tests. */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".gz": "application/gzip" };
const port = Number(process.env.PORT || 8000);
const compress = promisify(gzip);
const svgResponses = new Map();
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (!['GET', 'HEAD'].includes(request.method) || pathname.split('/').some(part => part.startsWith('.'))) {
      response.writeHead(403).end();
      return;
    }
    const target = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!target.startsWith(root.endsWith(sep) ? root : root + sep)) {
      response.writeHead(403).end();
      return;
    }
    let body;
    const headers = { "Content-Type": types[extname(target)] || "application/octet-stream", "Cache-Control": "no-store" };
    if (extname(target) === ".svg" && /\bgzip\b/.test(request.headers["accept-encoding"] || "")) {
      const { mtimeMs } = await stat(target);
      let cached = svgResponses.get(target);
      if (!cached || cached.modified !== mtimeMs) {
        cached = { modified: mtimeMs, body: compress(await readFile(target)) };
        svgResponses.set(target, cached);
      }
      body = await cached.body;
      headers["Content-Encoding"] = "gzip";
      headers.Vary = "Accept-Encoding";
    } else body = await readFile(target);
    response.writeHead(200, headers);
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(404).end("Not found");
  }
});
server.listen(port, "127.0.0.1", () => console.log(`Preview: http://127.0.0.1:${port}`));
