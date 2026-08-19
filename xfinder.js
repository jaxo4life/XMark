/**
 * XMark · XFinder 高阶搜索（独立模块，自包含，与 content.js 零耦合）
 *
 * 形态：右栏替代品——仅在「界面净化·隐藏右侧边栏」开启时激活。
 *   · 圆钮：独立 fixed 元素（top:12px; right:20px，与 X 官方 Grok FAB 的
 *     right:20px 呼应），52px，X FAB 风格（主题底色 + 细边框 + 蓝色放大镜）
 *   · 面板：挂在 sidebarColumn 的父容器，grid 顶入空出的第三格（原右栏位置），
 *     完全复刻 X 官方侧栏卡片规格（20px/800 标题、灰底药丸搜索框、黑底主按钮）
 *   UI 规格对齐 X 官方：亮 #fff/#eff3f4/#f7f9f9，暗 #000/#16181c/#202327，
 *   蓝 #1d9bf0，字体继承页面 system-ui 栈。
 *
 * 查询（内核）：(from:user) keyword (@inter OR to:inter) since:.. until:.. [-filter:...]
 * 历史：storage.local.xfinderHistory（上限 20，指纹去重，重复置顶）
 * 开关：popup 功能 tab → xfinderSettings.enabled（默认开）+ uiCleanSettings.rightSidebar
 *
 * 移除本功能：删此文件 + manifest.json content_scripts 的 js 数组一项。
 *
 * ⚠️ 必须保持 IIFE：同 entry 多 content script 共享全局作用域，
 *    顶层声明会与 content.js 撞名抛 SyntaxError 且静默失败。
 */
(() => {
  "use strict";

  const HISTORY_KEY = "xfinderHistory";
  const SETTINGS_KEY = "xfinderSettings";
  const MAX_HISTORY = 20;

  // X 单段保留路径（原版只排 /home，曾把 explore 当用户名填入）
  const RESERVED_PATHS = new Set([
    "home", "explore", "notifications", "messages", "bookmarks",
    "lists", "settings", "search", "compose", "intent", "hashtag", "i",
  ]);

  let langData = {};
  let fabEl = null;
  let panel = null;

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

  // ---------- 样式（X 官方 UI 规格复刻） ----------
  function injectStyle() {
    if (document.getElementById("xmark-xfinder-style")) return;
    const css = `
/* ========== 圆钮（独立 fixed，右上；逐项复刻 X 官方 Grok 按钮 DevTools 实测值） ========== */
#xmark-xfinder-fab{position:fixed;top:12px;right:20px;width:55px;height:55px;border-radius:16px;background:rgba(255,255,255,.85);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border:1px solid rgb(159,181,195);box-shadow:0 0 15px rgba(101,119,134,.2),0 0 3px 1px rgba(101,119,134,.15);display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:1;color:#0f1419;outline:none;transition-property:background-color,box-shadow;transition-duration:.2s;padding:0;margin:0;line-height:1;text-align:center;animation:xf-fab-in .25s ease}
#xmark-xfinder-fab:hover{background:rgba(255,255,255,.95)}
#xmark-xfinder-fab svg{width:26.25px;height:26.25px;display:block}
@keyframes xf-fab-in{from{transform:translateX(64px);opacity:0}to{transform:none;opacity:1}}
/* 暗色：官方 DevTools 实测值（底色/边框）+ 白色辉光视觉补偿档（+20% blur/spread，
   官方原值 rgba(255,255,255,.2) 0 0 15px, rgba(255,255,255,.15) 0 0 3px 1px 在
   半透明底 + backdrop-filter 环境下观感偏小） */
html[data-xmark-theme="dark"] #xmark-xfinder-fab{background:rgba(0,0,0,.65);border-color:rgb(75,78,82);color:#e7e9ea;box-shadow:rgba(255,255,255,.2) 0 0 18px,rgba(255,255,255,.15) 0 0 4px 2px}
html[data-xmark-theme="dark"] #xmark-xfinder-fab:hover{background:rgba(0,0,0,.75)}

/* ========== 面板（右栏格位，X 侧栏卡片规格） ========== */
#xmark-xfinder-panel{position:sticky;top:0;width:100%;font-family:inherit;box-sizing:border-box;padding:12px 12px 24px;color:#0f1419;--xf-input:#eff3f4;--xf-hover:#f7f9f9;--xf-card:#fff;--xf-line:#eff3f4;--xf-muted:#536471;--xf-key:#0f1419;--xf-btn:#0f1419;--xf-btn-h:#272c30}
#xmark-xfinder-panel[data-theme="dark"]{--xf-input:#202327;--xf-hover:#16181c;--xf-card:#16181c;--xf-line:#2f3336;--xf-muted:#71767b;--xf-key:#e7e9ea;--xf-btn:#eff3f9;--xf-btn-h:#d7dbdc}
#xmark-xfinder-panel .xf-card{background:var(--xf-card);border:1px solid var(--xf-line);border-radius:16px;overflow:hidden;animation:xf-in .22s ease}
@keyframes xf-in{from{opacity:0;transform:translateX(28px)}to{opacity:1;transform:none}}
#xmark-xfinder-panel .xf-body{padding:16px}
#xmark-xfinder-panel .xf-field{margin-bottom:10px}

/* X 官方搜索框（当前版式）：透明底 + 1px 描边药丸 + 左侧放大镜 + focus 蓝描边 */
#xmark-xfinder-panel .xf-searchlike{position:relative;display:flex;align-items:center;background:transparent;border:1px solid #cfd9de;border-radius:9999px;transition:border-color .15s}
#xmark-xfinder-panel .xf-searchlike:focus-within{border-color:#1d9bf0}
#xmark-xfinder-panel[data-theme="dark"] .xf-searchlike{border-color:#2f3336}
#xmark-xfinder-panel .xf-searchlike>svg{flex:none;width:18.75px;height:18.75px;margin:0 12px;color:var(--xf-muted)}
#xmark-xfinder-panel .xf-searchlike:focus-within>svg{color:#1d9bf0}
/* from/to 文字前缀（对齐高级搜索语法，一眼可懂） */
#xmark-xfinder-panel .xf-prefix{flex:none;min-width:42px;text-align:center;margin:0 6px 0 12px;color:var(--xf-muted);font-size:13px;font-weight:700;font-family:ui-monospace,Consolas,monospace;letter-spacing:.2px}
#xmark-xfinder-panel .xf-searchlike:focus-within .xf-prefix{color:#1d9bf0}
#xmark-xfinder-panel .xf-searchlike input{flex:1;min-width:0;border:none;background:transparent;outline:none;font-size:15px;color:var(--xf-key);padding:10px 40px 10px 0;font-family:inherit}
#xmark-xfinder-panel .xf-searchlike input::placeholder{color:var(--xf-muted)}
#xmark-xfinder-panel .xf-searchlike input:disabled{cursor:not-allowed;opacity:.6}
/* 框内右侧问号：点击悬浮显示提示 */
#xmark-xfinder-panel .xf-help{flex:none;width:20px;height:20px;margin-right:10px;padding:0;border:none;background:none;color:var(--xf-muted);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;line-height:1}
#xmark-xfinder-panel .xf-help:hover{color:#1d9bf0}
#xmark-xfinder-panel .xf-help svg{width:20px;height:20px;display:block}
/* 提示浮层（搜索框下方） */
#xmark-xfinder-panel .xf-field{position:relative}
#xmark-xfinder-panel .xf-hint{display:none;position:absolute;top:calc(100% + 6px);left:0;right:0;background:var(--xf-card);border:1px solid var(--xf-line);border-radius:12px;box-shadow:0 4px 16px rgba(101,119,134,.25);padding:10px 14px;font-size:13px;line-height:1.7;color:var(--xf-key);z-index:5;white-space:pre-line}
#xmark-xfinder-panel .xf-hint.open{display:block}

/* 日期：同外框式 */
#xmark-xfinder-panel .xf-dates{display:flex;gap:10px;margin-bottom:10px}
#xmark-xfinder-panel .xf-dates>div{flex:1}
#xmark-xfinder-panel .xf-date{position:relative;display:flex;align-items:center;background:transparent;border:1px solid #cfd9de;border-radius:12px;transition:border-color .15s}
#xmark-xfinder-panel[data-theme="dark"] .xf-date{border-color:#2f3336}
#xmark-xfinder-panel .xf-date:focus-within{border-color:#1d9bf0}
#xmark-xfinder-panel .xf-date input{flex:1;min-width:0;border:none;background:transparent;outline:none;font-size:14px;color:var(--xf-key);padding:9px 12px;font-family:inherit}
#xmark-xfinder-panel .xf-date input::-webkit-calendar-picker-indicator{filter:none;cursor:pointer}

/* 排除项：X 列表行规格 */
#xmark-xfinder-panel .xf-row{display:flex;align-items:center;gap:10px;padding:8px 2px;font-size:14px;color:var(--xf-key);cursor:pointer;user-select:none}
#xmark-xfinder-panel .xf-row input{width:16px;height:16px;margin:0;accent-color:#1d9bf0;cursor:pointer}

/* 按钮：X Follow 规格（黑底白字，暗色反转）；显式 flex 居中，防 X 全局样式干扰 */
#xmark-xfinder-panel .xf-btns{display:flex;gap:10px;margin-top:12px}
#xmark-xfinder-panel button.xf-btn{flex:1;display:flex;align-items:center;justify-content:center;text-align:center;padding:10px 0;border:none;border-radius:9999px;font-size:14px;font-weight:700;line-height:1.2;cursor:pointer;background:var(--xf-btn);color:#fff;transition:background-color .15s;font-family:inherit}
#xmark-xfinder-panel[data-theme="dark"] button.xf-btn{color:#0f1419}
#xmark-xfinder-panel button.xf-btn:hover{background:var(--xf-btn-h)}
#xmark-xfinder-panel button.xf-ghost{background:transparent;color:var(--xf-key);border:1px solid #cfd9de}
#xmark-xfinder-panel[data-theme="dark"] button.xf-ghost{border-color:#536471;color:var(--xf-key)}
#xmark-xfinder-panel button.xf-ghost:hover{background:var(--xf-hover)}

/* toast：X 蓝底 */
#xmark-xfinder-panel .xf-toast{display:none;margin-top:10px;padding:9px 12px;border-radius:10px;background:#1d9bf0;color:#fff;font-size:13px;font-weight:500;text-align:center}

/* 历史：X 列表规格；最大 40vh 内部滚动，滚动条隐藏 */
#xmark-xfinder-panel .xf-history{margin-top:4px;border-top:1px solid var(--xf-line);max-height:40vh;overflow-y:auto;scrollbar-width:none}
#xmark-xfinder-panel .xf-history::-webkit-scrollbar{display:none}
#xmark-xfinder-panel .xf-hist-head{display:flex;justify-content:space-between;align-items:center;padding:10px 16px 6px;font-size:15px;font-weight:800;color:var(--xf-key)}
#xmark-xfinder-panel .xf-hist-clear{border:none;background:none;color:#f4212e;font-size:13px;font-weight:700;cursor:pointer;padding:4px 10px;border-radius:9999px;display:inline-flex;align-items:center;justify-content:center;line-height:1.2}
#xmark-xfinder-panel .xf-hist-clear:hover{background:rgba(244,33,46,.1)}
#xmark-xfinder-panel .xf-hist-item{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 16px;transition:background-color .15s}
#xmark-xfinder-panel .xf-hist-item:hover{background:var(--xf-hover)}
#xmark-xfinder-panel .xf-hist-item:hover .xf-hist-ops{visibility:visible}
#xmark-xfinder-panel .xf-hist-main{flex:1;min-width:0}
#xmark-xfinder-panel .xf-hist-user{font-size:15px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--xf-key)}
#xmark-xfinder-panel .xf-hist-meta{font-size:13px;color:var(--xf-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#xmark-xfinder-panel .xf-hist-ops{display:flex;gap:8px;visibility:hidden}
#xmark-xfinder-panel .xf-hist-ops button{border:none;border-radius:9999px;font-size:12px;font-weight:700;padding:5px 12px;cursor:pointer;color:#fff;display:inline-flex;align-items:center;justify-content:center;line-height:1.2}
#xmark-xfinder-panel .xf-hist-ops .rep{background:#0f1419}
#xmark-xfinder-panel[data-theme="dark"] .xf-hist-ops .rep{background:#eff3f9;color:#0f1419}
#xmark-xfinder-panel .xf-hist-ops .del{background:#f4212e}
#xmark-xfinder-panel .xf-empty{padding:16px;text-align:center;color:var(--xf-muted);font-size:14px}
`;
    const style = document.createElement("style");
    style.id = "xmark-xfinder-style";
    style.textContent = css;
    document.documentElement.appendChild(style);
  }

  // ---------- 用户主页判定 ----------
  function isUserProfilePage() {
    if (!/^\/[^/]+$/.test(location.pathname)) return false;
    if (RESERVED_PATHS.has(location.pathname.slice(1).toLowerCase())) return false;
    return !!document.querySelector('[data-testid="UserName"]');
  }

  // ---------- DOM ----------
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  // X 官方搜索图标（fill 型轮廓，与官方图标库同设计语言：闭合 path + currentColor）
  // ⚠️ xmlns 必须显式声明：svgNode 用 DOMParser 的 XML 模式解析，无 xmlns 的 <svg>
  //    不带 SVG 命名空间，importNode 后浏览器不当 SVG 渲染（整块空白）
  const SVG_SEARCH =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><g><path fill="currentColor" d="M10.25 3.75c-3.59 0-6.5 2.91-6.5 6.5s2.91 6.5 6.5 6.5c1.795 0 3.419-.726 4.596-1.904 1.178-1.177 1.904-2.801 1.904-4.596 0-3.59-2.91-6.5-6.5-6.5zm-8.5 6.5c0-4.694 3.806-8.5 8.5-8.5s8.5 3.806 8.5 8.5c0 1.986-.682 3.815-1.824 5.262l4.781 4.781-1.414 1.414-4.781-4.781c-1.447 1.142-3.276 1.824-5.262 1.824-4.694 0-8.5-3.806-8.5-8.5z"/></g></svg>';
  // X 官方圆问号图标（fill 型，同设计语言）
  const SVG_HELP =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><g><path fill="currentColor" d="M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm-10 8C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10S2 17.523 2 12zm8.5-2.25c0-.966.784-1.75 1.75-1.75h1.5c.966 0 1.75.784 1.75 1.75v1.086c0 .464-.184.909-.513 1.237l-1.034 1.034a1.25 1.25 0 0 0-.366.884v.509a.75.75 0 0 1-1.5 0v-.509c0-.464.184-.909.513-1.237l1.034-1.034a.25.25 0 0 0 .066-.166V9.75a.25.25 0 0 0-.25-.25h-1.5a.25.25 0 0 0-.25.25V10a.75.75 0 0 1-1.5 0v-.25zM11 15.5a1.25 1.25 0 1 1 2.5 0 1.25 1.25 0 0 1-2.5 0z"/></g></svg>';

  // SVG 常量字符串 → DOM 节点（DOMParser，纯常量无注入面）
  function svgNode(svgString) {
    const doc = new DOMParser().parseFromString(svgString, "image/svg+xml");
    return document.importNode(doc.documentElement, true);
  }

  // X 官方搜索框样式行：左侧文字前缀（from/key/to，对齐高级搜索语法）+ 输入 + 右侧问号
  function searchField(id, prefix, hintKey, hintFallback) {
    const field = el("div", "xf-field");
    const wrap = el("div", "xf-searchlike");
    wrap.appendChild(el("span", "xf-prefix", prefix));
    const input = document.createElement("input");
    input.type = "text";
    input.id = id;
    wrap.appendChild(input);
    const help = el("button", "xf-help");
    help.type = "button";
    help.setAttribute("aria-label", "help");
    help.appendChild(svgNode(SVG_HELP));
    wrap.appendChild(help);
    const hint = el("div", "xf-hint", t(hintKey, hintFallback));
    field.appendChild(wrap);
    field.appendChild(hint);
    help.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = hint.classList.toggle("open");
      // 同时只开一个
      panel
        .querySelectorAll(".xf-hint.open")
        .forEach((h) => h !== hint && h.classList.remove("open"));
      if (open) {
        const close = (ev) => {
          if (!hint.contains(ev.target) && ev.target !== help) {
            hint.classList.remove("open");
            document.removeEventListener("click", close);
          }
        };
        setTimeout(() => document.addEventListener("click", close), 0);
      }
    });
    return { field, wrap, input };
  }

  function buildFab() {
    fabEl = el("button", "");
    fabEl.id = "xmark-xfinder-fab";
    fabEl.title = t("xfTitle", "XFinder 高阶搜索");
    fabEl.setAttribute("aria-label", t("xfTitle", "XFinder 高阶搜索"));
    fabEl.appendChild(svgNode(SVG_SEARCH));
    fabEl.addEventListener("click", togglePanel);
    document.body.appendChild(fabEl);
    applyTheme(); // 建出即检测，不等 observer（修刷新时暗色延迟）
  }

  function buildPanel() {
    panel = el("div", "");
    panel.id = "xmark-xfinder-panel";

    const card = el("div", "xf-card");
    // 开关状态记忆：sessionStorage（标签页会话内保持，路由切换/重挂不丢）
    card.style.display =
      sessionStorage.getItem("xfinderPanelOpen") === "1" ? "block" : "none";

    // 表单体
    const body = el("div", "xf-body");

    const user = searchField(
      "xf-user",
      "from",
      "xfHintUser",
      "要搜索的 X 用户名（handle），不需要 @。\n在用户主页会自动填充当前用户。\n对应高级搜索语法 from:\n例：from:elonmusk"
    );
    body.appendChild(user.field);

    const keyword = searchField(
      "xf-keyword",
      "key",
      "xfHintKeyword",
      '支持 X 原生操作符（与关键词一起输入）：\n"精确短语" —— 引号包裹，整体匹配\nmin_faves:100 —— 至少 100 赞\nmin_retweets:50 —— 至少 50 转\nlang:zh —— 限定语言（zh / en / …）\n-单词 —— 排除含该词的结果\nfilter:media —— 仅含媒体\n例：特斯拉 min_faves:500 -广告'
    );
    body.appendChild(keyword.field);

    const inter = searchField(
      "xf-inter",
      "to",
      "xfHintInteraction",
      "搜索与该账户有互动的推文（不需要 @）：\n包括 @提及 该账户、以及回复给该账户的推文\n对应语法 (@账户 OR to:账户)\n例：查看谁在与 TA 互动、TA 回复了谁"
    );
    body.appendChild(inter.field);

    const dates = el("div", "xf-dates");
    const mkDate = (id) => {
      const d = el("div", "xf-date");
      const input = document.createElement("input");
      input.type = "date";
      input.id = id;
      d.appendChild(input);
      return d;
    };
    dates.appendChild(mkDate("xf-start"));
    dates.appendChild(mkDate("xf-end"));
    body.appendChild(dates);

    const row = el("label", "xf-row");
    const exclude = document.createElement("input");
    exclude.type = "checkbox";
    exclude.id = "xf-exclude";
    row.appendChild(exclude);
    row.appendChild(document.createTextNode(t("xfExcludeNoise", "排除转推与回复")));
    body.appendChild(row);

    const btns = el("div", "xf-btns");
    const searchBtn = el("button", "xf-btn", t("xfSearchBtn", "搜索推文"));
    const histBtn = el("button", "xf-btn xf-ghost", t("xfHistoryBtn", "搜索历史"));
    btns.appendChild(searchBtn);
    btns.appendChild(histBtn);
    body.appendChild(btns);

    const toast = el("div", "xf-toast");
    toast.id = "xf-toast";
    body.appendChild(toast);

    const history = el("div", "xf-history");
    history.id = "xf-history";
    history.style.display = "none";
    body.appendChild(history);

    card.appendChild(body);
    panel.appendChild(card);

    applyTexts();
    syncUserField();
    applyTheme();

    // 事件
    searchBtn.addEventListener("click", doSearch);
    histBtn.addEventListener("click", toggleHistory);
    [user.input, keyword.input, inter.input].forEach((input) => {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") doSearch();
      });
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closePanel();
    });
  }

  function applyTexts() {
    if (!panel) return;
    const set = (id, key, fb) => {
      panel.querySelector("#" + id).placeholder = t(key, fb);
    };
    set("xf-keyword", "xfKeyword", "关键词");
    set("xf-inter", "xfInteraction", "交互账户");
    if (!isUserProfilePage()) {
      set("xf-user", "xfSearchUser", "搜索对象");
    }
  }

  function syncUserField() {
    if (!panel) return;
    const user = panel.querySelector("#xf-user");
    if (isUserProfilePage()) {
      user.value = location.pathname.slice(1);
      user.disabled = true;
      user.placeholder = t("xfSearchUserLocked", "当前用户");
    } else if (user.disabled) {
      user.disabled = false;
      user.value = "";
      user.placeholder = t("xfSearchUser", "搜索对象（不需要@）");
    }
  }

  // 暗色检测三层信号：html color-scheme（X 切主题即改）→ meta theme-color
  // （head 静态存在，刷新最早可读，随主题变）→ body 背景亮度兜底（渲染完成后）
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
    document.documentElement.dataset.xmarkTheme = dark ? "dark" : "light";
    panel?.setAttribute("data-theme", dark ? "dark" : "light");
  }

  function togglePanel() {
    if (!panel) return;
    const card = panel.querySelector(".xf-card");
    const open = card.style.display !== "none";
    card.style.display = open ? "none" : "block";
    sessionStorage.setItem("xfinderPanelOpen", open ? "0" : "1"); // 记忆开关状态
    if (!open) {
      applyTheme();
      syncUserField();
    }
  }

  function closePanel() {
    const card = panel?.querySelector(".xf-card");
    if (card) card.style.display = "none";
  }

  // ---------- 查询构造（内核） ----------
  function readForm() {
    const g = (id) => panel.querySelector("#" + id);
    return {
      username: g("xf-user").value.trim(),
      keyword: g("xf-keyword").value.trim(),
      interaction: g("xf-inter").value.trim(),
      startDate: g("xf-start").value,
      endDate: g("xf-end").value,
      exclude: g("xf-exclude").checked,
    };
  }

  function buildQuery(f) {
    let q = "";
    if (f.username) q += `(from:${f.username})`;
    if (f.keyword) q += ` ${f.keyword}`;
    if (f.interaction) q += ` (@${f.interaction} OR to:${f.interaction})`;
    if (f.startDate) q += ` since:${f.startDate}`;
    if (f.endDate) q += ` until:${f.endDate}`;
    if (f.exclude) q += ` -filter:retweets -filter:replies`;
    return q.trim();
  }

  function showToast(msg) {
    const toast = panel.querySelector("#xf-toast");
    toast.textContent = msg;
    toast.style.display = "block";
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => (toast.style.display = "none"), 2000);
  }

  async function doSearch() {
    const f = readForm();
    if (!f.keyword && !f.interaction && !f.startDate && !f.endDate) {
      showToast(t("xfValidationError", "请至少填写关键词、交互账户或日期"));
      return;
    }
    const query = buildQuery(f);
    const searchUrl = `https://${location.hostname}/search?q=${encodeURIComponent(
      query
    )}&f=live`;
    await saveHistory(f);
    window.open(searchUrl, "_blank");
  }

  // ---------- 历史（内核） ----------
  const fingerprint = (f) =>
    [f.username, f.keyword, f.interaction, f.startDate, f.endDate, f.exclude]
      .map((v) => v || "")
      .join("|");

  async function saveHistory(f) {
    try {
      const { [HISTORY_KEY]: history = [] } = await chrome.storage.local.get([
        HISTORY_KEY,
      ]);
      const fp = fingerprint(f);
      const next = [
        { id: crypto.randomUUID(), timestamp: new Date().toISOString(), ...f },
        ...history.filter((h) => fingerprint(h) !== fp),
      ].slice(0, MAX_HISTORY);
      await chrome.storage.local.set({ [HISTORY_KEY]: next });
      renderHistory();
    } catch (e) {
      /* ignore */
    }
  }

  function histSummary(f) {
    const parts = [];
    if (f.keyword) parts.push(f.keyword);
    if (f.interaction) parts.push("@" + f.interaction);
    if (f.startDate || f.endDate)
      parts.push(`${f.startDate || "…"} ~ ${f.endDate || "…"}`);
    if (f.exclude) parts.push("-RT/-回复");
    return parts.join(" · ");
  }

  // 序列号防竞态：storage.onChanged 与操作回调可能并发触发两次渲染，
  // 各自的 storage.get 回调交错（清空→清空→追加→追加）会产生双份列表——过期渲染丢弃
  let renderSeq = 0;
  function renderHistory() {
    const box = panel?.querySelector("#xf-history");
    if (!box || box.style.display === "none") return;
    const seq = ++renderSeq;
    chrome.storage.local.get([HISTORY_KEY], ({ [HISTORY_KEY]: history = [] }) => {
      if (seq !== renderSeq) return; // 已有更新的渲染请求，本次丢弃
      box.textContent = "";
      const head = el("div", "xf-hist-head");
      head.appendChild(el("span", "", t("xfHistoryBtn", "搜索历史")));
      if (history.length) {
        const clear = el("button", "xf-hist-clear", t("xfClearAll", "清空历史"));
        clear.addEventListener("click", async () => {
          if (!confirm(t("xfConfirmClear", "确定清空所有搜索历史吗？"))) return;
          await chrome.storage.local.set({ [HISTORY_KEY]: [] });
          renderHistory();
        });
        head.appendChild(clear);
      }
      box.appendChild(head);

      if (!history.length) {
        box.appendChild(el("div", "xf-empty", t("xfHistoryEmpty", "暂无搜索历史")));
        return;
      }

      history.forEach((item) => {
        const row = el("div", "xf-hist-item");
        const main = el("div", "xf-hist-main");
        main.appendChild(el("div", "xf-hist-user", item.username || "（任意用户）"));
        main.appendChild(el("div", "xf-hist-meta", histSummary(item)));
        const ops = el("div", "xf-hist-ops");
        const rep = el("button", "rep", t("xfRepeat", "重复"));
        rep.addEventListener("click", () => applyAndSearch(item));
        const del = el("button", "del", t("xfDelete", "删除"));
        del.addEventListener("click", async () => {
          const { [HISTORY_KEY]: history = [] } =
            await chrome.storage.local.get([HISTORY_KEY]);
          await chrome.storage.local.set({
            [HISTORY_KEY]: history.filter((h) => h.id !== item.id),
          });
          renderHistory();
        });
        ops.appendChild(rep);
        ops.appendChild(del);
        row.appendChild(main);
        row.appendChild(ops);
        box.appendChild(row);
      });
    });
  }

  function applyAndSearch(item) {
    const g = (id) => panel.querySelector("#" + id);
    g("xf-keyword").value = item.keyword || "";
    g("xf-inter").value = item.interaction || "";
    g("xf-start").value = item.startDate || "";
    g("xf-end").value = item.endDate || "";
    g("xf-exclude").checked = !!item.exclude;
    const userField = g("xf-user");
    if (!userField.disabled) userField.value = item.username || "";
    doSearch();
  }

  function toggleHistory() {
    const box = panel.querySelector("#xf-history");
    box.style.display = box.style.display === "none" ? "block" : "none";
    if (box.style.display !== "none") renderHistory();
  }

  // ---------- 注入与生命周期 ----------
  async function readFlags() {
    try {
      const { [SETTINGS_KEY]: xf, uiCleanSettings: uc } =
        await chrome.storage.local.get([SETTINGS_KEY, "uiCleanSettings"]);
      return {
        xfinderOn: xf?.enabled !== false,
        rightHidden: uc?.rightSidebar === true,
      };
    } catch (e) {
      return { xfinderOn: true, rightHidden: false };
    }
  }

  function ensureUI() {
    const fab = document.getElementById("xmark-xfinder-fab");
    const panelEl = document.getElementById("xmark-xfinder-panel");
    const sidebar = document.querySelector('[data-testid="sidebarColumn"]');
    const host = sidebar?.parentElement;

    if (!fab && !fabEl) buildFab();

    if (!host) {
      panelEl?.remove();
      panel = null;
      return; // 布局未就绪/无右栏：圆钮可留，面板等下一轮
    }
    if (panelEl && panelEl.parentElement === host) {
      syncUserField();
      return;
    }
    if (!panel) buildPanel();
    host.appendChild(panel); // grid：sidebarColumn 已 display:none，本节点顶入第三格
  }

  function teardownUI() {
    document.getElementById("xmark-xfinder-fab")?.remove();
    document.getElementById("xmark-xfinder-panel")?.remove();
    fabEl = null;
    panel = null;
  }

  async function start() {
    injectStyle();
    await loadLang();
    const { xfinderOn, rightHidden } = await readFlags();
    if (xfinderOn && rightHidden) ensureUI();

    let timer = null;
    new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        applyTheme(); // 每轮检测主题（修复暗色切换延迟：圆钮此前只在面板打开时才更新）
        const { xfinderOn: on, rightHidden: rh } = await readFlags();
        if (on && rh) ensureUI();
        else teardownUI();
      }, 400);
    }).observe(document.body, { childList: true, subtree: true });

    try {
      chrome.storage.onChanged.addListener(async (changes, area) => {
        if (area !== "local") return;
        if (changes[SETTINGS_KEY] || changes.uiCleanSettings) {
          const { xfinderOn: on, rightHidden: rh } = await readFlags();
          if (on && rh) ensureUI();
          else teardownUI();
        }
        if (changes.lang) {
          // 语言即时生效：重载文案后重建面板（按钮/placeholder/hint 全量刷新）
          await loadLang();
          document.getElementById("xmark-xfinder-panel")?.remove();
          panel = null;
          if (fabEl) {
            fabEl.title = t("xfTitle", "XFinder 高阶搜索");
            fabEl.setAttribute("aria-label", fabEl.title);
          }
          const { xfinderOn: on, rightHidden: rh } = await readFlags();
          if (on && rh) ensureUI();
        }
        if (changes[HISTORY_KEY]) renderHistory();
      });
    } catch (e) {
      /* ignore */
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
