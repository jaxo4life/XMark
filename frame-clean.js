/**
 * XMark · 右列 Timeline 帧内净化（独立模块，仅 iframe 内运行）
 *
 * 职责：右列 iframe（/i/lists/* 等）内的轻净化——
 *   1. 隐藏 X 左边栏（360px 窄断点下的图标栏）
 *   2. 隐藏列表页顶部 header 区（banner/列表名/创建者/成员数/编辑按钮）
 *   3. 广告推文隐藏（跟随「界面净化·隐藏广告推文」开关 uiCleanSettings.hideAds）
 *
 * 顶层页面（window.top === window.self）直接 return——顶层净化由 ui-clean.js 负责，
 * 防重入零成本（实测：content script 默认 all_frames:false 不进帧，本条目显式 true）。
 * manifest 里本文件走独立 content_scripts 条目（all_frames:true，仅 js 无 css）。
 *
 * 移除本功能：删此文件 + manifest.json 对应 content_scripts 条目。
 *
 * ⚠️ 必须保持 IIFE：同 entry 多 content script 共享全局作用域，
 *    顶层声明会与 content.js 撞名抛 SyntaxError 且静默失败。
 */
(() => {
  "use strict";
  if (window.top === window.self) return; // 顶层由 ui-clean.js 管

  // 与 content.js processHomePage 同源关键词集（精确匹配 span 文本，非子串）
  const ADS_KEYWORDS = ["广告", "推荐", "Promoted", "Recommended", "Ad"];

  function injectStyle() {
    if (document.getElementById("xmark-frame-clean-style")) return;
    const css = `
/* 左边栏（role 结构选择器，无哈希类名依赖） */
header[role="banner"]{display:none!important}
/* 列表页顶部 header 区：仅 list header 格含 /i/lists/*/members 链接
   （结构特征，用户页/推文页 header 无此链接，帧内跳转不误伤） */
div[data-testid="cellInnerDiv"]:has(a[href*="/i/lists/"][href$="/members"]){display:none!important}
/* 页面标题 bar 两小块（r-* 是 RNW 稳定 utility 类，跨 X 发版稳定；⚠️ 不能裸 div:has(>h2)——
   X 在 timeline 滚动区（r-13awgt0）内放了无障碍 h2「键盘快捷键」，裸规则会藏掉整个滚动区、
   推文全消失；同理不能藏 primaryColumn 直接子级=含 timeline 的整块 wrapper）：
   左 = 列表名+handle 层（r-1habvwh）；右 = 分享/更多按钮组（r-1pz39u2，限定防误伤推文 footer） */
div.r-1habvwh:has(>h2[role="heading"]){display:none!important}
div.r-1pz39u2:has([data-testid="share-button"]){display:none!important}
/* 藏 X 自己的 primaryColumn 左右列线（与外层 .lc-frame 外框线形成双线）；
   推文横向分割线（cell border-bottom）不受影响 */
[data-testid="primaryColumn"]{border-left:none!important;border-right:none!important}
`;
    const style = document.createElement("style");
    style.id = "xmark-frame-clean-style";
    style.textContent = css;
    document.documentElement.appendChild(style);
  }

  let hideAds = true; // 默认开，与 uiCleanSettings.hideAds 默认一致

  // 列表 header 格 + 页面标题 bar JS 兜底（CSS :has() 双保险，目标同 injectStyle 注释）
  function processListHeader() {
    const hide = (el) => el?.style.setProperty("display", "none", "important");
    document
      .querySelectorAll('a[href*="/i/lists/"][href$="/members"]')
      .forEach((a) => hide(a.closest('div[data-testid="cellInnerDiv"]')));
    document
      .querySelectorAll('div.r-1habvwh > h2[role="heading"]')
      .forEach((h) => hide(h.parentElement));
    document
      .querySelectorAll('[data-testid="share-button"]')
      .forEach((b) => {
        const wrap = b.parentElement?.parentElement; // 按钮 → 按钮排 → 按钮组容器
        if (wrap && !wrap.closest('[data-testid="tweet"]')) hide(wrap); // 推文 footer 不误伤
      });
    // 就绪信号：首条推文格子出现且本轮隐藏处理完毕 → 挂标志；
    // 父页（listcol）轮询到才揭加载遮罩（推文与标题层同批水合，同轮已处理，不会闪）
    if (document.querySelector('[data-testid="cellInnerDiv"]')) {
      document.documentElement.setAttribute("data-xmark-frame-ready", "1");
    }
  }

  // 广告隐藏：与 content.js processHomePage 同款逻辑 + 幂等标记
  function processAds() {
    if (!hideAds) return;
    document.querySelectorAll('[data-testid="tweet"]').forEach((tweet) => {
      if (tweet.hasAttribute("data-xmark-frame-ad")) return;
      const isAd = [...tweet.querySelectorAll('div[dir="ltr"] span')].some(
        (span) => ADS_KEYWORDS.includes((span.textContent || "").trim())
      );
      if (isAd) {
        tweet.setAttribute("data-xmark-frame-ad", "1");
        tweet.style.display = "none";
      }
    });
  }

  async function loadHideAds() {
    try {
      const { uiCleanSettings } = await chrome.storage.local.get([
        "uiCleanSettings",
      ]);
      hideAds = uiCleanSettings?.hideAds !== false;
      if (!hideAds) {
        document.querySelectorAll("[data-xmark-frame-ad]").forEach((tweet) => {
          tweet.removeAttribute("data-xmark-frame-ad");
          tweet.style.display = "";
        });
      }
    } catch (e) {
      /* ignore */
    }
  }

  // ⚠️ 本条目 run_at: document_start：injectStyle 必须在 SSR 首帧渲染前注入，
  //    X 水合计算虚拟列表布局时 header 格已 display:none → 后续格子无缝顶上；
  //    body 相关（observer/扫描）等 DOMContentLoaded
  function boot() {
    loadHideAds().then(processAds);
    processListHeader();
    let timer = null;
    new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        processAds();
        processListHeader();
      }, 400);
    }).observe(document.body, { childList: true, subtree: true });
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes.uiCleanSettings) return;
      loadHideAds().then(processAds);
    });
  } catch (e) {
    /* ignore */
  }

  injectStyle(); // document_start 即有 documentElement，立即注入
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
