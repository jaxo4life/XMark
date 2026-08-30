// follow-collect.js — 关注变动采集（ISOLATED world，document_start）
// 惰性常驻：未激活时只监听不动页面（用户自己浏览 following 页不受干扰）。
// 激活后：自驱滚动（2s±抖动一步）+ 聚合 MAIN world 截获的用户（id 去重）+ 增量上报
// background。后台 tab 节流兜底：SW 30s 踢活（followTick 消息执行不受页面 timer 节流）。
// phase（following/followers）以 URL 判定；tab 被 background 导航 = 文档重建 = 状态自然清零。
(() => {
  "use strict";
  if (window.top !== window.self) return; // 仅顶层（保险）

  let active = false; // 仅 background 激活的采集 tab 为 true
  let phase = null; // "following" | "followers"
  const users = new Map(); // id -> {id,h,n,a,v}
  let total = 0; // DOM header 计数（进度锚点）
  let lastNewAt = 0;
  let lastHeight = 0;
  let stallRounds = 0;
  let phaseStart = 0;
  let done = false;
  let timer = 0;

  const PHASE_RE = /^\/[^/]+\/(following|followers)$/;
  const currentPhase = () => {
    const m = location.pathname.match(PHASE_RE);
    return m ? m[1] : null;
  };

  const send = (msg) => {
    try {
      chrome.runtime.sendMessage(msg).catch(() => {});
    } catch (_) { /* SW 冷启动窗口竞态——静默 */ }
  };

  // ---------- DOM 辅助 ----------
  const UNITS = { K: 1e3, k: 1e3, M: 1e6, m: 1e6, 万: 1e4, 亿: 1e8 };
  const parseCount = (s) => {
    const m = (s || "").replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*([KkMm万亿])?/);
    if (!m) return 0;
    return Math.round(parseFloat(m[1]) * (UNITS[m[2]] || 1));
  };

  // profile header 计数链接：<a href="/{user}/following">518 正在关注</a>
  const readTotal = () => {
    const p = currentPhase();
    if (!p) return 0;
    const a = document.querySelector(`a[href$="/${p}"]`);
    return a ? parseCount(a.textContent) : 0;
  };

  // 左下角账号按钮内 @handle（登录后存在）
  const readHandle = () => {
    const btn = document.querySelector(
      '[data-testid="SideNav_AccountSwitcher_Button"]'
    );
    const m = (btn?.textContent || "").match(/@([A-Za-z0-9_]{1,15})/);
    return m ? m[1] : "";
  };

  // ---------- MAIN world 数据入口 ----------
  window.addEventListener("message", (e) => {
    const d = e.data;
    if (!d || d.source !== "xmark-follow") return;
    if (!active || done) return;
    const p = currentPhase();
    if (!p || d.kind !== p) return; // 只收当前 phase 的数据
    const fresh = [];
    for (const u of d.users || []) {
      if (u.id && !users.has(u.id)) {
        users.set(u.id, u);
        fresh.push(u);
      }
    }
    if (fresh.length) {
      lastNewAt = Date.now();
      total = readTotal() || total;
      send({ action: "followBatch", kind: p, users: fresh, cur: users.size, total });
    }
  });

  // ---------- 滚动驱动 ----------
  const finish = (complete, reason = "") => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    timer = 0;
    send({
      action: "followPhaseDone",
      kind: phase,
      cur: users.size,
      total,
      complete,
      reason: complete ? "" : reason || "timeout",
    });
  };

  const step = () => {
    if (!active || done) return;
    const p = currentPhase();
    if (!p) return; // 导航间隙
    if (p !== phase) {
      beginPhase(); // 兜底：同文档内切了 phase
      return;
    }
    window.scrollTo(0, document.documentElement.scrollHeight);
    const h = document.documentElement.scrollHeight;
    total = readTotal() || total;
    // 到底判定：10s 无新用户 + 页高不变，连续 2 轮（自驱 ~2s/轮；X 翻页正常响应 <3s，
    // 10s 足够区分「慢一批」与「真到底」——误判有 total 98% 兜底转 failed 重采）
    if (Date.now() - lastNewAt > 10000 && h === lastHeight) stallRounds++;
    else stallRounds = 0;
    lastHeight = h;
    if (total > 0 && users.size >= total) {
      finish(true);
      return;
    }
    if (stallRounds >= 2) {
      // 计数可达（含不可见账号）按 98% 容差；读不到计数则视 stalled 为到底。
      // 零数据一律失败——没截到响应绝不能算采全（曾空手报完成）
      const ok =
        total > 0
          ? users.size >= Math.floor(total * 0.98) && users.size > 0
          : users.size > 0;
      finish(ok, ok ? "" : users.size === 0 ? "nodata" : "timeout");
      return;
    }
    if (Date.now() - phaseStart > 15 * 60 * 1000) finish(false, "timeout"); // 单 phase 15min 超时截断
  };

  const loop = () => {
    timer = setTimeout(loop, 2000 + Math.random() * 800); // 抖动：温和滚动
    step();
  };

  const beginPhase = () => {
    const p = currentPhase();
    if (!p) return;
    phase = p;
    users.clear();
    done = false;
    stallRounds = 0;
    lastHeight = 0;
    lastNewAt = Date.now();
    phaseStart = Date.now();
    total = readTotal();
    if (!timer) loop();
    send({ action: "followPhaseStart", kind: p, total });
  };

  // ---------- background 控制 ----------
  chrome.runtime.onMessage.addListener((msg, _sender, res) => {
    if (msg?.cmd === "followActivate") {
      active = true;
      if (currentPhase()) {
        beginPhase();
      } else {
        // 非 phase 页（home）：等 DOM 扒自己 handle 上报，由 background 决定导航
        let tries = 0;
        const iv = setInterval(() => {
          if (!active) return clearInterval(iv);
          const h = readHandle();
          if (h) {
            clearInterval(iv);
            send({ action: "followHandle", handle: h });
            return;
          }
          if (++tries >= 15) {
            // 10s 未见账号按钮：未登录或改版
            clearInterval(iv);
            send({ action: "followHandle", error: "login" });
          }
        }, 700);
      }
      res?.({ ok: true });
    } else if (msg?.cmd === "followTick") {
      if (active && !done) {
        step();
        if (!timer) loop(); // 节流冻死了自驱循环时由踢活重启
      }
      res?.({ ok: true, done, phase: currentPhase(), size: users.size, total });
    } else if (msg?.cmd === "followStop") {
      active = false;
      clearTimeout(timer);
      timer = 0;
      res?.({ ok: true });
    }
    return false; // 同步应答
  });
})();
