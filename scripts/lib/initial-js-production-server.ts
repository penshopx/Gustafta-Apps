import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";

export const PRODUCTION_TRANSFER_PROFILE = "production-gzip6-anonymous-v1";
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".webp": "image/webp", ".woff2": "font/woff2", ".ico": "image/x-icon",
  ".mp4": "video/mp4", ".webm": "video/webm",
};

/** No Vite middleware, application startup, database, or live API credentials. */
export async function serveProductionTransfer(buildDir: string) {
  const root = resolve(buildDir);
  const html = await readFile(resolve(root, "index.html"), "utf8");
  if (!/\/assets\/[^"']+\.js/.test(html) || /@vite\/client|\/src\/main\.[jt]sx?/.test(html)) {
    throw new Error("Expected a compiled production index.html, not Vite development HTML");
  }
  const server = createServer(async (req, res) => {
    res.sendDate = false;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Transfer-Profile", PRODUCTION_TRANSFER_PROFILE);
    try {
      const path = decodeURIComponent(new URL(req.url!, "http://fixture").pathname);
      if (path === "/api" || path.startsWith("/api/")) {
        // Fixed anonymous state. Deliberately no marketing pixel configuration.
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end('{"message":"Anonymous transfer profile"}');
        return;
      }
      const file = resolve(root, "." + path);
      if (file !== root && !file.startsWith(root + sep)) {
        res.writeHead(403).end();
        return;
      }
      let body: Buffer;
      let extension = extname(file);
      try {
        body = await readFile(path === "/" ? resolve(root, "index.html") : file);
        if (path === "/") extension = ".html";
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        if (extension || path.startsWith("/assets/")) {
          res.writeHead(404).end("Not found");
          return;
        }
        body = Buffer.from(html);
        extension = ".html";
      }
      res.setHeader("Content-Type", types[extension] ?? "application/octet-stream");
      if ([".html", ".js", ".css", ".json", ".svg"].includes(extension) &&
          /\bgzip\b/.test(req.headers["accept-encoding"] ?? "")) {
        body = gzipSync(body, { level: 6 });
        res.setHeader("Content-Encoding", "gzip");
        res.setHeader("Vary", "Accept-Encoding");
      }
      res.setHeader("Content-Length", body.length);
      res.end(body);
    } catch {
      res.writeHead(500).end("Production fixture error");
    }
  });
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No production fixture port");
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise<void>((done, reject) => {
      server.close((error) => error ? reject(error) : done());
      server.closeAllConnections();
    }),
  };
}
