const DURATION = 8000; // مدت هر مرحله (میلی‌ثانیه)
const STREAMS = 4; // تعداد اتصال همزمان
const BASE = "https://speed.cloudflare.com";
const $ = (id) => document.getElementById(id);
const fa = (n, d) =>
  n.toLocaleString("fa-IR", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
const fmt = (n) => fa(n, n >= 100 ? 0 : 2);

/* ---------- Gauge ---------- */
const CX = 150,
  CY = 150,
  R = 118,
  A0 = 135,
  SWEEP = 270;
const TICKS = [0, 5, 10, 50, 100, 250, 500, 750, 1000];
const pt = (a, r) => [
  CX + r * Math.cos((a * Math.PI) / 180),
  CY + r * Math.sin((a * Math.PI) / 180),
];
function arcPath() {
  const [x1, y1] = pt(A0, R),
    [x2, y2] = pt(A0 + SWEEP, R);
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${R} ${R} 0 1 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}
$("arcTrack").setAttribute("d", arcPath());
$("arcProg").setAttribute("d", arcPath());
TICKS.forEach((v, i) => {
  const [x, y] = pt(A0 + (i * SWEEP) / (TICKS.length - 1), R - 30);
  const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
  t.setAttribute("x", x);
  t.setAttribute("y", y);
  t.setAttribute("class", "tick");
  t.textContent = v.toLocaleString("fa-IR");
  $("ticks").appendChild(t);
});
function frac(v) {
  // سرعت → بخشی از کمان (مقیاس غیرخطی مثل Ookla)
  v = Math.max(0, Math.min(1000, v));
  for (let i = 1; i < TICKS.length; i++) {
    if (v <= TICKS[i])
      return (
        (i - 1 + (v - TICKS[i - 1]) / (TICKS[i] - TICKS[i - 1])) /
        (TICKS.length - 1)
      );
  }
  return 1;
}
function setGauge(v, color) {
  const f = frac(v);
  $("needle").style.transform = `rotate(${A0 + f * SWEEP}deg)`;
  $("arcProg").setAttribute("stroke-dasharray", `${(f * 100).toFixed(2)} 100`);
  if (color) $("arcProg").style.stroke = color;
  $("num").textContent = v > 0 ? fmt(v) : fa(0, 0);
}

/* ---------- Test engine ---------- */
function runPhase(startWorker, onValue) {
  return new Promise((resolve, reject) => {
    let bytes = 0,
      t0 = performance.now(),
      stopped = false,
      failed = 0;
    const controllers = [];
    const add = (n) => {
      bytes += n;
    };
    const tick = setInterval(() => {
      const s = (performance.now() - t0) / 1000;
      if (s > 0.3) onValue((bytes * 8) / 1e6 / s);
    }, 200);
    const finish = () => {
      stopped = true;
      clearInterval(tick);
      controllers.forEach((c) => c.abort());
      const s = (performance.now() - t0) / 1000;
      if (bytes === 0) return reject(new Error("no data"));
      resolve((bytes * 8) / 1e6 / s);
    };
    setTimeout(() => {
      if (!stopped) finish();
    }, DURATION);
    for (let i = 0; i < STREAMS; i++) {
      startWorker(
        add,
        () => stopped,
        (c) => controllers.push(c),
        () => {
          if (++failed === STREAMS && !stopped) {
            stopped = true;
            clearInterval(tick);
            reject(new Error("fail"));
          }
        },
      );
    }
  });
}

function downloadWorker(add, isStopped, reg, onFail) {
  (async () => {
    while (!isStopped()) {
      const ctrl = new AbortController();
      reg(ctrl);
      try {
        const res = await fetch(
          `${BASE}/__down?bytes=25000000&r=${Math.random()}`,
          { cache: "no-store", signal: ctrl.signal },
        );
        const reader = res.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          add(value.length);
        }
      } catch (e) {
        if (!isStopped()) onFail();
        return;
      }
    }
  })();
}

function uploadWorker(add, isStopped, reg, onFail) {
  const chunk = new Uint8Array(65536),
    parts = [];
  for (let i = 0; i < 128; i++) {
    crypto.getRandomValues(chunk);
    parts.push(chunk.slice());
  }
  const blob = new Blob(parts); // 8MB
  (function send() {
    if (isStopped()) return;
    const xhr = new XMLHttpRequest();
    reg({ abort: () => xhr.abort() });
    let last = 0;
    xhr.open("POST", `${BASE}/__up?r=${Math.random()}`);
    xhr.upload.onprogress = (e) => {
      add(e.loaded - last);
      last = e.loaded;
    };
    xhr.onload = send;
    xhr.onerror = () => {
      if (!isStopped()) onFail();
    };
    xhr.send(blob);
  })();
}

/* ---------- Flow ---------- */
const show = (id) => {
  document
    .querySelectorAll(".screen")
    .forEach((s) => s.classList.remove("show"));
  $(id).classList.add("show");
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const COL_DL =
  getComputedStyle(document.documentElement).getPropertyValue("--dl").trim() ||
  "#14c9be";
const COL_UL =
  getComputedStyle(document.documentElement).getPropertyValue("--ul").trim() ||
  "#a855f7";

async function start() {
  $("err").hidden = true;
  $("tvDl").textContent = "—";
  $("tvUl").textContent = "—";
  $("tabDl").classList.add("active");
  $("tabUl").classList.remove("active");
  setGauge(0, COL_DL);
  $("status").textContent = "در حال اندازه‌گیری پینگ…";
  show("test");
  await sleep(400);
  try {
    const pj = await measurePing();
    if (!pj) throw new Error("ping");
    $("status").textContent = "در حال تست سرعت دانلود…";
    const d = await runPhase(downloadWorker, (v) => setGauge(v, COL_DL));
    setGauge(d, COL_DL);
    $("tvDl").textContent = fmt(d);
    await sleep(700);

    $("tabDl").classList.remove("active");
    $("tabUl").classList.add("active");
    $("status").textContent = "در حال تست سرعت آپلود…";
    setGauge(0, COL_UL);
    await sleep(700);
    const u = await runPhase(uploadWorker, (v) => setGauge(v, COL_UL));
    setGauge(u, COL_UL);
    $("tvUl").textContent = fmt(u);
    await sleep(900);

    $("rDl").textContent = fmt(d);
    $("rUl").textContent = fmt(u);
    $("rPing").textContent = fmtMs(pj.ping);
    $("rJit").textContent = fmtMs(pj.jitter);
    lastResult = {
      d,
      u,
      ping: pj.ping,
      jitter: pj.jitter,
      testId: uuid(),
    };
    renderActs(lastResult);
    resetSurvey();
    show("result");
    animateDots();
  } catch (e) {
    show("home");
    $("err").textContent =
      "اتصال به سرور تست برقرار نشد. اینترنت خود را بررسی کنید و دوباره تلاش کنید.";
    $("err").hidden = false;
  }
}
/* ---------- Ping & Jitter ---------- */
let lastResult = null;
const fmtMs = (x) => fa(x, x < 10 ? 1 : 0);

async function measurePing() {
  const s = [];
  for (let i = 0; i < 11; i++) {
    const t = performance.now();
    try {
      await fetch(`${BASE}/__down?bytes=0&r=${Math.random()}`, {
        cache: "no-store",
      });
    } catch (e) {
      break;
    }
    s.push(performance.now() - t);
  }
  s.shift(); // نمونه اول شامل زمان برقراری اتصال است
  if (!s.length) return null;
  const sorted = [...s].sort((a, b) => a - b);
  const ping = sorted[Math.floor(sorted.length / 2)];
  let jitter = 0;
  for (let i = 1; i < s.length; i++) jitter += Math.abs(s[i] - s[i - 1]);
  jitter = s.length > 1 ? jitter / (s.length - 1) : 0;
  return { ping, jitter };
}

/* ---------- IP & Server ---------- */
const info = { ip: "", isp: "", asn: null, colo: "", loaded: false };
const ICON_USER =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>';
const ICON_SERVER =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="6" rx="2"/><rect x="4" y="11" width="16" height="6" rx="2"/><path d="M8 6h.01M8 14h.01M7 21h10"/></svg>';
function renderInfo() {
  const wait = "در حال شناسایی…";
  const html = `
    <div class="it"><span class="ico">${ICON_USER}</span><div>
      <b>${info.loaded ? esc(info.ip) || "—" : wait}</b><small>${esc(info.isp)}</small></div></div>
    <div class="it"><span class="ico">${ICON_SERVER}</span><div>
      <b>${info.loaded ? "Cloudflare" : wait}</b><small>${info.colo ? "Data center: " + esc(info.colo) : ""}</small></div></div>`;
  document
    .querySelectorAll("[data-info]")
    .forEach((el) => (el.innerHTML = html));
}

// qwen fix bug - start
async function loadInfo() {
  try {
    const m = await (await fetch(`${BASE}/meta`, { cache: "no-store" })).json();

    info.ip = String(m.clientIp || "");
    info.isp = String(m.asOrganization || "");
    info.asn = Number(m.asn) || null;

    if (typeof m.colo === "object" && m.colo !== null) {
      info.colo = m.colo.iata || m.colo.city || "Unknown";
    } else {
      info.colo = String(m.colo || "");
    }
  } catch (e) {
    try {
      const t = await (
        await fetch(`${BASE}/cdn-cgi/trace`, { cache: "no-store" })
      ).text();
      const g = (k) =>
        (t.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1] || "";
      info.ip = g("ip");
      info.colo = g("colo");
    } catch (e2) {}
  }
  info.loaded = true;
  renderInfo();
}
// qwen fix bug - finish

/* ---------- Save result as image ---------- */
async function saveImage() {
  if (!lastResult) return;
  try {
    await Promise.all([
      document.fonts.load("300 60px Vazirmatn"),
      document.fonts.load("500 30px Vazirmatn"),
    ]);
  } catch (e) {}
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  const W = 1000,
    H = 1130,
    F = "Vazirmatn, Tahoma, sans-serif";
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  const box = (x, y, w, h, r, fill) => {
    g.beginPath();
    g.roundRect(x, y, w, h, r);
    g.fillStyle = fill;
    g.fill();
  };
  const T = (s, x, y, size, wt, col, dir = "rtl") => {
    g.font = `${wt} ${size}px ${F}`;
    g.fillStyle = col;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.direction = dir;
    g.fillText(s, x, y);
  };
  box(0, 0, W, H, 0, v("--bg"));
  box(40, 40, 920, 1050, 40, v("--card"));
  T("نتیجه تست سرعت اینترنت", 500, 115, 42, 500, v("--text"));
  T(new Date().toLocaleString("fa-IR"), 500, 168, 24, 300, v("--muted"));

  const { d, u, ping, jitter } = lastResult;
  [
    ["دانلود", d, v("--dl"), 80],
    ["آپلود", u, v("--ul"), 520],
  ].forEach(([l, val, col, x]) => {
    box(x, 220, 400, 300, 30, v("--bg"));
    T(l, x + 200, 275, 28, 500, v("--muted"));
    T(fmt(val), x + 200, 385, 96, 300, col);
    T("Mbps", x + 200, 475, 26, 300, v("--muted"), "ltr");
  });
  [
    ["پینگ", ping, 80],
    ["جیتر", jitter, 520],
  ].forEach(([l, val, x]) => {
    box(x, 560, 400, 130, 26, v("--bg"));
    T(l, x + 200, 598, 24, 500, v("--muted"));
    T(fmtMs(val) + " ms", x + 200, 650, 44, 300, v("--text"), "ltr");
  });
  T("آی‌پی شما", 500, 745, 24, 500, v("--muted"));
  T(
    (info.ip || "—") + (info.isp ? "  ·  " + info.isp : ""),
    500,
    790,
    30,
    400,
    v("--text"),
    "ltr",
  );
  T("سرور تست", 500, 865, 24, 500, v("--muted"));
  T(
    "Cloudflare" + (info.colo ? "  ·  " + info.colo : ""),
    500,
    910,
    30,
    400,
    v("--text"),
    "ltr",
  );
  g.fillStyle = v("--border");
  g.fillRect(120, 970, 760, 2);
  T("ساخته شده با ♥ توسط محمدرضا یعقوبی", 500, 1025, 26, 300, v("--muted"));

  c.toBlob((b) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = "speedtest-result.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }, "image/png");
}

/* ---------- Helpers ---------- */
const esc = (x) =>
  String(x == null ? "" : x).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64;
  b[8] = (b[8] & 63) | 128;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/* ---------- Activity scores (1 to 5) ---------- */
const tierUp = (v, cuts) => cuts.reduce((s, c) => s + (v >= c ? 1 : 0), 1); // higher is better
const tierLow = (v, cuts) => cuts.reduce((s, c) => s - (v > c ? 1 : 0), 5); // lower is better
function activityScores({ d, u, ping, jitter }) {
  const m = Math.min(d, u);
  const jit = tierLow(jitter, [5, 10, 20, 40]);
  return {
    web: Math.min(
      tierUp(d, [0.5, 2, 5, 10]),
      tierLow(ping, [100, 200, 350, 600]),
    ),
    game: Math.min(
      tierUp(m, [0.25, 0.6, 1.5, 4]),
      tierLow(ping, [20, 40, 70, 120]),
      jit,
    ),
    stream: tierUp(d, [1.5, 3, 5, 25]),
    call: Math.min(
      tierUp(m, [0.5, 1, 1.8, 3]),
      tierLow(ping, [80, 150, 250, 400]),
      jit,
    ),
  };
}
const ACT_NAMES = {
  web: "وب‌گردی",
  game: "بازی آنلاین",
  stream: "استریم ویدیو",
  call: "تماس تصویری",
};
const LEVELS = ["", "بسیار ضعیف", "ضعیف", "متوسط", "خوب", "عالی"];
const ACT_ICONS = {
  web: '<rect x="3" y="4" width="18" height="15" rx="2.5"/><path d="M3 8.5h18M6 6.3h.01M8.5 6.3h.01"/><rect x="6" y="11" width="5" height="5" rx="1"/><path d="M14 12h4M14 15h3"/>',
  game: '<path d="M7 8h10a4.5 4.5 0 0 1 4.4 5.4l-.7 3.4a2.6 2.6 0 0 1-4.4 1.3L14.5 16h-5l-1.8 2.1a2.6 2.6 0 0 1-4.4-1.3l-.7-3.4A4.5 4.5 0 0 1 7 8z"/><path d="M8 10.5v3M6.5 12h3M15.5 11h.01M17.5 13h.01"/>',
  stream:
    '<rect x="3" y="4.5" width="18" height="13" rx="2.5"/><path d="M10 8.5v5l4.2-2.5z"/><path d="M6 20h12"/>',
  call: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="12" cy="10" r="2.6"/><path d="M7 18c.4-2.6 2.6-3.7 5-3.7s4.6 1.1 5 3.7"/>',
};
function renderActs(r) {
  const sc = activityScores(r);
  $("acts").innerHTML = Object.keys(ACT_NAMES)
    .map(
      (k) => `
    <div class="act" title="${ACT_NAMES[k]}: ${LEVELS[sc[k]]}">
      <svg viewBox="0 0 24 24" aria-hidden="true">${ACT_ICONS[k]}</svg>
      <div class="nm">${ACT_NAMES[k]}</div>
      <div class="dots" role="img" aria-label="${sc[k].toLocaleString("fa-IR")} از ۵">${[1, 2, 3, 4, 5].map((i) => `<i ${i <= sc[k] ? "data-on" : ""}></i>`).join("")}</div>
      <div class="lv">${LEVELS[sc[k]]}</div>
    </div>`,
    )
    .join("");
}
function animateDots() {
  setTimeout(
    () =>
      document
        .querySelectorAll("#acts .dots i[data-on]")
        .forEach((el, i) => setTimeout(() => el.classList.add("on"), i * 45)),
    300,
  );
}

/* ---------- Survey (1 to 10) ---------- */
const SURVEY_MIN = 1,
  SURVEY_MAX = 10;
const SURVEY_ENDPOINT = ""; // بعداً: مثلاً "/api/survey.php" (با PHP و MySQL)
function resetSurvey() {
  const name = info.isp || "ارائه‌دهنده اینترنت خود";
  $("svTitle").textContent =
    `چقدر احتمال دارد ${name} را به دوست یا همکارتان پیشنهاد کنید؟`;
  $("survey").classList.remove("thanks");
  const sc = $("scale");
  sc.classList.remove("done");
  sc.innerHTML = "";
  for (let i = SURVEY_MIN; i <= SURVEY_MAX; i++) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.v = i;
    b.textContent = i.toLocaleString("fa-IR");
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", "false");
    sc.appendChild(b);
  }
  $("svNote").hidden = !SURVEY_ENDPOINT;
}
function buildSurveyPayload(score) {
  // ساختار تخت (flat): هر کلید = یک ستون MySQL
  const r = lastResult;
  return {
    schema_version: 1,
    test_id: r.testId, // UUID یکتا برای جلوگیری از ثبت تکراری
    submitted_at_utc: new Date().toISOString().slice(0, 19).replace("T", " "), // آماده DATETIME
    score: score, // عدد صحیح ۱ تا ۱۰
    provider_name: info.isp || null,
    provider_asn: info.asn || null,
    server_colo: info.colo || null,
    download_mbps: +r.d.toFixed(2),
    upload_mbps: +r.u.toFixed(2),
    ping_ms: +r.ping.toFixed(1),
    jitter_ms: +r.jitter.toFixed(1),
  };
}
async function submitSurvey(payload) {
  console.info("survey payload:", payload);
  if (!SURVEY_ENDPOINT) return;
  try {
    await fetch(SURVEY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch (e) {}
}
$("scale").addEventListener("click", (e) => {
  const b = e.target.closest("button"),
    sc = $("scale");
  if (!b || sc.classList.contains("done") || !lastResult) return;
  sc.classList.add("done");
  sc.querySelectorAll("button").forEach((x) =>
    x.setAttribute("aria-checked", x === b ? "true" : "false"),
  );
  b.classList.add("sel");
  $("survey").classList.add("thanks");
  $("svTitle").textContent = "ممنون از مشارکت شما";
  submitSurvey(buildSurveyPayload(Number(b.dataset.v)));
});

$("go").onclick = start;
$("again").onclick = start;
$("save").onclick = saveImage;
renderInfo();
loadInfo();
