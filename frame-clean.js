/**
 * XMark · 右列 Timeline 帧内增强（独立模块，仅 iframe 内运行）
 *
 * 职责：右列 iframe（/i/lists/* 等）内——
 *   1. 隐藏 X 左边栏（360px 窄断点下的图标栏）
 *   2. 隐藏列表页顶部 header 区（banner/列表名/创建者/成员数/编辑按钮）
 *   3. 广告推文隐藏（跟随「界面净化·隐藏广告推文」开关 uiCleanSettings.hideAds）
 *   4. 帧内导航接管：X 对 iframe 有意降级为完整文档导航（文档销毁/滚动丢失），
 *      拦截 <a> 点击转 pushState + popstate 交 X 路由 SPA 渲染（失败自禁用并回滚）
 *   5. 只读模式（跟随 uiCleanSettings.readOnly）：藏帧内操作栏写按钮/发帖入口 +
 *      拦写操作快捷键——清单与 ui-clean.js 各持一份，改动须两处同步
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
/* 列表时间线页的返回按钮禁用态（iframe 以列表为首页，返回无处可去） */
button[data-testid="app-bar-back"]:disabled{opacity:.4;pointer-events:none}
/* 只读模式静态层（body 类由 processReadOnly 挂；⚠️ 逗号后选择器不继承前缀，逐条写）
   ——清单与 ui-clean.js 的 READ_ONLY 同步维护 */
body.xmark-readonly [data-testid="reply"]{display:none!important}
body.xmark-readonly [data-testid="retweet"]{display:none!important}
body.xmark-readonly [data-testid="unretweet"]{display:none!important}
body.xmark-readonly [data-testid="like"]{display:none!important}
body.xmark-readonly [data-testid="unlike"]{display:none!important}
body.xmark-readonly [data-testid="bookmark"]{display:none!important}
body.xmark-readonly [data-testid="removeBookmark"]{display:none!important}
body.xmark-readonly a[href$="/analytics"]{display:none!important}
body.xmark-readonly [role="group"] button[aria-haspopup="menu"]:not([data-testid]){display:none!important}
body.xmark-readonly [data-testid="SideNav_NewTweet_Button"]{display:none!important}
/* composer 格必须 :not(:has(article))——详情页主推文格 cellInnerDiv 内含离屏回复框
   （tweetTextarea_0 在 inline_reply_offscreen 里），裸 :has 误杀整条主推文 */
body.xmark-readonly [data-testid="cellInnerDiv"]:has([data-testid="tweetTextarea_0"]):not(:has(article)){display:none!important}
body.xmark-readonly [data-testid="cellInnerDiv"]:has([data-testid="tweetTextareaInline"]):not(:has(article)){display:none!important}
body.xmark-readonly [data-testid="inline_reply_offscreen"]{display:none!important}
body.xmark-readonly [data-testid="FloatingActionButtons_Column"]{display:none!important}
/* 只读模式操作栏只剩截图按钮 → 水平居中（flex 行容器内 margin auto 吃满余空） */
body.xmark-readonly [role="group"] > .screenshot-btn{margin:0 auto}
body.xmark-readonly .xmark-ro-hidden{display:none!important}
`;
    const style = document.createElement("style");
    style.id = "xmark-frame-clean-style";
    style.textContent = css;
    document.documentElement.appendChild(style);
  }

  let hideAds = true; // 默认开，与 uiCleanSettings.hideAds 默认一致
  let readOnly = false; // 只读模式，默认关（与 uiCleanSettings.readOnly 同步）

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
  // inlinePrompt 结构特征（X 自带标识，零误伤）优先，关键词兜底
  function processAds() {
    if (!hideAds) return;
    document.querySelectorAll('[data-testid="tweet"]').forEach((tweet) => {
      if (tweet.hasAttribute("data-xmark-frame-ad")) return;
      const isAd =
        !!tweet.querySelector('[data-testid="inlinePrompt"]') ||
        [...tweet.querySelectorAll('div[dir="ltr"] span')].some(
          (span) => ADS_KEYWORDS.includes((span.textContent || "").trim())
        );
      if (isAd) {
        tweet.setAttribute("data-xmark-frame-ad", "1");
        tweet.style.display = "none";
      }
    });
    // 独立格子形态（inlinePrompt 不在推文内）→ 隐藏所属推文格容器
    document
      .querySelectorAll('[data-testid="inlinePrompt"]')
      .forEach((prompt) => {
        if (prompt.closest('[data-testid="tweet"]')) return;
        const cell = prompt.closest('[data-testid="cellInnerDiv"]') || prompt;
        if (cell.hasAttribute("data-xmark-frame-ad")) return;
        cell.setAttribute("data-xmark-frame-ad", "1");
        cell.style.display = "none";
      });
  }

  async function loadHideAds() {
    try {
      const { uiCleanSettings } = await chrome.storage.local.get([
        "uiCleanSettings",
      ]);
      hideAds = uiCleanSettings?.hideAds !== false;
      readOnly = !!uiCleanSettings?.readOnly;
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

  // 只读模式：body 类切静态 CSS + 操作栏 group 级 JS 兜底（结构 group >
  // 按钮 wrapper > 写按钮，隔代收紧防大图 modal 外层 role=group 容器误伤，
  // 见 ui-clean.js 同款注释；除截图按钮外子级全藏，关闭全量摘类）
  function processReadOnly() {
    if (!document.body) return;
    document.body.classList.toggle("xmark-readonly", readOnly);
    if (readOnly) {
      document
        .querySelectorAll(
          '[role="group"]:has(> * > [data-testid="reply"]), [role="group"]:has(> * > [data-testid="retweet"]), [role="group"]:has(> * > [data-testid="like"])'
        )
        .forEach((g) => {
          for (const child of g.children) {
            if (!child.classList.contains("screenshot-btn"))
              child.classList.add("xmark-ro-hidden");
          }
        });
    } else {
      document.querySelectorAll(".xmark-ro-hidden").forEach((el) =>
        el.classList.remove("xmark-ro-hidden")
      );
    }
  }

  // ---------- 用户页链接 → 顶层原生打开 ----------
  // 帧内点用户名/头像/@提及：不在帧内纵深（用户页交给 X 主环境全功能渲染：关注/
  // 私信/标签页都在顶层），右列零动作。实现：跨帧同域直接调顶层 pushState + 向
  // 顶层派发 popstate（顶层 X 路由的后退键级监听，必健壮）原地渲染用户页——
  // 顶层的 listcol pushState 包装同链触发（用户页在白名单 → 列继续显示）。
  // 500ms 顶层 title 未变 = 未接管 → location.replace 整页兜底（最后手段）。
  // 保留字表与 listcol.js 的 RESERVED_PATHS 保持同步（两处各持一份，零耦合纪律）。
  const RESERVED_PATHS = new Set([
    "home", "explore", "notifications", "messages", "bookmarks", "lists",
    "profile", "settings", "i", "search", "compose", "intent", "login",
    "signup", "grok", "premium", "money", "articles", "following",
    "creator_studio", "analytics", "connect", "moments", "topics", "safety",
    "personalization", "data", "account", "share", "live", "hashtag",
  ]);
  const PROFILE_PATH =
    /^\/([^/]+?)(?:\/(?:with_replies|media|likes|following|followers|verified_followers))?\/?$/;
  function isProfileLink(p) {
    const m = p.match(PROFILE_PATH);
    return !!m && !RESERVED_PATHS.has(m[1].toLowerCase());
  }

  function topNavigate(path) {
    const top = window.top;
    if (!top || top === window.self) return; // 防御：不在帧内
    if (top.location.pathname === path) return; // 已在该用户页：零动作
    const beforeTitle = top.document.title;
    try {
      top.history.pushState(top.history.state, "", path);
      top.dispatchEvent(
        new PopStateEvent("popstate", { state: top.history.state })
      );
    } catch (e) {
      try {
        top.location.replace(path);
      } catch (e2) {
        /* 跨域 top：放弃 */
      }
      return;
    }
    setTimeout(() => {
      // 接管信号：title 变化或用户页 header（UserName）出现，任一即成功
      const took =
        top.document.title !== beforeTitle ||
        !!top.document.querySelector('[data-testid="UserName"]');
      if (!took) {
        try {
          top.location.replace(path);
        } catch (e) {
          /* ignore */
        }
      }
    }, 800);
  }

  // ---------- 帧内导航接管 ----------
  // X 在 iframe 里把站内链接降级为完整文档导航（文档销毁、滚动丢失、整帧重载）。
  // 替 X 补上 SPA：capture 拦截同源相对链接的无修饰键点击 → pushState + 派发
  // popstate（X 路由的 popstate 监听常挂——浏览器后退依赖它）→ 路由接管原地渲染。
  // 只 preventDefault 不 stopPropagation：若 X 对个别链接自有处理则不干扰。
  // 500ms 内 title / 推文格数 / 路径均无变化 = X 未接管 → location.replace 原地址
  // 完整导航（= 优化前行为；replace 恰好替换我们 push 的栈条目，历史不残留），
  // 并永久禁用接管（一次性 500ms 成本，之后回到纯原生行为）。
  // 接管成功时无文档导航，父页 beforeunload veil 不触发（原地顺滑切换，不动 iframe）。
  let navTakeoverBroken = false;

  function hookFrameNav() {
    document.addEventListener(
      "click",
      (e) => {
        if (
          navTakeoverBroken ||
          e.defaultPrevented ||
          e.button !== 0 ||
          e.metaKey ||
          e.ctrlKey ||
          e.shiftKey ||
          e.altKey
        ) {
          return;
        }
        const a = e.target?.closest?.('a[href^="/"]');
        if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
        if (a.closest('[data-testid="app-bar-back"]')) return; // 返回按钮归 hookBackBtn 管
        const url = a.getAttribute("href");
        if (!url || url.startsWith("//")) return;
        let toPath;
        try {
          toPath = new URL(url, location.href).pathname;
        } catch (err) {
          return;
        }

        // 用户页族链接（用户名/头像/@提及）→ 顶层原生打开，右列零动作
        if (isProfileLink(toPath)) {
          e.preventDefault();
          e.stopPropagation();
          topNavigate(toPath);
          return;
        }

        const beforeTitle = document.title;
        const beforeCells = document.querySelectorAll(
          '[data-testid="cellInnerDiv"]'
        ).length;
        const beforePath = location.pathname;
        // 同页链接不接管（探针三态全不变必误判刷新自己）
        if (toPath === beforePath) return;

        e.preventDefault();
        history.pushState(history.state, "", url);
        dispatchEvent(new PopStateEvent("popstate", { state: history.state }));

        setTimeout(() => {
          const tookOver =
            document.title !== beforeTitle ||
            document.querySelectorAll('[data-testid="cellInnerDiv"]').length !==
              beforeCells ||
            location.pathname !== beforePath;
          if (!tookOver) {
            navTakeoverBroken = true;
            location.replace(url);
          }
        }, 500);
      },
      true
    );
  }

  // 列表时间线页隐藏返回按钮：iframe 以 /i/lists/<id> 为首页，返回无处可去
  // （点击只会触发空历史导航或混乱回退）；disabled 兜底 + 直接 display:none 隐藏
  // （列表名顶格，还原原生列表时间线观感）。离开列表页（推文页）自动恢复。
  // React 重渲染可能覆盖内联样式，随 observer 轮幂等重设。
  function processBackBtn() {
    const onList = /^\/i\/lists\/\d+\/?$/.test(location.pathname);
    document.querySelectorAll('[data-testid="app-bar-back"]').forEach((b) => {
      b.disabled = onList;
      b.style.display = onList ? "none" : "";
    });
  }

  // ---------- 返回按钮拦截 ----------
  // iframe 的 history.back() 走 joint session history（顶层+子帧联合历史，浏览器
  // 规范行为）——顶层做过 SPA 导航后，帧内返回链退到底（=回到列表主页）再点返回，
  // joint 指针会越过帧内条目区间、退到顶层旧条目 → 顶层被劫回 /home。
  // 唯一需要拦的就是这一种，且它必然发生在「帧已是列表主页」时：
  //   列表主页（/i/lists/<id> 精确匹配）→ 吸掉点击（零导航零刷新，帧不动）；
  //   其余页面 → 完全放行 X 原生返回（同文档 popstate 一层层退，无刷新）。
  function hookBackBtn() {
    document.addEventListener(
      "click",
      (e) => {
        if (
          e.button !== 0 ||
          e.metaKey ||
          e.ctrlKey ||
          e.shiftKey ||
          e.altKey
        ) {
          return;
        }
        const back = e.target?.closest?.('[data-testid="app-bar-back"]');
        if (!back) return;
        if (!/^\/i\/lists\/\d+\/?$/.test(location.pathname)) return; // 非列表态：放行原生
        e.preventDefault();
        e.stopPropagation(); // 吸掉：阻断 X 的 back，joint 指针不动、顶层零影响
      },
      true
    );
  }

  // ⚠️ 本条目 run_at: document_start：injectStyle 必须在 SSR 首帧渲染前注入，
  //    X 水合计算虚拟列表布局时 header 格已 display:none → 后续格子无缝顶上；
  //    body 相关（observer/扫描）等 DOMContentLoaded
  function boot() {
    loadHideAds().then(() => {
      processAds();
      processReadOnly();
    });
    processListHeader();
    hookFrameNav();
    hookBackBtn();
    processBackBtn();
    // 只读快捷键拦截（iframe 独立键盘上下文）：n 新推/r 回复/l 点赞/t 转推/b 书签；
    // capture 先于 X 监听；输入框/contentEditable 放行（正常打字不能被吃）
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (!document.body?.classList.contains("xmark-readonly")) return;
        const t = e.target;
        if (
          t &&
          (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
        )
          return;
        if (["n", "r", "l", "t", "b"].includes(e.key.toLowerCase())) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      true
    );
    let timer = null;
    new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        processAds();
        processListHeader();
        processBackBtn();
        processReadOnly();
      }, 400);
    }).observe(document.body, { childList: true, subtree: true });
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes.uiCleanSettings) return;
      loadHideAds().then(() => {
        processAds();
        processReadOnly();
      });
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
