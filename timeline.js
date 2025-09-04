let realGetAll = null;
let langData = null;

async function getCurrentLangData() {
  if (langData) {
    return Promise.resolve(langData);
  }
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(["lang"], (result) => {
      const currentLang = result.lang || "zh";
      fetch(chrome.runtime.getURL(`lang/${currentLang}.json`))
        .then((res) => res.json())
        .then((data) => {
          langData = data;
          resolve(data);
        })
        .catch((e) => {
          console.error("加载语言文件失败:", e);
          reject(e);
        });
    });
  });
}

async function updateTexts() {
  await getCurrentLangData();

  document.querySelectorAll("[data-key]").forEach((el) => {
    const key = el.getAttribute("data-key");
    if (langData[key]) {
      el.textContent = langData[key];
      el.placeholder = langData[key];
    }
  });
}

try {
  // @ts-ignore
  const mod = await import("../utils/db.js");
  if (mod && typeof mod.getAllScreenshots === "function") {
    realGetAll = mod.getAllScreenshots;
  }
} catch (err) {
  // ignore: use mock
}

// ---------- Mock data (only used if no db) ----------
function mockBlob(color) {
  const canvas = document.createElement("canvas");
  canvas.width = 600;
  canvas.height = 340;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 32px system-ui";
  ctx.fillText("Mock Screenshot", 20, 60);
  return new Promise((res) => canvas.toBlob((b) => res(b), "image/png", 0.92));
}

async function generateMock(n = 60) {
  const handles = ["@alice", "@bob", "@charlie", "@dora", "@eve", "@frank"];
  const userIds = ["1001", "1002", "1003", "1004", "1005", "1006"];
  const colors = [
    "#60a5fa",
    "#f97316",
    "#10b981",
    "#f43f5e",
    "#a78bfa",
    "#22d3ee",
  ];
  const list = [];
  for (let i = 0; i < n; i++) {
    const idx = i % userIds.length;
    const blob = await mockBlob(colors[idx]);
    list.push({
      id: crypto.randomUUID(),
      date: new Date(
        Date.now() - Math.random() * 1000 * 60 * 60 * 24 * 14
      ).toISOString(),
      userId: userIds[idx],
      handle: handles[idx],
      blob,
    });
  }
  return list;
}

// Unified getter with cache
let _cache = null;
async function getScreenshots() {
  if (_cache) return _cache;
  if (realGetAll) {
    _cache = await realGetAll();
  } else {
    _cache = await generateMock(120);
  }
  // normalize + sort desc
  _cache.sort((a, b) => new Date(b.date) - new Date(a.date));
  return _cache;
}

// ---------- DOM helpers ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleString();
}

function createObjURL(blob) {
  const url = URL.createObjectURL(blob);
  _urls.add(url);
  return url;
}
const _urls = new Set();
function revokeAllURLs() {
  for (const u of _urls) URL.revokeObjectURL(u);
  _urls.clear();
}

function setActiveTab(name) {
  $$(".tab-button").forEach((t) =>
    t.classList.toggle("active", t.dataset.tab === name)
  );
  $$(".tab-content").forEach((c) =>
    c.classList.toggle("hidden", c.id !== name)
  );
}

// ---------- Filters ----------
let filterUserId = null;
let kw = "";
let startDate = null;
let endDate = null;

function applyFilters(items) {
  return items.filter((i) => {
    if (filterUserId && i.userId !== filterUserId) return false;
    if (kw) {
      const text = (i.userId + " " + i.handle).toLowerCase();
      if (!text.includes(kw.toLowerCase())) return false;
    }
    if (startDate) {
      const t = new Date(i.date).setHours(0, 0, 0, 0);
      if (t < startDate) return false;
    }
    if (endDate) {
      const t = new Date(i.date).setHours(0, 0, 0, 0);
      if (t > endDate) return false;
    }
    return true;
  });
}

function showFilterBar() {
  const bar = $("#filterBar");
  if (filterUserId) {
    bar.classList.remove("hidden");
    $("#filterText").textContent = `userId = ${filterUserId}`;
  } else {
    bar.classList.add("hidden");
  }
}

// ---------- Timeline (infinite scroll) ----------
const PAGE_SIZE = 30;
let _all = [];
let _filtered = [];
let _page = 0;
let _observer = null;
let _axisDates = new Set();
let _scrollObserver = null;

function clearTimeline() {
  $("#timeline-grid").innerHTML = "";
  _page = 0;
  revokeAllURLs();
}

function renderCard(item) {
  const wrap = document.createElement("article");
  wrap.className = "timeline-card glass rounded-2xl p-3 space-y-2";

  // 给卡片打上 data-date 属性，用来和时间轴对应
  const dateStr = item.date.split("T")[0]; // 取 YYYY-MM-DD
  wrap.dataset.date = dateStr;

  wrap.innerHTML = `
    <div class="text-sm text-slate-700">
     @<span class="font-medium">${item.handle}</span>
    </div>
    <div class="flex items-center justify-between text-xs text-slate-500">
      <time>${formatTime(item.date)}</time>
      <button class="timeline-user text-blue-700 hover:text-blue-600 font-medium" data-userid="${
        item.userId
      }">
        userId: ${item.userId}
      </button>
    </div>
  `;

  const img = document.createElement("img");
  img.className = "thumb rounded-xl w-full h-auto";
  img.loading = "lazy";
  img.decoding = "async";
  img.src = createObjURL(item.blob);
  img.alt = `screenshot of ${item.handle}`;
  wrap.appendChild(img);

  // click: lightbox
  img.addEventListener("click", () => openLightbox(img.src));

  // click user
  wrap.querySelector(".timeline-user").addEventListener("click", (e) => {
    filterUserId = e.currentTarget.dataset.userid;
    showFilterBar();
    rebuildTimeline();
  });

  return wrap;
}

function appendNextPage() {
  const grid = $("#timeline-grid");
  const start = _page * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, _filtered.length);
  for (let i = start; i < end; i++) {
    const card = renderCard(_filtered[i]);
    grid.appendChild(card);

    // 收集日期并添加到时间轴
    const date = card.dataset.date;
    if (!_axisDates.has(date)) {
      _axisDates.add(date);
      addAxisNode(date);
    }
  }

  const axis = $("#timeline-axis");
  if (axis && _axisDates.size > 0) {
    axis.classList.remove("hidden");
  }

  _page++;
  if (end >= _filtered.length) {
    $("#sentinel").textContent = "没有更多了";
    if (_observer) _observer.disconnect();
  } else {
    $("#sentinel").textContent = "下拉加载更多…";
  }
  setupTimelineScrollObserver();
}

async function rebuildTimeline() {
  if (!_all.length) _all = await getScreenshots();
  _filtered = applyFilters(_all);
  clearTimeline();
  _axisDates = new Set();
  appendNextPage();
  setupInfiniteScroll();
}

function setupInfiniteScroll() {
  if (_observer) _observer.disconnect();
  _observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) appendNextPage();
    },
    { rootMargin: "600px 0px" }
  );
  _observer.observe($("#sentinel"));
}

function addAxisNode(date) {
  const axis = $("#timeline-axis");
  const node = document.createElement("div");
  node.className =
    "axis-node flex flex-col items-center py-2 text-xs text-slate-400";
  node.dataset.date = date;
  node.innerHTML = `
    <div class="w-2 h-2 rounded-full bg-slate-400 mb-1 transition-colors"></div>
    <span>${date}</span>
  `;
  axis.appendChild(node);
}

function setupTimelineScrollObserver() {
  const cards = document.querySelectorAll("#timeline-grid .timeline-card");
  const axisNodes = document.querySelectorAll("#timeline-axis .axis-node");

  if (_scrollObserver) _scrollObserver.disconnect();

  _scrollObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const date = entry.target.dataset.date;
          axisNodes.forEach((n) => {
            n.querySelector("div").classList.remove("bg-blue-500");
            if (n.dataset.date === date) {
              n.querySelector("div").classList.add("bg-blue-500");
            }
          });
        }
      });
    },
    { threshold: 0.5 }
  );

  cards.forEach((c) => _scrollObserver.observe(c));
}

// ---------- Stats ----------
function groupByDay(items) {
  const map = new Map();
  for (const it of items) {
    const d = new Date(it.date);
    const key = d.toLocaleDateString();
    map.set(key, (map.get(key) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => new Date(a.day) - new Date(b.day));
}

function renderStatCards(items) {
  const users = new Set(items.map((i) => i.userId));
  const byDay = groupByDay(items);
  const maxDay = byDay.reduce((m, x) => Math.max(m, x.count), 0);
  const el = $("#stats-cards");
  el.innerHTML = `
    <div class="glass rounded-2xl p-4">
      <div class="text-slate-500 text-sm">总截图数</div>
      <div class="text-2xl font-semibold">${items.length}</div>
    </div>
    <div class="glass rounded-2xl p-4">
      <div class="text-slate-500 text-sm">用户数</div>
      <div class="text-2xl font-semibold">${users.size}</div>
    </div>
    <div class="glass rounded-2xl p-4">
      <div class="text-slate-500 text-sm">最忙的一天</div>
      <div class="text-lg font-medium">${
        byDay.length
          ? byDay.reduce((a, b) => (a.count > b.count ? a : b)).day
          : "-"
      }</div>
    </div>
    <div class="glass rounded-2xl p-4">
      <div class="text-slate-500 text-sm">单日峰值</div>
      <div class="text-2xl font-semibold">${maxDay}</div>
    </div>
  `;
}

function renderDailyChart(items) {
  const data = groupByDay(items);
  const cvs = document.getElementById("dailyChart");
  const ctx = cvs.getContext("2d");
  // clear
  ctx.clearRect(0, 0, cvs.width, cvs.height);
  const W = (cvs.width = cvs.clientWidth);
  const H = (cvs.height = cvs.height);
  const pad = 28;
  const max = Math.max(1, ...data.map((d) => d.count));
  const stepX = (W - pad * 2) / Math.max(1, data.length - 1);
  // axes
  ctx.strokeStyle = "rgba(0,0,0,0.1)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, pad);
  ctx.lineTo(pad, H - pad);
  ctx.lineTo(W - pad, H - pad);
  ctx.stroke();
  // line
  ctx.beginPath();
  for (let i = 0; i < data.length; i++) {
    const x = pad + i * stepX;
    const y = H - pad - (data[i].count / max) * (H - pad * 2);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#0A84FF";
  ctx.stroke();
  // dots
  for (let i = 0; i < data.length; i++) {
    const x = pad + i * stepX;
    const y = H - pad - (data[i].count / max) * (H - pad * 2);
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#0A84FF";
    ctx.fill();
  }
}

// ---------- Ranking ----------
function renderRanking(items) {
  const map = new Map();
  for (const it of items) map.set(it.userId, (map.get(it.userId) || 0) + 1);
  const arr = Array.from(map.entries()).sort((a, b) => b[1] - a[1]);

  const root = document.getElementById("ranking-content");
  root.innerHTML = "";

  const list = document.createElement("div");
  list.className = "space-y-2";

  arr.forEach(([uid, count], idx) => {
    const row = document.createElement("div");
    row.className =
      "flex items-center justify-between p-2 rounded-lg transition-colors";

    if (idx === 0) row.classList.add("bg-yellow-100");
    else if (idx === 1) row.classList.add("bg-gray-100");
    else if (idx === 2) row.classList.add("bg-amber-50");

    row.innerHTML = `
      <div class="flex items-center space-x-3">
        <span class="text-lg font-bold text-slate-700">#${idx + 1}</span>
        <button class="text-blue-700 hover:underline font-medium" data-userid="${uid}">
          userId: ${uid}
        </button>
      </div>
      <span class="text-sm text-slate-600">截图数量: ${count}</span>
    `;

    list.appendChild(row);
  });

  root.appendChild(list);

  root.querySelectorAll("[data-userid]").forEach((el) => {
    el.addEventListener("click", (e) => {
      filterUserId = e.currentTarget.dataset.userid;
      setActiveTab("timeline");
      showFilterBar();
      rebuildTimeline();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

// ---------- Lightbox ----------
function openLightbox(src) {
  const lightbox = document.createElement("div");
  lightbox.className = "lightbox";

  const img = document.createElement("img");
  img.src = src;

  const closeBtn = document.createElement("span");
  closeBtn.className = "lightbox-close";
  closeBtn.innerHTML = "&times;"; // ×

  closeBtn.addEventListener("click", () => {
    document.body.removeChild(lightbox);
  });

  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) {
      document.body.removeChild(lightbox);
    }
  });

  lightbox.appendChild(img);
  lightbox.appendChild(closeBtn);
  document.body.appendChild(lightbox);
}

// ---------- Back to top ----------
const backTop = document.getElementById("backTop");
window.addEventListener("scroll", () => {
  if (window.scrollY > 600) backTop.classList.remove("hidden");
  else backTop.classList.add("hidden");
});
backTop.addEventListener("click", () =>
  window.scrollTo({ top: 0, behavior: "smooth" })
);

// ---------- Tabs & Filters events ----------
document.querySelectorAll(".tab-button").forEach((tab) => {
  tab.addEventListener("click", async () => {
    const name = tab.dataset.tab;
    setActiveTab(name);
    if (name === "timeline") {
      await rebuildTimeline();
    } else if (name === "stats") {
      const items = await getScreenshots();
      renderStatCards(items);
      renderDailyChart(items);
    } else if (name === "top3") {
      const items = await getScreenshots();
      renderTop3(items);
    } else if (name === "ranking") {
      const items = await getScreenshots();
      renderRanking(items);
    }
  });
});

document.getElementById("clearUser").addEventListener("click", () => {
  filterUserId = null;
  showFilterBar();
  rebuildTimeline();
});

document.getElementById("clearFilters").addEventListener("click", () => {
  filterUserId = null;
  kw = "";
  startDate = null;
  endDate = null;
  const kwInput = document.getElementById("kw");
  kwInput.value = "";
  document.getElementById("startDate").value = "";
  document.getElementById("endDate").value = "";
  showFilterBar();
  rebuildTimeline();
});

document.getElementById("kw").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    kw = e.currentTarget.value.trim();
    rebuildTimeline();
  }
});
document.getElementById("startDate").addEventListener("change", (e) => {
  const v = e.currentTarget.value;
  startDate = v ? new Date(v).setHours(0, 0, 0, 0) : null;
  rebuildTimeline();
});
document.getElementById("endDate").addEventListener("change", (e) => {
  const v = e.currentTarget.value;
  endDate = v ? new Date(v).setHours(0, 0, 0, 0) : null;
  rebuildTimeline();
});

// ---------- Init (lazy: only timeline first) ----------
updateTexts();
setActiveTab("timeline");
await rebuildTimeline();

// Cleanup
window.addEventListener("beforeunload", revokeAllURLs);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.lang) {
    langData = null;
    updateTexts();
  }
});
