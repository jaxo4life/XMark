// follows.js — 关注变动（极简版：月历 + 当日「取关我 / 回关我」两列表）
// 数据：IndexedDB followSnapshots（base + delta，delta 含 unfollowed/refollowed fb 翻转）
//      + storage followSummary / twitterNotes。
// 按天聚合：同日多次采集的 unfollowed/refollowed 取并集，日内往返（先取关又回关
// 或反之）双向抵消——只显示当日实质变化。
// v6.6.0 旧双列表 delta（added/removed 嵌套格式）无 fb 翻转数据，自然不产事件。

import { getFollowSnapshots, dayKey } from "./utils/db.js";

let langData = {};
let snaps = []; // 升序（id=ISO 时刻）
let notes = {};
let curMonth = ""; // YYYY-MM（当前显示月）
let selDay = ""; // YYYY-MM-DD（选中日）

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const t = (k, fb) => langData[k] || fb;
const fmt = (k, fb, vars) =>
  String(t(k, fb)).replace(/\{(\w+)\}/g, (_, n) =>
    vars?.[n] !== undefined ? vars[n] : `{${n}}`
  );
const dayLocal = () => dayKey(Date.now());
const isZh = () => (localStorage.getItem("lang") || "zh") === "zh";

async function loadLang() {
  const lang = localStorage.getItem("lang") || "zh";
  try {
    langData = await (
      await fetch(chrome.runtime.getURL(`lang/${lang}.json`))
    ).json();
  } catch (_) {}
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  document.querySelectorAll("[data-key]").forEach((n) => {
    const v = langData[n.dataset.key];
    if (v) n.textContent = v;
  });
}

function findNote(u) {
  if (notes[u.id]) return notes[u.id];
  const byName = Object.values(notes).find((n) => n && n.username === u.h);
  return byName || null;
}

// ---------- 今日状态 ----------
async function renderTodayState() {
  let s = {};
  try {
    s = (await chrome.runtime.sendMessage({ action: "followStatus" })) || {};
  } catch (_) {}
  const box = $("ftTodayState");
  box.textContent = "";
  if (s.state === "collecting") {
    box.append(
      el("span", "ft-busy-dot"),
      el("span", "", `${t("ftStateCollecting", "正在采集")}${s.cur ? " " + s.cur : ""}`)
    );
    setTimeout(renderTodayState, 30000);
  } else if (s.state === "done" && s.day === dayLocal()) {
    box.append(el("span", "", t("ftStateDone", "今日已完成")));
  } else if (s.state === "interrupted") {
    box.append(el("span", "", t("ftStateInterrupted", "采集中断，下次启动浏览器自动续跑")));
  } else if (s.state === "cancelled") {
    box.append(el("span", "", t("ftStateCancelled", "今日已取消自动采集，可手动重启")));
  } else if (s.state === "failed") {
    const REASONS = {
      login: t("ftErrLogin", "未登录 X"),
      nosample: t("ftErrNosample", "未取到采集凭证"),
      network: t("ftErrNetwork", "网络异常"),
      timeout: t("ftErrTimeout", "超时截断"),
      nodata: t("ftErrNodata", "未捕获到数据"),
    };
    box.append(
      el("span", "", fmt("ftStateFailed", "采集失败：{reason}", {
        reason: REASONS[s.err] || s.err,
      }))
    );
  }
}

// ---------- 日聚合（净变化）----------
function dayEvents(day) {
  const uf = new Map();
  const rf = new Map();
  for (const r of snaps) {
    if (r.kind !== "delta" || r.id.slice(0, 10) !== day) continue;
    for (const u of r.unfollowed || []) uf.set(u.id, u);
    for (const u of r.refollowed || []) rf.set(u.id, u);
  }
  // 日内往返抵消：先取关又回关（或反之）= 无实质变化
  for (const id of [...uf.keys()])
    if (rf.has(id)) {
      uf.delete(id);
      rf.delete(id);
    }
  return { uf: [...uf.values()], rf: [...rf.values()] };
}

// 有事件的日 → 角标数
function monthMarks() {
  const marks = new Map(); // day -> {uf, rf}
  for (const r of snaps) {
    if (r.kind !== "delta") continue;
    const day = r.id.slice(0, 10);
    const m = marks.get(day) || { uf: 0, rf: 0 };
    m.uf += (r.unfollowed || []).length;
    m.rf += (r.refollowed || []).length;
    marks.set(day, m);
  }
  return marks;
}

// ---------- 月历 ----------
const WEEK = () => (isZh() ? ["一", "二", "三", "四", "五", "六", "日"] : ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]);

function renderCal() {
  const [y, m] = curMonth.split("-").map(Number);
  $("ftMonthLabel").textContent = isZh()
    ? `${y} 年 ${m} 月`
    : new Date(y, m - 1, 1).toLocaleString("en", { month: "long", year: "numeric" });

  const week = $("ftCalWeek");
  week.textContent = "";
  WEEK().forEach((w) => week.append(el("span", "", w)));

  const grid = $("ftCalGrid");
  grid.textContent = "";
  const first = new Date(y, m - 1, 1);
  const offset = (first.getDay() + 6) % 7; // 周一为首
  const days = new Date(y, m, 0).getDate();
  const marks = monthMarks();
  const today = dayLocal();

  for (let i = 0; i < offset; i++) grid.append(el("div", "ft-day blank"));
  for (let d = 1; d <= days; d++) {
    const day = `${curMonth}-${String(d).padStart(2, "0")}`;
    const cell = el("div", "ft-day", String(d));
    if (day === today) cell.classList.add("today");
    if (day === selDay) cell.classList.add("sel");
    const mark = marks.get(day);
    if (mark) {
      if (mark.uf) cell.append(el("span", "dot-uf", String(mark.uf)));
      if (mark.rf) cell.append(el("span", "dot-rf", String(mark.rf)));
    }
    cell.addEventListener("click", () => {
      selDay = day;
      renderCal();
      renderLists();
    });
    grid.append(cell);
  }

  // 月导航禁用：晚于最新事件月不可去（未来无意义）
  const latest = snaps.filter((s) => s.kind === "delta").pop()?.id.slice(0, 7) || curMonth;
  $("ftNextMonth").disabled = curMonth >= latest;
}

// ---------- 两列表 ----------
function userRow(u) {
  const row = el("div", "ft-row");
  const ava = document.createElement("img");
  ava.className = "ft-ava";
  if (u.a) ava.src = u.a;
  ava.alt = "";
  ava.loading = "lazy";
  ava.referrerPolicy = "no-referrer";
  ava.onerror = () => {
    ava.style.visibility = "hidden";
  };
  const main = el("div", "ft-main-u");
  const nameLine = el("div", "ft-name");
  nameLine.append(document.createTextNode(u.n || u.h || u.id));
  if (u.v) nameLine.append(el("span", "v", "✓"));
  main.append(nameLine, el("div", "ft-handle", `@${u.h}`));
  const note = findNote(u);
  if (note?.name) main.append(el("div", "ft-note", `📝 ${note.name}`));
  row.append(ava, main);
  row.title = `@${u.h}${note?.name ? ` · 📝 ${note.name}` : ""}`;
  row.addEventListener("click", () =>
    window.open(`https://x.com/${u.h}`, "_blank", "noopener")
  );
  return row;
}

function renderLists() {
  const box = $("ftLists");
  box.textContent = "";
  if (!selDay) return;
  const { uf, rf } = dayEvents(selDay);
  const make = (cls, titleKey, users, countCls) => {
    const g = el("div", "ft-group");
    const head = el("div", `ft-group-head ${cls}`);
    head.append(
      el("i"),
      el("span", "", t(titleKey, titleKey)),
      el("span", `ft-count ${countCls}`, String(users.length))
    );
    const list = el("div", "ft-list");
    if (!users.length)
      list.append(el("div", "ft-empty", t("ftEmptyGroup", "无变动")));
    else users.forEach((u) => list.append(userRow(u)));
    g.append(head, list);
    return g;
  };
  box.append(
    make("g-uf", "ftQuadUnfollowers", uf, "uf"),
    make("g-rf", "ftQuadRefollowed", rf, "rf")
  );
}

// ---------- 主流程 ----------
async function main() {
  await loadLang();
  snaps = await getFollowSnapshots();
  notes = (await chrome.storage.local.get("twitterNotes")).twitterNotes || {};
  renderTodayState();

  const deltas = snaps.filter((s) => s.kind === "delta");
  if (!deltas.length) {
    const hasBase = snaps.some((s) => s.kind === "base");
    const main_ = document.querySelector(".ft-main");
    main_.textContent = "";
    const empty = el("div", "ft-empty-page");
    empty.textContent = hasBase
      ? t("ftFirstDay", "基底已建立，明日起开始对比变动")
      : t("ftNoData", "暂无数据，完成首次采集后展示");
    main_.append(empty);
    return;
  }

  // 默认：最新事件月 + 选中最新事件日
  const latestDay = deltas[deltas.length - 1].id.slice(0, 10);
  curMonth = latestDay.slice(0, 7);
  selDay = latestDay;

  $("ftPrevMonth").addEventListener("click", () => {
    const [y, m] = curMonth.split("-").map(Number);
    const d = new Date(y, m - 2, 1);
    curMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    selDay = "";
    renderCal();
    renderLists();
  });
  $("ftNextMonth").addEventListener("click", () => {
    const [y, m] = curMonth.split("-").map(Number);
    const d = new Date(y, m, 1);
    curMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    selDay = "";
    renderCal();
    renderLists();
  });

  renderCal();
  renderLists();
}

main().catch((e) => {
  console.error("[XMark follows]", e);
  $("ftTodayState").textContent = String(e?.message || e);
});
