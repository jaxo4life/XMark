// follows.js — 关注变动（按天 · 单页 · 六卡胶囊墙）
// 按天聚合：当天所有 delta 的事件并集（同日关注又取关的人两组都出现——真实发生了两次）；
// 互关两类 = 当天开始前态与当天结束态的交集差集（rebuildFollow 重放）。
// 数据：IndexedDB followSnapshots + storage followSummary / twitterNotes。

import { getFollowSnapshots, rebuildFollow, dayKey } from "./utils/db.js";

let langData = {};
let snaps = []; // 升序（id=ISO 时刻）
let notes = {};

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

// 备注匹配（对齐 content.js getUserNote：userId key 优先，回落 username）
function findNote(u) {
  if (notes[u.id]) return notes[u.id];
  const byName = Object.values(notes).find((n) => n && n.username === u.h);
  return byName || null;
}

// ---------- 今日状态（followSummary，采集中 30s 轮询）----------
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
      el(
        "span",
        "",
        fmt("ftStateCollecting", "正在采集 {phase}", {
          phase:
            s.phase === "following"
              ? t("ftPhaseFollowing", "正在关注")
              : t("ftPhaseFollowers", "粉丝"),
        })
      )
    );
    setTimeout(renderTodayState, 30000);
  } else if (s.state === "done" && s.day === dayLocal()) {
    box.append(el("span", "", t("ftStateDone", "今日已完成")));
  } else if (s.state === "interrupted") {
    box.append(
      el("span", "", t("ftStateInterrupted", "采集中断，下次启动浏览器自动续跑"))
    );
  } else if (s.state === "cancelled") {
    box.append(
      el("span", "", t("ftStateCancelled", "今日已取消自动采集，可手动重启"))
    );
  } else if (s.state === "failed") {
    const REASONS = {
      login: t("ftErrLogin", "未登录 X"),
      timeout: t("ftErrTimeout", "超时截断"),
      nodata: t("ftErrNodata", "未捕获到数据"),
    };
    box.append(
      el(
        "span",
        "",
        fmt("ftStateFailed", "采集失败：{reason}", { reason: REASONS[s.err] || s.err })
      )
    );
  }
}

// ---------- 账号胶囊 ----------
function pill(u, tagText) {
  const p = el("span", "ft-pill");
  const img = document.createElement("img");
  if (u.a) img.src = u.a;
  img.alt = "";
  img.loading = "lazy";
  img.referrerPolicy = "no-referrer";
  img.onerror = () => {
    img.style.visibility = "hidden";
  };
  const name = el("span", "p-name", u.n || u.h || u.id);
  if (u.v) p.append(el("span", "p-blue", "✓"));
  const note = findNote(u);
  if (note?.name) name.classList.add("p-note");
  p.append(img, name);
  if (tagText) p.append(el("span", "p-tag", tagText));
  p.title = `${u.n || ""} @${u.h}${note?.name ? ` · 📝 ${note.name}` : ""}${tagText ? ` · ${tagText}` : ""}`;
  p.addEventListener("click", () =>
    window.open(`https://x.com/${u.h}`, "_blank", "noopener")
  );
  return p;
}

// ---------- 事件卡 ----------
function renderGroup(key, tone, users, tagOf) {
  const box = el("div", "ft-group");
  const head = el("div", "ft-group-head");
  head.append(
    el("span", "ft-group-title", t(key, key)),
    el("span", `ft-count ${tone}`, String(users.length))
  );
  const pills = el("div", "ft-pills");
  if (!users.length) {
    pills.append(el("span", "ft-empty", t("ftEmptyGroup", "无变动")));
  } else {
    users.forEach((u) => pills.append(pill(u, tagOf?.(u))));
  }
  box.append(head, pills);
  return box;
}

// ---------- 按天渲染 ----------
function renderDay(day) {
  const groupsBox = $("ftGroups");
  groupsBox.textContent = "";
  $("ftNotice").classList.add("hidden");
  $("ftRenamed").classList.add("hidden");

  // 当天全部 delta 记录
  const dayRecs = snaps.filter((s) => s.kind === "delta" && s.id.slice(0, 10) === day);
  if (!dayRecs.length) return;
  if (dayRecs.some((r) => r.complete === false)) {
    const n = $("ftNotice");
    n.textContent = t("ftIncompleteDay", "当日有采集未完成，数据可能不全");
    n.classList.remove("hidden");
  }

  // 事件并集（同 id 当日多次出现按事件组各自保留）
  const union = (list, key) => {
    const seen = new Set();
    const out = [];
    for (const r of list) {
      for (const u of r[key]?.followers || []) if (!seen.has(u.id)) { seen.add(u.id); out.push(u); }
    }
    return out;
  };
  const unionG = (list, key) => {
    const seen = new Set();
    const out = [];
    for (const r of list) {
      for (const u of r[key]?.following || []) if (!seen.has(u.id)) { seen.add(u.id); out.push(u); }
    }
    return out;
  };
  const addedF = union(dayRecs, "added");
  const removedF = union(dayRecs, "removed");
  const addedG = unionG(dayRecs, "added");
  const removedG = unionG(dayRecs, "removed");

  // 互关事件：当天开始前态 vs 当天结束态（重放自动跳 incomplete）
  const prevDayId = snaps.filter((s) => s.id < day).pop()?.id || "";
  const prev = prevDayId ? rebuildFollow(snaps, prevDayId) : null;
  const today = rebuildFollow(snaps, dayRecs[dayRecs.length - 1].id);
  let newMutuals = [];
  let lostMutuals = [];
  if (prev && today) {
    const mPrev = new Set(
      [...prev.following.keys()].filter((id) => prev.followers.has(id))
    );
    const mToday = new Set(
      [...today.following.keys()].filter((id) => today.followers.has(id))
    );
    const findUser = (uid) =>
      today.following.get(uid) ||
      today.followers.get(uid) ||
      prev.following.get(uid) ||
      prev.followers.get(uid) ||
      { id: uid, h: "", n: "", a: "" };
    newMutuals = [...mToday].filter((id) => !mPrev.has(id)).map(findUser);
    lostMutuals = [...mPrev].filter((id) => !mToday.has(id)).map(findUser);
  }

  // 净变化过滤：日内往返（先关注又取关 / 先取关又关注）视为无变化，双向剔除不显示；
  // 互关两类本身是前后态差集（理论上无交集），防御性同过滤
  const netFilter = (add, sub) => {
    const addIds = new Set(add.map((u) => u.id));
    const subIds = new Set(sub.map((u) => u.id));
    return [add.filter((u) => !subIds.has(u.id)), sub.filter((u) => !addIds.has(u.id))];
  };
  const [netAddedF, netRemovedF] = netFilter(addedF, removedF);
  const [netAddedG, netRemovedG] = netFilter(addedG, removedG);
  const [netNewM, netLostM] = netFilter(newMutuals, lostMutuals);

  // 互关解除归因：对方取关 / 我取关
  const removedFIds = new Set(netRemovedF.map((u) => u.id));
  const removedGIds = new Set(netRemovedG.map((u) => u.id));
  const lostTag = (u) =>
    removedFIds.has(u.id)
      ? t("ftByThem", "对方取关")
      : removedGIds.has(u.id)
      ? t("ftByMe", "我取关")
      : "";

  // 总量三格 = 当天结束态
  if (today) {
    let mutual = 0;
    for (const id of today.following.keys())
      if (today.followers.has(id)) mutual++;
    $("ftTotG").textContent = today.following.size;
    $("ftTotF").textContent = today.followers.size;
    $("ftTotM").textContent = mutual;
  }

  // 顺序：第一行 正向（新粉丝/新关注/新增互关），第二行 负向（取关我/我取关/互关解除），上下对仗
  groupsBox.append(
    renderGroup("ftGNewFollowers", "add", netAddedF),
    renderGroup("ftGNewFollowing", "add", netAddedG),
    renderGroup("ftGNewMutuals", "mut", netNewM),
    renderGroup("ftGUnfollowers", "sub", netRemovedF),
    renderGroup("ftGUnfollowing", "sub", netRemovedG),
    renderGroup("ftGLostMutuals", "sub", netLostM, lostTag)
  );

  // 改名（当天合并，提示条）
  const renamed = dayRecs.flatMap((r) => r.renamed || []);
  if (renamed.length) {
    const bar = $("ftRenamed");
    bar.textContent = "";
    bar.append(
      el("b", "", t("ftGRenamed", "改名") + "："),
      document.createTextNode(
        " " + renamed.map((r) => `${r.on || r.oh} → ${r.nn || r.nh}（@${r.oh}→@${r.nh}）`).join("；")
      )
    );
    bar.classList.remove("hidden");
  }
}

// ---------- 主流程 ----------
async function main() {
  await loadLang();
  snaps = await getFollowSnapshots();
  notes = (await chrome.storage.local.get("twitterNotes")).twitterNotes || {};

  renderTodayState();

  // 有 delta 的天（倒序）
  const days = [
    ...new Set(
      snaps.filter((s) => s.kind === "delta").map((s) => s.id.slice(0, 10))
    ),
  ].sort((a, b) => (a < b ? 1 : -1));

  const sel = $("ftDateSel");
  if (!days.length) {
    const hasBase = snaps.some((s) => s.kind === "base");
    const n = $("ftNotice");
    n.textContent = hasBase
      ? t("ftFirstDay", "基底快照（首日），无对比")
      : t("ftNoData", "暂无数据，完成首次采集后展示");
    n.classList.remove("hidden");
    sel.disabled = true;
    // 无对比时三格给最新态
    const latest = rebuildFollow(snaps, "9999");
    if (latest) {
      let mutual = 0;
      for (const id of latest.following.keys())
        if (latest.followers.has(id)) mutual++;
      $("ftTotG").textContent = latest.following.size;
      $("ftTotF").textContent = latest.followers.size;
      $("ftTotM").textContent = mutual;
    }
    return;
  }
  days.forEach((d) => {
    const o = el("option", "", d);
    o.value = d;
    sel.append(o);
  });
  sel.addEventListener("change", () => renderDay(sel.value));
  renderDay(days[0]);
}

main().catch((e) => {
  console.error("[XMark follows]", e);
  $("ftTodayState").textContent = String(e?.message || e);
});
