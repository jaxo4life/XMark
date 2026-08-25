/**
 * XMark · 右列 Timeline（独立模块，自包含，与 content.js 零耦合）
 *
 * 形态：右栏替代品——「界面净化·隐藏右侧边栏」+ listColSettings.enabled 双开时激活。
 *   挂在 sidebarColumn 的父容器，grid 顶入第三格（原右栏位置）。
 *   列 = tab 条（多 List 切换，TweetDeck 式）+ iframe（/i/lists/<id>，X 原生 timeline；
 *   嵌入由 background.js DNR 规则删 sub_frame 限制头实现，帧内净化由 frame-clean.js 负责）。
 *
 * 数据：storage.local.listColSettings = { enabled, lists:[{id,name}], activeId }
 * 开关：popup 功能 tab → listColSettings.enabled（默认关）+ uiCleanSettings.rightSidebar
 *
 * 移除本功能：删此文件 + manifest.json js 数组一项 + background.js DNR 段 + popup 配置。
 *
 * ⚠️ 必须保持 IIFE：同 entry 多 content script 共享全局作用域，
 *    顶层声明会与 content.js 撞名抛 SyntaxError 且静默失败。
 */
(() => {
  "use strict";

  const SETTINGS_KEY = "listColSettings";

  let langData = {};
  let root = null;
  let head = null;
  let frame = null;
  let current = { lists: [] }; // 最近一次渲染用的 settings 快照

  // ---------- i18n ----------
  async function loadLang() {
    try {
      const { lang = "zh" } = await chrome.storage.local.get(["lang"]);
      const res = await fetch(chrome.runtime.getURL(`lang/${lang}.json`));
      langData = await res.json();
    } catch (e) {
      langData = {};
    }
  }
  const t = (key, fallback) => langData[key] || fallback;

  // ---------- 样式（X 官方卡片/药丸规格，取值与 xfinder.js 同源） ----------
  function injectStyle() {
    if (document.getElementById("xmark-listcol-style")) return;
    const css = `
/* 列容器：总宽 598（对齐原生 timeline）；无 padding——iframe 内 X 推文 timeline 自带内边距，
   外层再包 padding 会双重缩进；
   ⚠️ host 是 flex 容器——必须 flex-shrink:0，否则 width:598 被主栏挤压成 450（iframe 显 418）；
   贴顶；grid-column 显式钉最后一列（host 若为 grid 时防 auto-placement 挤压） */
#xmark-listcol{grid-column:-2/-1;justify-self:end;flex-shrink:0;position:sticky;top:0;width:598px;min-width:0;height:100vh;box-sizing:border-box;display:flex;flex-direction:column;font-family:inherit;--lc-card:#fff;--lc-line:#eff3f4;--lc-key:#0f1419;--lc-muted:#536471;--lc-hover:#f7f9f9}
#xmark-listcol[data-theme="dark"]{--lc-card:#16181c;--lc-line:#2f3336;--lc-key:#e7e9ea;--lc-muted:#71767b;--lc-hover:#202327}
/* 列头：对齐原生「为你推荐/正在关注」tab 行——53px 高、通栏贴列线（左线与主栏头边线衔接）、底部分割线 */
#xmark-listcol .lc-head{flex:none;height:53px;display:flex;align-items:stretch;overflow-x:auto;scrollbar-width:none;background:var(--lc-card);border-bottom:1px solid var(--lc-line);border-left:1px solid var(--lc-line);border-right:1px solid var(--lc-line)}
#xmark-listcol .lc-head::-webkit-scrollbar{display:none}
/* tab：原生顶部 tab 风格（透明底、active 黑粗体、hover 灰块）；flex:1 平分列头宽度；
   显式 flex 居中防 X 全局样式污染 */
#xmark-listcol .lc-tab{flex:1;min-width:0;border:none;background:transparent;color:var(--lc-muted);font-size:15px;font-weight:500;font-family:inherit;padding:0 16px;border-radius:0;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;align-items:center;justify-content:center;line-height:1.2;transition:color .15s,background-color .15s}
#xmark-listcol .lc-tab:hover{background:var(--lc-hover);color:var(--lc-key)}
#xmark-listcol .lc-tab.active{color:var(--lc-key);font-weight:700}
/* iframe：原生 timeline 列体（598 全宽、无圆角、左右 1px 列线） */
#xmark-listcol .lc-frame{flex:1;min-height:0;width:100%;border:none;border-left:1px solid var(--lc-line);border-right:1px solid var(--lc-line);border-radius:0;background:var(--lc-card)}
/* 加载遮罩：导航/水合期盖住 iframe（防被隐藏元素闪现）；就绪信号到后淡出；
   中央 X 风格蓝色旋转圆环（#1d9bf0，同 X 官方 spinner 色值） */
#xmark-listcol .lc-veil{position:absolute;top:53px;left:0;right:0;bottom:0;background:var(--lc-card);z-index:2;opacity:1;pointer-events:auto;display:flex;align-items:center;justify-content:center}
#xmark-listcol .lc-veil::after{content:"";width:28px;height:28px;border-radius:9999px;border:3px solid #1d9bf0;border-top-color:transparent;animation:lc-spin .8s linear infinite}
@keyframes lc-spin{to{transform:rotate(360deg)}}
`;
    const style = document.createElement("style");
    style.id = "xmark-listcol-style";
    style.textContent = css;
    document.documentElement.appendChild(style);
  }

  // ---------- DOM ----------
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  // 暗色检测三层信号（与 xfinder.js 同款：color-scheme → theme-color → body 亮度）
  function applyTheme() {
    const lum = (m) =>
      parseInt(m[0]) * 0.299 +
        parseInt(m[1] || 0) * 0.587 +
        parseInt(m[2] || 0) * 0.114 <
      128;
    let dark = null;
    try {
      const cs = document.documentElement.style.colorScheme;
      if (cs) dark = cs.includes("dark");
    } catch (e) {
      /* ignore */
    }
    if (dark === null) {
      const meta = document.querySelector('meta[name="theme-color"]');
      const m = meta && (meta.content || "").match(/\d+/g);
      if (m) dark = lum(m);
    }
    if (dark === null) {
      try {
        const bg = getComputedStyle(document.body).backgroundColor || "";
        const m = bg.match(/\d+/g);
        dark = m ? lum(m) : false;
      } catch (e) {
        dark = false;
      }
    }
    document.documentElement.dataset.xmarkTheme = dark ? "dark" : "light"; // 共享钩子，幂等
    root?.setAttribute("data-theme", dark ? "dark" : "light");
  }

  // ---------- 渲染 ----------
  // ⚠️ MutationObserver 防抖 400ms 每轮都会走到这里：tab DOM 必须签名幂等
  //    （内容没变不重建），否则 lc-head 在 DevTools 里表现为不停刷新
  let lastTabsSig = "";
  let frameTarget = ""; // 我们意图的 iframe URL（guard 用它，不用 attribute——点 tab 强制回列表依赖此区分）

  let veil = null;
  let unveilTimer = null;

  // 加载遮罩：导航瞬间盖上（防被隐藏元素闪现），onload 后再留 600ms 盖住 X 水合期，淡出
  function showVeil() {
    if (!veil) return;
    clearTimeout(unveilTimer);
    veil.style.transition = "none";
    veil.style.opacity = "1";
    veil.style.pointerEvents = "auto";
  }

  function scheduleUnveil() {
    if (!veil) return;
    clearTimeout(unveilTimer);
    // 轮询帧内就绪信号（frame-clean 在首条推文出现且隐藏处理完一轮后挂
    // data-xmark-frame-ready）；固定延时盖不住水合期浮动。4s 超时兜底防死盖。
    const started = Date.now();
    const poll = () => {
      if (!veil) return;
      let ready = Date.now() - started > 4000;
      if (!ready) {
        try {
          ready = !!frame.contentDocument?.documentElement.hasAttribute(
            "data-xmark-frame-ready"
          );
        } catch (e) {
          /* 跨域瞬间继续轮 */
        }
      }
      if (ready) {
        veil.style.transition = "opacity .25s ease";
        veil.style.opacity = "0";
        veil.style.pointerEvents = "none";
      } else {
        unveilTimer = setTimeout(poll, 120);
      }
    };
    poll();
  }

  function navigate(target) {
    showVeil();
    if (frameTarget === target) {
      // 点当前 tab / 冻结自愈：强制回列表页（帧内跳走后一键返回；replace 不留历史）
      try {
        frame.contentWindow?.location.replace(target);
        return;
      } catch (e) {
        /* 冻结极端时 replace 可能抛：清 src 重设强制导航 */
        frame.removeAttribute("src");
        frame.src = target;
        return;
      }
    }
    frameTarget = target;
    frame.src = target;
  }

  function renderTabs(settings) {
    current = settings;
    const lists = settings.lists || [];
    const activeId = lists.some((l) => l.id === settings.activeId)
      ? settings.activeId
      : lists[0]?.id;
    if (activeId !== settings.activeId) persist({ activeId }); // 失效回落首个并修正

    const sig = JSON.stringify([lists, activeId]);
    if (sig !== lastTabsSig || !head.childElementCount) {
      lastTabsSig = sig;
      head.textContent = "";
      lists.forEach((l) => {
        const tab = el(
          "button",
          "lc-tab" + (l.id === activeId ? " active" : ""),
          l.name
        );
        tab.title = l.name;
        tab.dataset.lcId = l.id;
        tab.addEventListener("click", () => switchTab(l.id));
        head.appendChild(tab);
      });
    }

    const target = `/i/lists/${activeId}`;
    if (frameTarget !== target) navigate(target); // guard 防重渲染重载、丢滚动位置
  }

  function switchTab(id) {
    current.activeId = id;
    root
      .querySelectorAll(".lc-tab")
      .forEach((tab) =>
        tab.classList.toggle("active", tab.dataset.lcId === id)
      );
    navigate(`/i/lists/${id}`); // 含点当前 tab：强制回列表页
    persist({ activeId: id });
  }

  async function persist(patch) {
    try {
      const { [SETTINGS_KEY]: cur = {} } = await chrome.storage.local.get([
        SETTINGS_KEY,
      ]);
      chrome.storage.local.set({ [SETTINGS_KEY]: { ...cur, ...patch } });
    } catch (e) {
      /* ignore */
    }
  }

  // ---------- 注入与生命周期（xfinder 同款骨架） ----------
  async function readFlags() {
    try {
      const { [SETTINGS_KEY]: lc, uiCleanSettings: uc } =
        await chrome.storage.local.get([SETTINGS_KEY, "uiCleanSettings"]);
      const lists = Array.isArray(lc?.lists) ? lc.lists : [];
      return {
        on: lc?.enabled === true && lists.length > 0,
        rightHidden: uc?.rightSidebar === true,
        settings: {
          enabled: lc?.enabled === true,
          lists,
          activeId: lc?.activeId,
        },
      };
    } catch (e) {
      return { on: false, rightHidden: false, settings: { lists: [] } };
    }
  }

  function buildColumn(settings) {
    root = el("div", "");
    root.id = "xmark-listcol";
    head = el("div", "lc-head");
    frame = document.createElement("iframe");
    frame.className = "lc-frame";
    frame.title = t("lcEnabled", "XMark Timeline");
    veil = el("div", "lc-veil");
    frame.addEventListener("load", scheduleUnveil);
    root.appendChild(head);
    root.appendChild(frame);
    root.appendChild(veil);
    showVeil(); // 初始加载即遮
    renderTabs(settings);
    applyTheme(); // 建出即检测，不等 observer（修刷新时暗色延迟）
  }

  function ensureUI(settings) {
    const sidebar = document.querySelector('[data-testid="sidebarColumn"]');
    const host = sidebar?.parentElement;
    const existing = document.getElementById("xmark-listcol");

    if (!host) {
      existing?.remove();
      root = null;
      head = null;
      frame = null;
      return; // 布局未就绪/无右栏：等下一轮
    }
    if (existing && existing.parentElement === host) {
      renderTabs(settings); // 已挂：仅刷新 tab（src guard 防重载）
      return;
    }
    existing?.remove();
    if (!root) buildColumn(settings);
    host.appendChild(root); // grid：sidebarColumn 已 display:none，本节点顶入第三格
  }

  function teardownUI() {
    document.getElementById("xmark-listcol")?.remove();
    root = null;
    head = null;
    frame = null;
    veil = null;
    clearTimeout(unveilTimer);
    frameTarget = ""; // 重建后首帧走 src 赋值而非 replace
  }

  async function start() {
    injectStyle();
    await loadLang();
    const { on, rightHidden, settings } = await readFlags();
    if (on && rightHidden) ensureUI(settings);

    let timer = null;
    new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        applyTheme();
        const f = await readFlags();
        if (f.on && f.rightHidden) ensureUI(f.settings);
        else teardownUI();
      }, 400);
    }).observe(document.body, { childList: true, subtree: true });

    try {
      chrome.storage.onChanged.addListener(async (changes, area) => {
        if (area !== "local") return;
        if (changes[SETTINGS_KEY] || changes.uiCleanSettings) {
          const f = await readFlags();
          if (f.on && f.rightHidden) ensureUI(f.settings);
          else teardownUI();
        }
        if (changes.lang) {
          await loadLang(); // 语言即时生效：tab 名来自数据、无文案，无需重建
        }
      });
    } catch (e) {
      /* ignore */
    }

    // 后台冻结自愈：Chrome 后台 tab 资源回收可能冻死 iframe（回前台空白）；
    // 离开超 5 分钟回前台时直接重载（盖 veil，复用回列表导航流程）
    let hiddenAt = 0;
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        hiddenAt = Date.now();
      } else if (hiddenAt && Date.now() - hiddenAt > 5 * 60 * 1000) {
        hiddenAt = 0;
        if (root && frameTarget) navigate(frameTarget);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
