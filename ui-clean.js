/**
 * XMark 界面净化（独立模块，自包含，与 content.js 零耦合）
 *
 * 功能：隐藏 X 左侧菜单指定项（探索/Grok/Premium/Money/文章）+ 右侧边栏（搜索/趋势/推荐关注）
 * 设置：chrome.storage.local.uiCleanSettings = { <id>: true/false, rightSidebar: true/false }
 *       由 popup「功能」tab 的控制面板写入；storage.onChanged 实时生效，无需刷新页面
 *
 * 实现策略（选择器三重兜底，抗 X 改版）：
 *   1. data-testid（X 测试钩子，相对稳定）→ 注入静态 CSS，body 类隔离，新渲染元素自动命中
 *   2. href 路径（/explore、/i/grok 等）→ 同上，静态 CSS
 *   3. 可见文本（中/英文标签）→ MutationObserver 防抖补挂类（CSS 无法按文本匹配）
 *
 * 移除本功能：删此文件 + manifest.json content_scripts 里一行即可
 */
(() => {
  "use strict";

  // 菜单项配置：加新项只需在此追加一条（popup.js 的 UI_CLEAN_ITEMS 需同步加对应行）
  const NAV_ITEMS = [
    {
      id: "explore",
      labels: ["探索", "Explore"],
      selectors:
        'nav a[data-testid="AppTabBar_Explore_Link"], nav a[href="/explore"]',
    },
    {
      id: "grok",
      labels: ["Grok"],
      selectors: 'nav a[data-testid="AppTabBar_Grok_Link"], nav a[href="/i/grok"]',
    },
    {
      id: "premium",
      labels: ["Premium"],
      selectors:
        'nav a[data-testid="AppTabBar_Premium_Link"], nav a[href^="/i/premium"], nav a[href^="/i/twitter_blue"]',
    },
    {
      id: "money",
      labels: ["Money", "X Money"],
      selectors: 'nav a[data-testid="AppTabBar_Money_Link"], nav a[href="/i/money"]',
    },
    {
      id: "articles",
      labels: ["文章", "Articles"],
      selectors:
        'nav a[data-testid="AppTabBar_Articles_Link"], nav a[href="/i/articles"]',
    },
    {
      id: "following",
      labels: ["关注", "Following"],
      selectors:
        'nav a[data-testid="AppTabBar_Following_Link"], nav a[href="/following"]',
    },
    {
      id: "creatorStudio",
      labels: ["创作者工作室", "Creator Studio"],
      selectors:
        'nav a[data-testid="AppTabBar_CreatorStudio_Link"], nav a[href="/creatorstudio"], nav a[href^="/i/creator"]',
    },
    {
      id: "more",
      labels: ["更多", "More"],
      // 「更多」是按钮不是链接（无 href），testid 是主路径，文本兜底靠 nav button 扫描
      selectors: 'nav [data-testid="AppTabBar_More_Menu"]',
    },
  ];
  const RIGHT_SIDEBAR = {
    id: "rightSidebar",
    selectors: '[data-testid="sidebarColumn"]',
  };

  let settings = {}; // 当前生效的勾选

  // 注入静态 CSS（按 body 类隔离；文本兜底类通用）
  // ⚠️ CSS 逗号是独立选择器列表：拼 "body.cls selA, selB" 时 selB 不继承 body.cls 前缀，
  //    会变成无条件规则——必须逐条拆开各自加前缀（曾因此 href 选择器无条件隐藏菜单项）
  function injectStyle() {
    if (document.getElementById("xmark-ui-clean-style")) return;
    const prefixed = (cls, selectors) =>
      selectors
        .split(",")
        .map((s) => `body.${cls} ${s.trim()}{display:none!important}`);
    const rules = [
      ...prefixed(`xmark-hide-${RIGHT_SIDEBAR.id}`, RIGHT_SIDEBAR.selectors),
      ...NAV_ITEMS.flatMap((it) =>
        prefixed(`xmark-hide-${it.id}`, it.selectors)
      ),
      ".xmark-ui-nav-hidden{display:none!important}",
    ];
    const style = document.createElement("style");
    style.id = "xmark-ui-clean-style";
    style.textContent = rules.join("\n");
    document.documentElement.appendChild(style);
  }

  // 应用当前设置（幂等；关闭项自动还原）
  function apply() {
    try {
      for (const it of NAV_ITEMS) {
        document.body.classList.toggle(`xmark-hide-${it.id}`, !!settings[it.id]);
      }
      document.body.classList.toggle(
        `xmark-hide-${RIGHT_SIDEBAR.id}`,
        !!settings[RIGHT_SIDEBAR.id]
      );

      // 文本兜底：只有"已启用项"的 label 才隐藏（关闭项即使文本命中也要还原）
      // 扫描范围含 button——「更多」等按钮型菜单项无 href
      const hiddenLabels = new Set(
        NAV_ITEMS.filter((it) => settings[it.id]).flatMap((it) => it.labels)
      );
      document
        .querySelectorAll("nav a[href], nav button")
        .forEach((a) => {
          const t = (a.textContent || "").trim();
          if (t && hiddenLabels.has(t)) a.classList.add("xmark-ui-nav-hidden");
          else a.classList.remove("xmark-ui-nav-hidden");
        });
    } catch (e) {
      /* 扩展上下文失效等场景静默 */
    }
  }

  async function loadAndApply() {
    try {
      const { uiCleanSettings = {} } = await chrome.storage.local.get([
        "uiCleanSettings",
      ]);
      settings = uiCleanSettings;
      apply();
    } catch (e) {
      /* ignore */
    }
  }

  // 文本兜底需要 observer 补挂（静态 CSS 由 body 类自动命中 X 重渲染的新元素）
  let timer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(apply, 400);
  });

  function start() {
    injectStyle();
    loadAndApply();
    observer.observe(document.body, { childList: true, subtree: true });
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes.uiCleanSettings) {
          loadAndApply();
        }
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
