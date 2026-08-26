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
/* 双层架构（Chrome 铁律：移动 iframe 节点 = 重新加载文档，绝不能动 iframe）：
   ① #xmark-listcol-slot 挂 host——纯占位框撑住第三格布局（无状态，React 重建删了就补）；
   ② #xmark-listcol 是真正的列（tab 条+iframe+veil），常驻 body、position:fixed，
      left/top/width/height 由 syncFramePos 同步自占位框 rect——React 重建期间列悬停原地，
      iframe 文档零扰动；白名单外路由切 visibility:hidden（保活不冻结）。
   ⚠️ 占位框继承原布局约束：host 是 flex 容器必须 flex-shrink:0（否则 598 被主栏挤成 450）；
   grid-column 显式钉最后一列（host 若为 grid 时防 auto-placement 挤压） */
#xmark-listcol-slot{grid-column:-2/-1;justify-self:end;flex-shrink:0;position:sticky;top:0;width:598px;min-width:0;height:100vh;box-sizing:border-box}
#xmark-listcol{position:fixed;top:0;left:0;display:flex;flex-direction:column;z-index:1;font-family:inherit;--lc-card:#fff;--lc-line:#eff3f4;--lc-key:#0f1419;--lc-muted:#536471;--lc-hover:#f7f9f9}
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
   中央 X 原生同款 spinner（双层 circle SVG，SVG 挂旋转动画） */
#xmark-listcol .lc-veil{position:absolute;top:53px;left:0;right:0;bottom:0;background:var(--lc-card);z-index:2;opacity:1;pointer-events:auto;display:flex;align-items:center;justify-content:center}
#xmark-listcol .lc-veil svg{width:32px;height:32px;animation:lc-spin 1s linear infinite}
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

  // X 原生 loader 同款 spinner（双层 circle，官方色值/弧参数照抄；动画在 CSS lc-spin）
  function mkSpinner() {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 32 32");
    for (const style of [
      "stroke: rgb(29, 155, 240); opacity: 0.2;",
      "stroke: rgb(29, 155, 240); stroke-dasharray: 80; stroke-dashoffset: 60;",
    ]) {
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("cx", "16");
      c.setAttribute("cy", "16");
      c.setAttribute("r", "14");
      c.setAttribute("fill", "none");
      c.setAttribute("stroke-width", "4");
      c.setAttribute("style", style);
      svg.appendChild(c);
    }
    return svg;
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
  let navVeilTimer = null;
  let slot = null; // host 内占位框（无状态壳，React 连坐重建后由 ensureUI 补挂）
  let slotRO = null; // 占位框尺寸监听 → 同步 fixed 列位置

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

  // 帧内完整导航平滑过渡：X 在 iframe 里点推文/用户是完整文档导航而非 SPA
  // （X 对 iframe 有意降级，扩展侧无法拦截，见 DNR urlFilter 全域注释），白屏闪烁
  // 明显。同域挂 beforeunload：导航确定发生即盖 veil，新文档就绪信号揭开；12s 兜底
  // 防导航挂起死盖。SPA 同文档导航不触发 beforeunload，零干扰。旧文档的 listener
  // 随卸载销毁，须每次 load 后重挂。
  function hookFrameNavVeil() {
    try {
      frame.contentWindow?.addEventListener("beforeunload", () => {
        showVeil();
        clearTimeout(navVeilTimer);
        navVeilTimer = setTimeout(() => {
          if (!veil) return;
          veil.style.transition = "opacity .25s ease";
          veil.style.opacity = "0";
          veil.style.pointerEvents = "none";
        }, 12000);
      });
    } catch (e) {
      /* 跨域读不到：跳过（顶层 twitter.com 嵌 x.com 场景） */
    }
  }

  // 列位置同步：fixed 列（body 常驻）对齐 host 内占位框。占位框被 React 重建的
  // 间隙（未挂/宽 0）保持旧位不动——布局稳定后 ResizeObserver / observer 轮跟上。
  function syncFramePos() {
    if (!root || !slot || !slot.isConnected) return;
    const r = slot.getBoundingClientRect();
    if (!(r.width > 0) || !(r.height > 0)) return;
    root.style.left = r.left + "px";
    root.style.top = r.top + "px";
    root.style.width = r.width + "px";
    root.style.height = r.height + "px";
  }

  function buildColumn(settings) {
    slot = el("div", "");
    slot.id = "xmark-listcol-slot";
    root = el("div", "");
    root.id = "xmark-listcol";
    head = el("div", "lc-head");
    frame = document.createElement("iframe");
    frame.className = "lc-frame";
    frame.title = t("lcEnabled", "XMark Timeline");
    veil = el("div", "lc-veil");
    veil.appendChild(mkSpinner());
    frame.addEventListener("load", () => {
      scheduleUnveil();
      hookFrameNavVeil();
    });
    root.appendChild(head);
    root.appendChild(frame);
    root.appendChild(veil);
    showVeil(); // 初始加载即遮
    renderTabs(settings);
    applyTheme(); // 建出即检测，不等 observer（修刷新时暗色延迟）
    document.body.appendChild(root); // 列常驻 body——Chrome 移动 iframe=重载，永不移动
    if (!slotRO) {
      slotRO = new ResizeObserver(syncFramePos);
      slotRO.observe(slot);
    }
    window.addEventListener("resize", syncFramePos); // 位置平移（尺寸不变）RO 捕不到
  }

  // 路由白名单：仅主页与推文详情页显示右列。status 用前缀匹配涵盖 /photo/N 全屏延伸页。
  const allowedPath = (p) =>
    /^\/home\/?$/.test(p) || /^\/[^/]+\/status\/\d+/.test(p);
  const routeAllowed = () => allowedPath(location.pathname);

  // 显隐切换：只动 visibility（保 iframe 活性——display:none 会触发 Chrome 冻结，
  // 恢复后白屏假死）；占位框无状态可粗暴 display:none
  function setShown(shown) {
    if (!root) return;
    root.style.visibility = shown ? "" : "hidden";
    if (slot) slot.style.display = shown ? "" : "none";
  }

  function ensureUI(settings) {
    const sidebar = document.querySelector('[data-testid="sidebarColumn"]');
    const host = sidebar?.parentElement;

    if (!routeAllowed()) {
      setShown(false); // 白名单外路由：隐藏保活，等回归
      return;
    }
    if (!host) {
      return; // 白名单内但布局过渡（sidebarColumn 尚未渲染）：fixed 列悬停原地等下一轮
    }

    if (!root || !frame) buildColumn(settings);
    // 占位框被 React 连坐重建了就补挂（无状态壳，随便补）；iframe 常驻 body 零扰动
    if (!slot.isConnected) host.appendChild(slot);
    setShown(true);
    syncFramePos();
    renderTabs(settings); // 刷新 tab（src guard 防重载）
  }

  let returnTimer = null;

  // 快速回归：白名单内导航后，React 重建占位框一出现立即补挂+对位（不等 observer
  // 400ms 防抖，缩短列位置悬空窗口）；白名单外或 10s 超时即停，交给 observer 轮看管
  function watchReturn() {
    clearTimeout(returnTimer);
    let waited = 0;
    const tick = async () => {
      if (!root || !routeAllowed()) return;
      const host =
        document.querySelector('[data-testid="sidebarColumn"]')?.parentElement;
      if (host) {
        const f = await readFlags();
        if (f.on && f.rightHidden) ensureUI(f.settings);
        return;
      }
      waited += 50;
      if (waited < 10000) returnTimer = setTimeout(tick, 50);
    };
    returnTimer = setTimeout(tick, 50);
  }

  // 顶层 SPA 导航同步显隐：pushState/replaceState/popstate 的同步时机（必然先于
  // React commit）按目标路由立即切 visibility——fixed 列若不藏，会盖住新页面内容
  // 直到 observer 轮（400ms 防抖）才反应。列与 iframe 本体不动（React 随便重建都
  // 伤不到 body 常驻的列）；renderTabs 的 frameTarget guard 保证 iframe 零导航。
  // 同 pathname 的 push（无导航意义）跳过防闪。与 content.js 的 pushState 包装
  // 链式共存（本 hook 在外层、显隐判断最先执行）。
  function hookTopNav() {
    const preempt = (urlArg) => {
      if (!root) return;
      let to = null;
      try {
        to = new URL(String(urlArg), location.href).pathname;
      } catch (e) {
        to = location.pathname;
      }
      if (to === location.pathname) return;
      setShown(allowedPath(to));
      watchReturn(); // 白名单内导航：React 重建占位框后快速补挂+对位
    };
    for (const name of ["pushState", "replaceState"]) {
      const orig = history[name];
      history[name] = function () {
        preempt(arguments[2]);
        return orig.apply(this, arguments);
      };
    }
    window.addEventListener("popstate", () => {
      if (!root) return;
      setShown(routeAllowed());
      watchReturn();
    });
  }

  function teardownUI() {
    slot?.remove();
    root?.remove();
    slot = null;
    root = null;
    head = null;
    frame = null;
    veil = null;
    slotRO?.disconnect();
    slotRO = null;
    clearTimeout(unveilTimer);
    clearTimeout(navVeilTimer);
    clearTimeout(returnTimer);
    frameTarget = ""; // 重建后首帧走 src 赋值而非 replace
  }

  async function start() {
    injectStyle();
    await loadLang();
    hookTopNav(); // 抢先冻结必须在任何导航前就位（早于首建也无碍：preempt 判 root）
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

    // 后台冻结自愈：Chrome 后台冻结/资源回收可能冻死 iframe（实测表现=回前台空白假死，
    // 左栏原生 timeline 同冻结但能恢复）。**不按离开时长盲重载**——回前台探测假死的
    // 可见表现：同域（x.com 嵌 x.com）读帧 DOM，2s 恢复缓冲后推文格子（cellInnerDiv）
    // 仍不存在 = 帧真死了 → 重载；DOM 还在（只是不推新内容）不算死，不动。
    const frameAlive = () => {
      try {
        return !!frame?.contentDocument?.querySelector('[data-testid="cellInnerDiv"]');
      } catch (e) {
        return true; // 跨域意外读不到：宁可不重载（跨域父页 twitter.com 场景）
      }
    };
    document.addEventListener("visibilitychange", () => {
      if (document.hidden || !root || !frameTarget) return;
      if (root.style.visibility === "hidden") return; // 隐藏中（白名单外）：无需探测
      setTimeout(() => {
        if (!frameAlive()) navigate(frameTarget); // 白屏=假死，重载（盖 veil 走就绪信号流程）
      }, 2000);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
