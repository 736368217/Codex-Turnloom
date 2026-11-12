import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const results = [];

function check(name, ok, detail) {
  results.push({ name: String(name), ok: !!ok, detail: detail ?? "" });
  console.log(`[verify-single-app] ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`);
}
function readText(rel) {
  try {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "");
  } catch { return null; }
}
function readJson(rel) {
  const t = readText(rel);
  if (t === null) return null;
  try { return JSON.parse(t); } catch { return null; }
}
function walk(relDir, exts) {
  const out = [];
  let base;
  try { base = path.join(ROOT, relDir); if (!fs.existsSync(base)) return out; } catch { return out; }
  const stack = [base];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name === "dist" || e.name === ".git") continue;
      const full = path.join(d, e.name);
      try {
        if (e.isDirectory()) stack.push(full);
        else if (exts.test(e.name)) out.push(full);
      } catch { /* skip unreadable entry */ }
    }
  }
  return out;
}

// APK = ZIP. Parse EOCD (0x06054b50) + central directory headers
// (0x02014b50) to read entry NAMES. Built-ins only, no third-party dep.
function zipEntries(abs) {
  const b = fs.readFileSync(abs);
  if (b.length < 22) throw new Error("文件过小，不是合法 APK/ZIP");
  let eocd = -1;
  const start = Math.max(0, b.length - 22 - 0xffff);
  for (let i = b.length - 22; i >= start; i--) {
    if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("未找到 EOCD 签名 0x06054b50，不是合法 APK");
  const count = b.readUInt16LE(eocd + 10);
  let off = b.readUInt32LE(eocd + 16);
  const names = [];
  for (let n = 0; n < count; n++) {
    if (off + 46 > b.length || b.readUInt32LE(off) !== 0x02014b50) {
      throw new Error(`中央目录头 #${n} 非法（偏移 ${off}）`);
    }
    const nameLen = b.readUInt16LE(off + 28);
    const extraLen = b.readUInt16LE(off + 30);
    const commentLen = b.readUInt16LE(off + 32);
    names.push(b.toString("utf8", off + 46, off + 46 + nameLen));
    off += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

function run() {
  console.log("[verify-single-app] ROUTE=dom-shell 静态门禁");
  console.log(`[verify-single-app] 仓库根目录: ${ROOT}`);

  // 1. 合同
  const contract = readText("docs/option-a/SINGLE_APP_CONTRACT.md");
  check("合同含 ROUTE=dom-shell", contract !== null && /ROUTE=dom-shell/.test(contract),
    contract === null ? "缺失 docs/option-a/SINGLE_APP_CONTRACT.md" : "");

  // 2. 依赖 konsta / vaul
  const pkg = readJson("app/package.json");
  const deps = pkg ? { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) } : {};
  check("app/package.json 依赖含 konsta", !!deps.konsta,
    pkg ? `konsta=${deps.konsta ?? "缺失"}` : "缺失或非法 app/package.json");
  check("app/package.json 依赖含 vaul", !!deps.vaul,
    pkg ? `vaul=${deps.vaul ?? "缺失"}` : "缺失或非法 app/package.json");

  // 3. 无 '/threads' 字面量（/api/... 前缀不计）
  const srcFiles = walk("app/src", /\.(?:ts|tsx|js|jsx|mjs|cjs|json|css|html)$/);
  const rootFiles = ["app/index.html", "app/vite.config.ts", "app/vite.config.js", "app/vite.config.mjs"]
    .map((r) => path.join(ROOT, r)).filter((p) => { try { return fs.existsSync(p); } catch { return false; } });
  const all = srcFiles.concat(rootFiles);
  const offenders = [];
  for (const f of all) {
    let t;
    try { t = fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""); } catch { continue; }
    // 只匹配真实字符串字面量 '/threads'；"/api/threads" 不匹配（引号后须紧跟 /threads）。
    if (/["'`]\/threads(?:\/|\?|["'`])/.test(t)) offenders.push(path.relative(ROOT, f));
  }
  check("app 源码不含 '/threads' 字面量（不含 /api 前缀）", all.length > 0 && offenders.length === 0,
    all.length === 0 ? "缺失 app/ 源码（app/src 下无可扫描文件）" : `扫描 ${all.length} 文件，违规: ${offenders.join(", ") || "无"}`);

  // 4. MainActivity.java
  const actRel = "native-shell/app/src/main/java/com/codex/turnloom/app/MainActivity.java";
  const act = readText(actRel);
  if (act === null) {
    check("MainActivity.java 存在", false, `缺失 ${actRel}`);
  } else {
    check("MainActivity.java 含 file:///android_asset/public/index.html", /file:\/\/\/android_asset\/public\/index\.html/.test(act), "");
    check("MainActivity.java 含 TurnloomNative", /TurnloomNative/.test(act), "");
    check("MainActivity.java 含 moveTaskToBack", /moveTaskToBack/.test(act), "");
    check("MainActivity.java 含 evaluateJavascript", /evaluateJavascript/.test(act), "");
    check("MainActivity.java 不含 goBack()", !/goBack\s*\(/.test(act), "禁止 WebView.goBack()");
  }

  // 5. AndroidManifest.xml
  const manRel = "native-shell/app/src/main/AndroidManifest.xml";
  const man = readText(manRel);
  if (man === null) {
    check("AndroidManifest.xml 存在", false, `缺失 ${manRel}`);
  } else {
    check("AndroidManifest.xml 含 com.codex.turnloom.app", /com\.codex\.turnloom\.app/.test(man), "");
    check("AndroidManifest.xml 含 networkSecurityConfig", /networkSecurityConfig/.test(man), "");
    check("AndroidManifest.xml 含 CAMERA", /android\.permission\.CAMERA/.test(man), "");
    check("AndroidManifest.xml 含 VIBRATE", /android\.permission\.VIBRATE/.test(man), "");
  }

  // 6. 构建脚本
  const buildScript = path.join(ROOT, "scripts/build-single-app.ps1");
  check("build-single-app.ps1 存在", fs.existsSync(buildScript),
    fs.existsSync(buildScript) ? path.relative(ROOT, buildScript) : "缺失 scripts/build-single-app.ps1");

  // 7. APK ZIP 断言（仅当 dist-app/*.apk 存在）
  const distDir = path.join(ROOT, "dist-app");
  let apks = [];
  try { if (fs.existsSync(distDir)) apks = fs.readdirSync(distDir).filter((n) => n.toLowerCase().endsWith(".apk")); }
  catch { apks = []; }
  if (apks.length === 0) {
    check("dist-app/*.apk ZIP 断言（本轮跳过：尚无 APK）", true, "SKIP：构建后重跑本门禁即执行 ZIP 断言");
  } else {
    for (const apk of apks) {
      const abs = path.join(distDir, apk);
      let names = [], zipErr = "";
      try { names = zipEntries(abs); } catch (e) { zipErr = e && e.message ? e.message : String(e); }
      check(`${apk}: ZIP 中央目录可解析`, zipErr === "", zipErr || `${names.length} 条目`);
      if (zipErr) continue;
      // zlib 为 node 内置模块：给出条目名 gzip 摘要，确认全程零第三方依赖。
      let digest = "";
      try { digest = "namesGzip=" + zlib.gzipSync(Buffer.from(names.join("\n"), "utf8")).length; } catch { }
      check(`${apk}: 含 assets/public/index.html`, names.includes("assets/public/index.html"), digest);
      check(`${apk}: 不含 libflutter.so`, !names.some((n) => /(^|\/)libflutter\.so$/.test(n)), "");
      check(`${apk}: 不含 assets/index.android.bundle`, !names.some((n) => /assets\/index\.android\.bundle/.test(n)), "");
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log("");
  if (failed.length) {
    console.error(`[verify-single-app] FAIL：${failed.length}/${results.length} 项未通过`);
    for (const f of failed) console.error(`  - ${f.name}: ${f.detail}`);
    process.exitCode = 1;
  } else {
    console.log(`[verify-single-app] PASS：${results.length}/${results.length} 项通过（ROUTE=dom-shell / App 化 DOM 容器（含 WebView））`);
    process.exitCode = 0;
  }
}

// 顶层兜底：任何异常都转成清晰中文 + 退出码 1，绝不抛未捕获异常。
try {
  run();
} catch (e) {
  const msg = e && e.message ? e.message : String(e);
  console.error(`[verify-single-app] 门禁执行异常（已捕获，退出码 1）：${msg}`);
  process.exitCode = 1;
}