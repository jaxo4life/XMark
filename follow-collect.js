// follow-collect.js — 关注变动采集桥（ISOLATED world，document_start）
// 职责（v6.6.1 收窄重构）：
//  1. 样板桥（常驻）：把 follow-main（MAIN world）截获的 Following 请求样板转发给
//     background 存档——用户日常浏览 following 页即自动续新样板，queryId 改版免疫
//  2. handle 扒取（仅首次前台 tab）：background 无 handle 时激活本 tab 轮询左下角
//     账号按钮，扒到 @handle 上报，由 background 决定导航
// 滚动采集/翻页驱动已随 SW 重放架构退役（后台 tab 不渲染的页面滚了也白滚，已实测）。
(() => {
  "use strict";
  if (window.top !== window.self) return; // 仅顶层（保险）

  const send = (msg) => {
    try {
      chrome.runtime.sendMessage(msg).catch(() => {});
    } catch (_) { /* SW 冷启动窗口竞态——静默 */ }
  };

  const readHandle = () => {
    const btn = document.querySelector(
      '[data-testid="SideNav_AccountSwitcher_Button"]'
    );
    const m = (btn?.textContent || "").match(/@([A-Za-z0-9_]{1,15})/);
    return m ? m[1] : "";
  };

  // ---- 样板桥：MAIN world → background（常驻，无需激活）----
  window.addEventListener("message", (e) => {
    const d = e.data;
    if (!d || d.source !== "xmark-follow-sample") return;
    if (!d.url || typeof d.url !== "string") return;
    send({ action: "followSample", url: d.url, headers: d.headers || {} });
  });

  // ---- background 控制（首次前台 tab 扒 handle）----
  chrome.runtime.onMessage.addListener((msg, _sender, res) => {
    if (msg?.cmd === "followActivate") {
      let tries = 0;
      const iv = setInterval(() => {
        const h = readHandle();
        if (h) {
          clearInterval(iv);
          send({ action: "followHandle", handle: h });
          return;
        }
        if (++tries >= 20) {
          clearInterval(iv); // ~14s 未见账号按钮：未登录或改版
          send({ action: "followHandle", error: "login" });
        }
      }, 700);
      res?.({ ok: true });
    } else if (msg?.cmd === "followStop") {
      res?.({ ok: true });
    }
    return false; // 同步应答
  });
})();
