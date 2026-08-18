/* ErfanSh Trainer Manager — نسخه‌ی موبایل (PWA)
   همگام‌سازی + ویرایش + بیلد امن + انتشار — همه از روی گوشی
   توکن فقط روی همین دستگاه (localStorage) ذخیره می‌شود. */

"use strict";

/* ---------- ابزار ---------- */

const $ = (id) => document.getElementById(id);

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64decode(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function toast(msg, ok) {
  const el = $("toast-msg");
  el.textContent = msg;
  el.className = ok ? "ok" : "err";
  $("toast").classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => $("toast").classList.remove("show"), 3200);
}

function setStatus(msg, kind) {
  const el = $("status");
  el.textContent = msg;
  el.className = kind || "";
}

function overlay(msg, show) {
  $("overlay-msg").textContent = msg || "در حال انجام…";
  $("overlay").classList.toggle("show", !!show);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- ذخیره‌سازی محلی ---------- */

const CFG_KEY = "etm_cfg_v1";

/* تنظیمات پیش‌فرض — بقیه‌ی فیلدها خودکار پر می‌شوند.
   توکن عمداً خالی است: گیت‌هاب پوشِ فایل‌های حاوی توکن را به‌عنوان
   قانون امنیتی بلاک می‌کند (و ریسک لو رفتنش هم هست).
   یک بار در تنظیمات واردش کن — برای همیشه روی همین دستگاه می‌ماند. */
const DEFAULT_CFG = {
  token: "",
  owner: "ErfanShTrainer",
  site: "ErfanShTrainer.github.io",
  src: "ErfanShTrainer-src"
};

function loadCfg() {
  let c;
  try { c = JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch { c = {}; }
  if (!c.token) {
    c = Object.assign({}, DEFAULT_CFG, c);
    saveCfg(c);
  }
  return c;
}
function saveCfg(c) {
  localStorage.setItem(CFG_KEY, JSON.stringify(c));
}

/* ---------- GitHub API ---------- */

const API = "https://api.github.com";

async function gh(path, method, body) {
  const cfg = loadCfg();
  const r = await fetch(API + path, {
    method: method || "GET",
    headers: {
      Authorization: "Bearer " + (cfg.token || ""),
      Accept: "application/vnd.github+json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (r.status === 401) throw new Error("توکن اشتباه است (401)");
  if (r.status === 403) throw new Error("دسترسی توکن کافی نیست (403)");
  if (!r.ok) throw new Error("گیت‌هاب: " + r.status);
  return r.status === 204 ? null : r.json();
}

async function getFile(owner, repo, path) {
  const d = await gh(`/repos/${owner}/${repo}/contents/${path}`);
  return { content: b64decode(d.content), sha: d.sha };
}

async function putFile(owner, repo, path, content, sha, message) {
  await gh(`/repos/${owner}/${repo}/contents/${path}`, "PUT", {
    message, content: b64encode(content), sha
  });
}

/* ---------- پارس و ساخت پست‌ها (همان منطق برنامه‌ی ویندوزی) ---------- */

const BLOCK_RE = /const TRAINERS = \[([\s\S]*?)\n\];/;
const QUOTE_RE = /([{,]\s*)("?)(title|game|version|size|date|status|noteEn|note|image|url)("?)(\s*:)/g;

function parseScriptJs(js) {
  const m = BLOCK_RE.exec(js);
  if (!m) return null;
  let block = m[1];
  block = block.replace(QUOTE_RE, '$1"$3"$5');
  block = block.replace(/,\s*}/g, "}");
  try {
    const posts = JSON.parse("[" + block + "]");
    return Array.isArray(posts) ? posts : [];
  } catch {
    return null;
  }
}

function buildBlock(posts) {
  const keys = ["title", "game", "version", "size", "date", "status", "note", "noteEn", "image", "url"];
  let out = "";
  posts.forEach((p, i) => {
    out += "  {\n";
    for (const k of keys) out += `    ${k}: ${JSON.stringify(p[k] ?? "")},\n`;
    out = out.replace(/,\n$/, "\n");
    out += "  }" + (i < posts.length - 1 ? "," : "") + "\n";
  });
  return out;
}

function replaceBlock(js, block) {
  return js.replace(BLOCK_RE, "const TRAINERS = [\n" + block + "];");
}

/* ---------- بیلد امن (terser در Web Worker) ---------- */

function minifyInWorker(src) {
  return new Promise((resolve) => {
    const w = new Worker("build-worker.js");
    w.onmessage = (e) => { w.terminate(); resolve(e.data); };
    w.onerror = () => { w.terminate(); resolve({ ok: false, error: "worker error" }); };
    w.postMessage(src);
  });
}

function buildMinified(src) {
  // انکود لینک‌های دانلود + پیشوند سرور (مثل build.js)
  let s = src.replace(/(url:\s*")(https?:\/\/[^"]+)(")/g, (m, pre, url, post) => pre + b64encode(url) + post);
  s = s.replace(/(const FILE_BASE = ")(https?:\/\/[^"]+)(";)/, (m, pre, url, post) => pre + b64encode(url) + post);
  return minifyInWorker(s);
}

/* ---------- وضعیت برنامه ---------- */

let state = { posts: [], scriptJs: "", scriptJsSha: "", indexHtml: "", indexHtmlSha: "", minSha: "" };
let editIndex = -1;

/* ---------- نماها ---------- */

function showView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  $("view-" + name).classList.add("active");
}

function renderList() {
  const box = $("posts");
  box.innerHTML = "";
  const statusLabel = { new: "جدید", update: "آپدیت", old: "قدیمی" };
  state.posts.forEach((p, i) => {
    const chip = `<span class="chip ${p.status === "old" ? "old" : p.status === "update" ? "update" : ""}">${statusLabel[p.status] || "جدید"}</span>`;
    const thumb = p.image
      ? `<div class="thumb"><img loading="lazy" src="${esc(p.image)}" onerror="this.parentNode.textContent='${esc((p.title || "?").charAt(0))}'"></div>`
      : `<div class="thumb">${esc((p.title || "?").charAt(0))}</div>`;
    const div = document.createElement("div");
    div.className = "card";
    div.innerHTML = `${thumb}<div class="meta"><div class="t">${esc(p.title)}</div><div class="d">${esc(p.date || "")}</div></div>${chip}`;
    div.addEventListener("click", () => openEditor(i));
    box.appendChild(div);
  });
  $("empty").style.display = state.posts.length ? "none" : "block";
  $("list-title").textContent = `پست‌ها (${state.posts.length})`;
}

function openEditor(i) {
  editIndex = i;
  const p = i >= 0 ? state.posts[i] : {};
  $("edit-title").textContent = i >= 0 ? "ویرایش پست" : "پست جدید";
  $("f-title").value = p.title || "";
  $("f-game").value = p.game || "";
  $("f-version").value = p.version || "";
  $("f-date").value = p.date || "";
  $("f-status").value = p.status || "new";
  $("f-note").value = p.note || "";
  $("f-noteEn").value = p.noteEn || "";
  $("f-image").value = p.image || "";
  $("f-url").value = p.url || "";
  $("btn-del").style.display = i >= 0 ? "" : "none";
  showView("edit");
  $("f-title").focus();
}

function readForm() {
  return {
    title: $("f-title").value.trim(),
    game: $("f-game").value.trim(),
    version: $("f-version").value.trim(),
    size: "",
    date: $("f-date").value.trim(),
    status: $("f-status").value,
    note: $("f-note").value.trim(),
    noteEn: $("f-noteEn").value.trim(),
    image: $("f-image").value.trim(),
    url: $("f-url").value.trim()
  };
}

/* ---------- رویدادها ---------- */

$("btn-sync").addEventListener("click", syncAll);
$("btn-new").addEventListener("click", () => openEditor(-1));
$("btn-publish").addEventListener("click", publishAll);
$("btn-settings").addEventListener("click", openSettings);
$("btn-back").addEventListener("click", () => showView("list"));
$("btn-back2").addEventListener("click", () => showView("list"));
$("btn-save").addEventListener("click", () => {
  const p = readForm();
  if (!p.title || !p.url) { toast("عنوان و لینک دانلود الزامی هستند", false); return; }
  if (editIndex >= 0) state.posts[editIndex] = p;
  else state.posts.push(p);
  renderList();
  showView("list");
  toast("ذخیره شد — برای اعمال روی سایت «انتشار» را بزن", true);
});
$("btn-del").addEventListener("click", () => {
  if (editIndex < 0) return;
  if (!confirm("این پست حذف شود؟")) return;
  state.posts.splice(editIndex, 1);
  renderList();
  showView("list");
  toast("پست حذف شد — «انتشار» را بزن", true);
});
$("btn-savecfg").addEventListener("click", () => {
  const cfg = {
    token: $("s-token").value.trim(),
    owner: $("s-owner").value.trim(),
    site: $("s-site").value.trim(),
    src: $("s-src").value.trim()
  };
  if (!cfg.token || !cfg.owner) { toast("توکن و نام کاربری الزامی است", false); return; }
  saveCfg(cfg);
  showView("list");
  setStatus("تنظیمات ذخیره شد", "ok");
  toast("تنظیمات ذخیره شد — «همگام‌سازی» را بزن", true);
});

function openSettings() {
  const c = loadCfg();
  $("s-token").value = c.token || "";
  $("s-owner").value = c.owner || "ErfanShTrainer";
  $("s-site").value = c.site || "ErfanShTrainer.github.io";
  $("s-src").value = c.src || "ErfanShTrainer-src";
  showView("settings");
}

/* ---------- همگام‌سازی ---------- */

async function syncAll() {
  const cfg = loadCfg();
  if (!cfg.token || !cfg.owner) { openSettings(); toast("اول تنظیمات را کامل کن", false); return; }
  overlay("در حال همگام‌سازی…", true);
  try {
    const js = await getFile(cfg.owner, cfg.src, "script.js");
    const idx = await getFile(cfg.owner, cfg.site, "index.html");
    const min = await getFile(cfg.owner, cfg.site, "script.min.js");
    const posts = parseScriptJs(js.content);
    if (posts === null) throw new Error("خطا در خواندن لیست پست‌ها");
    state = {
      posts, scriptJs: js.content, scriptJsSha: js.sha,
      indexHtml: idx.content, indexHtmlSha: idx.sha, minSha: min.sha
    };
    renderList();
    setStatus(`همگام شد — ${posts.length} پست`, "ok");
    toast(`همگام شد — ${posts.length} پست`, true);
  } catch (err) {
    setStatus("خطا در همگام‌سازی", "err");
    toast("خطا: " + err.message, false);
  } finally {
    overlay("", false);
  }
}

/* ---------- انتشار ---------- */

async function publishAll() {
  const cfg = loadCfg();
  if (!state.scriptJs || !state.indexHtml) { toast("اول «همگام‌سازی» را بزن", false); return; }
  overlay("در حال ساخت نسخه‌ی امن…", true);
  try {
    const newBlock = buildBlock(state.posts);
    const newScriptJs = replaceBlock(state.scriptJs, newBlock);

    const res = await buildMinified(newScriptJs);
    if (!res.ok) throw new Error("بیلد: " + (res.error || "خطای ناشناخته"));
    const min = res.code + "\n";

    const ver = Math.random().toString(36).slice(2, 10);
    const newHtml = state.indexHtml.replace(/script\.min\.js\?v=[0-9a-zA-Z]+/, "script.min.js?v=" + ver);

    overlay("در حال انتشار به گیت‌هاب…", true);
    await putFile(cfg.owner, cfg.src, "script.js", newScriptJs, state.scriptJsSha, "update posts (mobile)");
    await putFile(cfg.owner, cfg.site, "script.min.js", min, state.minSha, "update posts (mobile)");
    await putFile(cfg.owner, cfg.site, "index.html", newHtml, state.indexHtmlSha, "update posts (mobile)");

    setStatus("✅ منتشر شد!", "ok");
    toast("✅ منتشر شد — سایت تا یکی دو دقیقه دیگر به‌روز می‌شود", true);
    await syncAll();
  } catch (err) {
    setStatus("خطا در انتشار", "err");
    toast("خطا: " + err.message, false);
  } finally {
    overlay("", false);
  }
}

/* ---------- راه‌اندازی ---------- */

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

const cfg = loadCfg();
if (!cfg.token) {
  openSettings();
} else {
  renderList();
  syncAll();
}
