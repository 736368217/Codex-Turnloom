#!/usr/bin/env node
/**
 * Read-only static server for `public/downloads/` so another machine (e.g. the
 * Windows desktop `de`) can fetch the server upgrade zip and its manifest over
 * Tailscale/LAN. Only GET/HEAD, one flat directory, no traversal, no auth.
 *
 *   node scripts/serve-downloads.cjs [port]
 *   TURNLOOM_DOWNLOADS_PORT=8899 TURNLOOM_DOWNLOADS_HOST=0.0.0.0
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "downloads");
const port = Number(process.argv[2] || process.env.TURNLOOM_DOWNLOADS_PORT || 8899);
const host = String(process.env.TURNLOOM_DOWNLOADS_HOST || "0.0.0.0");
const TYPES = {
  ".json": "application/json; charset=utf-8",
  ".zip": "application/zip",
  ".apk": "application/vnd.android.package-archive",
  ".sha256": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".html": "text/html; charset=utf-8",
};

http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); res.end(); return; }
  const name = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) {
    res.writeHead(404); res.end("not found"); return;
  }
  const file = path.join(root, name);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end("not found"); return;
  }
  const stat = fs.statSync(file);
  res.writeHead(200, {
    "content-type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
    "content-length": stat.size,
    "cache-control": "no-store",
  });
  if (req.method === "HEAD") { res.end(); return; }
  fs.createReadStream(file).pipe(res);
}).listen(port, host, () => {
  console.log(`turnloom downloads: http://${host}:${port}/ (${root})`);
});
