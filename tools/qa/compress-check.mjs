#!/usr/bin/env node
/**
 * Real-photo compression check for the 2.2.1 send path.
 *
 * Node has no canvas, so this bundles the production `app/src/lib/imageUpload.ts`
 * with esbuild, runs it in headless Edge at 390×844 @DPR3 against a synthetic
 * 4032×3024 JPEG, then sends the compressed attachment to
 * tools/qa/send-fault-server.mjs and reports the exact request-body size.
 *
 *   node tools/qa/compress-check.mjs
 *   node tools/qa/compress-check.mjs --photo .scratch/qa/my-photo.jpg
 *
 * Evidence lands in `.scratch/qa/compress-report.json` (ignored by git).
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CDP } from "./cdp.mjs";
import { createSendFaultServer } from "./send-fault-server.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, ".scratch", "qa");
const PHOTO = path.join(OUT, "photo-4032x3024.jpg");
const BUNDLE = path.join(OUT, "image-upload.bundle.js");
fs.mkdirSync(OUT, { recursive: true });

const flag = (name, fallback = "") => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

function ensurePhoto(file) {
  if (fs.existsSync(file)) return file;
  const powerShell = [
    "Add-Type -AssemblyName System.Drawing",
    "$w=4032; $h=3024",
    "$bmp = New-Object System.Drawing.Bitmap $w,$h",
    "$g = [System.Drawing.Graphics]::FromImage($bmp)",
    "$g.SmoothingMode = 'HighQuality'",
    "$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush((New-Object System.Drawing.Rectangle 0,0,$w,$h)), ([System.Drawing.Color]::FromArgb(255,38,78,132)), ([System.Drawing.Color]::FromArgb(255,226,196,138)), 25",
    "$g.FillRectangle($bg, 0, 0, $w, $h)",
    "$rand = New-Object System.Random 42",
    "for ($i=0; $i -lt 900; $i++) {",
    "  $r=$rand.Next(8,150); $x=$rand.Next(0,$w); $y=$rand.Next(0,$h)",
    "  $c=[System.Drawing.Color]::FromArgb($rand.Next(30,220), $rand.Next(30,220), $rand.Next(30,220))",
    "  $b=New-Object System.Drawing.SolidBrush $c",
    "  $g.FillEllipse($b, $x, $y, $r, $r)",
    "  $b.Dispose()",
    "}",
    "$g.Dispose()",
    "$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }",
    "$params = New-Object System.Drawing.Imaging.EncoderParameters 1",
    "$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 92",
    `$bmp.Save('${file.replace(/'/g, "''")}', $codec, $params)`,
    "$bmp.Dispose()",
  ].join("\n");
  execFileSync("powershell", ["-NoProfile", "-Command", powerShell], { stdio: "pipe", timeout: 120_000 });
  return file;
}

async function bundle() {
  const { build } = await import(pathToFileURL(path.join(ROOT, "app/node_modules/esbuild/lib/main.js")).href);
  await build({
    entryPoints: [path.join(ROOT, "app/src/lib/imageUpload.ts")],
    bundle: true,
    format: "iife",
    globalName: "TurnloomImageUpload",
    platform: "browser",
    target: "es2020",
    outfile: BUNDLE,
    logLevel: "silent",
  });
  return BUNDLE;
}

function staticServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end("<!doctype html><meta charset=utf-8><title>compress check</title><body>ready<script src=/bundle.js></script>");
    }
    const file = url.pathname === "/bundle.js" ? BUNDLE : url.pathname === "/photo.jpg" ? PHOTO : "";
    if (!file) { res.writeHead(404); return res.end(); }
    res.writeHead(200, {
      "Content-Type": url.pathname === "/photo.jpg" ? "image/jpeg" : "text/javascript; charset=utf-8",
      "Content-Length": fs.statSync(file).size,
      "Access-Control-Allow-Origin": "*",
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port })));
}

const pageScript = `(async () => {
  const res = await fetch('/photo.jpg');
  const bytes = new Uint8Array(await res.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  const base64 = btoa(binary);
  const attachment = { id: 'photo', name: 'IMG_2026.JPG', mimeType: 'image/jpeg', sizeBytes: bytes.length, data: 'data:image/jpeg;base64,' + base64, kind: 'image' };
  const started = performance.now();
  const out = await TurnloomImageUpload.compressImageForUpload(attachment);
  const outBytes = Uint8Array.from(atob(out.data), (c) => c.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([outBytes], { type: out.mimeType }));
  return {
    inBytes: bytes.length, inBase64Bytes: base64.length,
    outBytes: out.sizeBytes, measuredBytes: outBytes.length,
    width: bitmap.width, height: bitmap.height,
    name: out.name, mimeType: out.mimeType, data: out.data,
    ms: Math.round(performance.now() - started),
  };
})()`;

const browser = new CDP({ width: 390, height: 844, scale: 3, headless: true, args: ["--disable-web-security"] });
const faults = createSendFaultServer({ scenario: "ok" });
let staticHandle;
try {
  ensurePhoto(flag("photo", PHOTO) || PHOTO);
  await bundle();
  staticHandle = await staticServer();
  await faults.listen(0);
  await browser.launch();
  await browser.setViewport(390, 844, 3);
  await browser.navigate(`http://127.0.0.1:${staticHandle.port}/`);
  await browser.waitForText("ready");
  const result = await browser.eval(pageScript);

  const sendBody = JSON.stringify({
    message: "photo compression check",
    clientRequestId: "compress-check-1",
    threadId: "thread-qa",
    images: [{ name: result.name, mimeType: result.mimeType, data: result.data }],
    files: [],
  });
  const response = await fetch(`${faults.url}/api/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-access-token": "qa-token" },
    body: sendBody,
  });
  const requestBytes = Buffer.byteLength(sendBody);
  const sendRecord = faults.requests.find((row) => row.path === "/api/send");
  const report = {
    generatedAt: new Date().toISOString(),
    viewport: "390x844@3",
    source: { file: path.relative(ROOT, flag("photo", PHOTO) || PHOTO), bytes: result.inBytes, edge: 4032, height: 3024 },
    compressed: { bytes: result.outBytes, measuredBytes: result.measuredBytes, width: result.width, height: result.height, name: result.name, mimeType: result.mimeType, ms: result.ms },
    send: { status: response.status, requestBytes, underOneMiB: requestBytes <= 1024 * 1024, serverSawImages: sendRecord?.images?.length ?? 0 },
  };
  fs.writeFileSync(path.join(OUT, "compress-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (response.status !== 200) throw new Error(`send failed: ${response.status}`);
  if (result.width !== 2048 || result.height !== 1536) throw new Error(`unexpected dimensions ${result.width}x${result.height}`);
  if (result.outBytes > 1024 * 1024) throw new Error(`compressed image still ${result.outBytes} bytes`);
  if (requestBytes > 1024 * 1024) throw new Error(`send body ${requestBytes} bytes exceeds 1 MiB`);
} finally {
  await browser.close?.();
  await faults.close();
  if (staticHandle) await new Promise((resolve) => staticHandle.server.close(() => resolve()));
}
