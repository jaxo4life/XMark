/**
 * XMark 界面净化（独立模块，自包含，与 content.js 零耦合）
 *
 * 功能：隐藏 X 左侧菜单指定项（探索/Grok/Premium/Money/文章）+ 右侧边栏（搜索/趋势/推荐关注）
 *       + 只读模式（隐藏发帖入口与推文操作栏写按钮、拦截写操作快捷键，克制发言用）
 * 设置：chrome.storage.local.uiCleanSettings = { <id>: true/false, rightSidebar: true/false, readOnly: true/false }
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
      id: "calls",
      labels: ["呼叫", "Calls"],
      selectors: 'nav a[data-testid="AppTabBar_Calls_Link"], nav a[href="/i/calls"]',
    },
    {
      id: "following",
      labels: ["关注", "Following"],
      // 2026-10 X 改版：testid Follow_Link、href /i/connect_people（旧值保留兼容灰度）
      selectors:
        'nav a[data-testid="AppTabBar_Following_Link"], nav a[data-testid="AppTabBar_Follow_Link"], nav a[href="/following"], nav a[href="/i/connect_people"]',
    },
    {
      id: "creatorStudio",
      labels: ["创作者工作室", "Creator Studio"],
      // 2026-10 X 改版：迁至 /i/jf/creators/*；且该项可能渲染在 nav 外（header 左栏
      // 其它容器）——nav 与 header[role=banner] 双前缀防漏（正文链接不受 header 前缀误伤）
      selectors:
        'nav a[data-testid="AppTabBar_CreatorStudio_Link"], nav a[href="/creatorstudio"], nav a[href^="/i/creator"], nav a[href^="/i/jf/creators"], header[role="banner"] a[href^="/i/jf/creators"]',
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

  // 只读模式：克制发言的自我管控工具。操作栏只留截图按钮（.screenshot-btn 由
  // content.js 注入 group 直接子级），发帖入口全藏，写操作快捷键拦于 capture。
  // ⚠️ 选择器清单与 frame-clean.js 各持一份（零耦合纪律），改动须两处同步。
  const READ_ONLY = {
    bodyClass: "xmark-readonly",
    hiddenClass: "xmark-ro-hidden",
    // 操作栏写按钮（含已赞/已转/已收藏状态变体，漏一个就漏藏）+ 分析链接 +
    // 分享按钮（无 testid，实测 DOM 证实；group 内带弹出菜单属性且无 testid 的仅它）
    actionSelectors: [
      '[data-testid="reply"]',
      '[data-testid="retweet"]',
      '[data-testid="unretweet"]',
      '[data-testid="like"]',
      '[data-testid="unlike"]',
      '[data-testid="bookmark"]',
      '[data-testid="removeBookmark"]',
      'a[href$="/analytics"]',
      '[role="group"] button[aria-haspopup="menu"]:not([data-testid])',
    ],
    // 发帖入口：左栏发帖大按钮 / home composer 整格 / 详情页内联回复框 / 移动端 FAB
    // ⚠️ composer 格必须 :not(:has(article))——推文详情页主推文格的 cellInnerDiv 内
    // 也含离屏回复框（tweetTextarea_0 挂在 inline_reply_offscreen 里），裸 :has 会
    // 误杀整条主推文；详情页回复框单独藏 inline_reply_offscreen 容器本身
    composeSelectors: [
      '[data-testid="SideNav_NewTweet_Button"]',
      '[data-testid="cellInnerDiv"]:has([data-testid="tweetTextarea_0"]):not(:has(article))',
      '[data-testid="cellInnerDiv"]:has([data-testid="tweetTextareaInline"]):not(:has(article))',
      '[data-testid="inline_reply_offscreen"]',
      '[data-testid="FloatingActionButtons_Column"]',
    ],
    // X 写操作快捷键：n 新推文 / r 回复 / l 点赞 / t 转推 / b 书签
    hotkeys: new Set(["n", "r", "l", "t", "b"]),
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
      // 只读模式静态层：新渲染元素即时命中（JS 兜底管漏网，见 apply）
      ...prefixed(
        READ_ONLY.bodyClass,
        [...READ_ONLY.actionSelectors, ...READ_ONLY.composeSelectors].join(",")
      ),
      ".xmark-ui-nav-hidden{display:none!important}",
      // 只读模式操作栏只剩截图按钮 → 水平居中（flex 行容器内 margin auto 吃满余空）
      'body.xmark-readonly [role="group"] > .screenshot-btn{margin:0 auto}',
      `.${READ_ONLY.hiddenClass}{display:none!important}`,
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

      // 只读模式：body 类切静态 CSS；JS 兜底对操作栏 group（结构 group >
      // 按钮 wrapper > 写按钮），除截图按钮（.screenshot-btn，group 直接子级）
      // 外子级全挂隐藏类——未来 X 新增操作按钮自动被藏。⚠️ 必须用 > * > 收紧
      // 到隔代：大图 modal 的最外层容器也是 role="group" 且深层含写按钮，
      // 裸 :has 后代匹配会把整个 modal（mask/图片/对话区）当操作栏全藏。
      // 关闭时全量摘类还原。
      document.body.classList.toggle(READ_ONLY.bodyClass, !!settings.readOnly);
      if (settings.readOnly) {
        const groups = document.querySelectorAll(
          '[role="group"]:has(> * > [data-testid="reply"]), [role="group"]:has(> * > [data-testid="retweet"]), [role="group"]:has(> * > [data-testid="like"])'
        );
        groups.forEach((g) => {
          for (const child of g.children) {
            if (!child.classList.contains("screenshot-btn"))
              child.classList.add(READ_ONLY.hiddenClass);
          }
        });
      } else {
        document
          .querySelectorAll(`.${READ_ONLY.hiddenClass}`)
          .forEach((el) => el.classList.remove(READ_ONLY.hiddenClass));
      }

      // 文本兜底：只有"已启用项"的 label 才隐藏（关闭项即使文本命中也要还原）
      // 扫描范围含 button（「更多」等按钮型菜单项无 href）+ header 左栏容器
      // （「创作者工作室」等项可能渲染在 nav 外的 header 子容器里）
      const hiddenLabels = new Set(
        NAV_ITEMS.filter((it) => settings[it.id]).flatMap((it) => it.labels)
      );
      document
        .querySelectorAll(
          'nav a[href], nav button, header[role="banner"] a[href], header[role="banner"] button'
        )
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

    // 只读模式：capture 拦 X 写操作快捷键（n/r/l/t/b），先于 X 自身监听收到。
    // 放行：输入框/文本域/contentEditable（正常打字不能被吃）+ ctrl/meta/alt 组合键。
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (!document.body?.classList.contains(READ_ONLY.bodyClass)) return;
        const t = e.target;
        if (
          t &&
          (t.isContentEditable ||
            /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
        )
          return;
        if (READ_ONLY.hotkeys.has(e.key.toLowerCase())) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      true
    );
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
