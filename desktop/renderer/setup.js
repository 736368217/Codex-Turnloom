"use strict";

const api = window.turnloom;
let detected = null;
let selectedHome = "";
let currentStep = 1;
let creating = false;

const $ = (id) => document.getElementById(id);

function showPage(n) {
  currentStep = n;
  document.querySelectorAll(".page").forEach((page) => page.classList.toggle("active", page.id === `page${n}`));
  document.querySelectorAll(".step").forEach((step) => {
    const dot = Number(step.dataset.stepDot);
    step.classList.toggle("active", dot === n);
    step.classList.toggle("done", dot < n);
  });
}

function errorText(errors) {
  if (!errors || !errors.length) return "操作失败，请稍后重试。";
  return errors.map((item) => item.message || item.field).join("\n");
}

async function loadDetection() {
  if (!api) {
    $("noHome").hidden = false;
    $("step1Sub").textContent = "无法连接主进程";
    return;
  }
  try {
    detected = await api.detectSetup();
    $("step1Sub").textContent = detected.homes?.length ? `已找到 ${detected.homes.length} 个数据目录` : "未找到数据目录";
    $("machineName").value = detected.machineName || "";
    $("port").value = detected.defaultPort || 8787;
    $("accessCode").value = detected.accessCode || "";
    if (!detected.homes?.length) {
      $("noHome").hidden = false;
      return;
    }
    selectedHome = detected.homes[0].path;
    $("codexHome").value = selectedHome;
    renderHomes();
  } catch (error) {
    $("step1Sub").textContent = "检测失败";
    $("noHome").hidden = false;
    $("noHome").querySelector("span").textContent = `检测失败：${error.message}`;
  }
}

function renderHomes() {
  const list = $("homeList");
  list.innerHTML = "";
  for (const home of detected?.homes || []) {
    const label = document.createElement("label");
    label.className = `home${selectedHome === home.path ? " selected" : ""}`;
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "codexHome";
    radio.checked = selectedHome === home.path;
    radio.addEventListener("change", () => {
      selectedHome = home.path;
      $("codexHome").value = home.path;
      $("next1").disabled = false;
      renderHomes();
    });
    const info = document.createElement("span");
    info.className = "info";
    const name = document.createElement("b");
    name.textContent = home.path;
    const meta = document.createElement("small");
    meta.textContent = `${home.source} · 最近使用 ${formatDate(home.modified)}`;
    info.append(name, meta);
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = "可用";
    label.append(radio, info, badge);
    list.append(label);
  }
  $("next1").disabled = !selectedHome;
}

function formatDate(ms) {
  if (!ms) return "未知";
  try {
    return new Date(ms).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

async function browseHome() {
  if (!api) return;
  const result = await api.choosePath("directory");
  if (!result.ok) return;
  selectedHome = result.path;
  $("codexHome").value = result.path;
  $("next1").disabled = false;
  renderHomes();
}

function validateStep2() {
  const port = Number($("port").value);
  const code = String($("accessCode").value || "").trim();
  if (!Number.isInteger(port) || port < 1 || port > 65535) return "端口需在 1–65535 之间。";
  if (!/^\d{4,8}$/.test(code)) return "访问码需为 4–8 位数字。";
  if (!selectedHome) return "请选择 Codex 数据目录。";
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(String($("portHint").dataset.ip || "127.0.0.1"))) {
    // IP hint is cosmetic; the main process checks the real path.
  }
  return "";
}

async function startSetup() {
  const message = validateStep2();
  if (message) {
    $("setupError").hidden = false;
    $("setupError").textContent = message;
    return;
  }
  $("setupError").hidden = true;
  $("startError").hidden = true;
  $("retryStart").hidden = true;
  showPage(3);
  $("startingState").hidden = false;
  $("pairingState").hidden = true;
  creating = true;
  try {
    const result = await api.createSetup({
      codexHome: selectedHome,
      machineName: $("machineName").value.trim() || detected?.machineName,
      port: Number($("port").value),
      accessCode: String($("accessCode").value).trim(),
      autoStart: $("autoStart").checked,
      startMinimized: $("startMinimized").checked
    });
    if (!result.ok) {
      $("startError").hidden = false;
      $("startError").textContent = errorText(result.errors);
      $("retryStart").hidden = false;
      return;
    }
    $("setupStatus").classList.add("on");
    $("setupStatus").lastChild.textContent = "服务运行中";
    const pairing = await api.getPairing();
    if (pairing.ok) {
      $("setupQr").src = pairing.dataUrl;
      $("pairMachine").textContent = pairing.machineName || "本机";
      $("pairUrl").textContent = pairing.url || "";
      $("pairCode").textContent = pairing.accessCode || "";
    }
    $("startingState").hidden = true;
    $("pairingState").hidden = false;
  } catch (error) {
    $("startError").hidden = false;
    $("startError").textContent = error.message;
    $("retryStart").hidden = false;
  } finally {
    creating = false;
  }
}

$("next1").addEventListener("click", () => {
  if (!selectedHome) return;
  $("codexHome").value = selectedHome;
  showPage(2);
});
$("back2").addEventListener("click", () => showPage(1));
$("next2").addEventListener("click", startSetup);
$("back3").addEventListener("click", () => { if (!creating) showPage(2); });
$("retryStart").addEventListener("click", startSetup);
$("openConsole").addEventListener("click", () => api?.openConsole());
$("browseHomeBtn").addEventListener("click", browseHome);
$("browseHome2").addEventListener("click", browseHome);
$("regenCode").addEventListener("click", () => {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  $("accessCode").value = code;
});
$("minBtn").addEventListener("click", () => api?.minimize());
$("closeBtn").addEventListener("click", () => api?.close());
document.querySelectorAll(".home").forEach((el) => el.addEventListener("click", () => el.classList.add("selected")));

loadDetection();
