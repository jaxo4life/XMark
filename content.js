// 防御扩展上下文失效：重载/更新后残留的 content script 调用 sendMessage 会抛
// "Extension context invalidated"，统一兜底（失败时 callback(undefined) / Promise resolve undefined）
(() => {
  const _send = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = function (message, callback) {
    try {
      if (!chrome.runtime?.id) {
        if (typeof callback === "function") callback(undefined);
        return Promise.resolve(undefined);
      }
      return callback === undefined ? _send(message) : _send(message, callback);
    } catch (e) {
      if (typeof callback === "function") callback(undefined);
      return Promise.resolve(undefined);
    }
  };
})();

let langData = null;

async function getCurrentLangData() {
  if (langData) {
    return Promise.resolve(langData);
  }
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(["lang"], (result) => {
      const currentLang = result.lang || "zh";
      fetch(chrome.runtime.getURL(`lang/${currentLang}.json`))
        .then((res) => res.json())
        .then((data) => {
          langData = data;
          resolve(data);
        })
        .catch((e) => {
          console.error("加载语言文件失败:", e);
          reject(e);
        });
    });
  });
}

async function updateTexts() {
  await getCurrentLangData();

  document.querySelectorAll("[data-key]").forEach((el) => {
    const key = el.getAttribute("data-key");
    if (langData[key]) {
      el.textContent = langData[key];
      el.placeholder = langData[key];
    }
  });
  document.querySelectorAll("[data-placeholder-key]").forEach((el) => {
    const key = el.getAttribute("data-placeholder-key");
    if (langData[key]) {
      el.placeholder = langData[key];
    }
  });
  document.querySelectorAll("[data-title-key]").forEach((el) => {
    const key = el.getAttribute("data-title-key");
    if (langData[key]) {
      el.title = langData[key];
    }
  });
}

// HTML 转义，避免用户数据注入（备注名/内容/用户名等自由文本）
function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_TAG_COLOR = "#1D9BF0";
// 防御性颜色清洗，杜绝 CSS 注入
function safeColor(c) {
  return typeof c === "string" && HEX_COLOR.test(c) ? c : DEFAULT_TAG_COLOR;
}

// 帧内模式（右列 Timeline iframe）：content.js 走 manifest 独立 all_frames:true 条目，
// 顶层 + 每帧各注入一份（顶层跑全家桶，帧内只跑推文处理子集——备注按钮/标签徽标/
// 广告/截图/用户卡；跳过标签抽屉、用户页 header 按钮与粉丝页专门分支，见各处注释）
const IN_FRAME = (() => {
  try {
    return window.top !== window.self;
  } catch (e) {
    return false;
  }
})();

// 帧内截图坐标换算：captureVisibleTab 截的是【顶层视口】，bg 裁剪公式是
// 「元素视口位置 = 绝对坐标 - 滚动位置」——帧内坐标系必须平移进顶层坐标系
// （页面级坐标 = 帧内坐标 + frameElement.getBoundingClientRect() 偏移；
// 右列 sticky 恒在视口右侧，几何成立）。返回 null 表示非帧内/读不到（跨域）。
// 覆盖字段：x/y（顶层视口坐标系伪绝对值）、scrollX=0（帧内无水平滚动）、
// viewportHeight=帧底（bg 用它作可见下界 min 截断）。每步捕获前实时调用，防截图期间顶层滚动。
function frameShotOverride(rect, frameScrollY) {
  const fe = window.frameElement;
  if (!fe) return null;
  const fr = fe.getBoundingClientRect();
  return {
    x: fr.left + rect.left,
    y: fr.top + rect.top + frameScrollY,
    scrollX: 0,
    viewportHeight: Math.min(window.top?.innerHeight || fr.bottom, fr.bottom),
  };
}

// Twitter Notes Content Script
class TwitterNotes {
  constructor() {
    this.notes = {}; // 存储备注数据，键可能是用户名或用户ID
    this.userIdCache = new Map(); // 缓存用户名到ID的映射
    this.init();
    this.twitterObserver = null;
    this._profileProcessStatus = new Map();
    this.extensionEnabled = true;
    this.notificationElement = null;
    this._followingObserver = null;
    this._userTweetsObserver = null;
    this._hideAds = true; // 广告推文隐藏开关（popup「界面净化」面板写入 uiCleanSettings.hideAds）
  }

  async init() {
    //加载语言
    updateTexts();

    // 加载已保存的备注
    await this.loadNotes();

    // 判断是否开启推文截图
    chrome.storage.local.get({ enableScreenshot: true }, (res) => {
      if (res.enableScreenshot) {
        this.initTwitterScreenshot();
      }
    });

    // 初始scale
    chrome.storage.local.get("screenshotScale", ({ screenshotScale }) => {
      if (!screenshotScale) {
        chrome.storage.local.set({ screenshotScale: 2 });
      }
    });

    // 监听页面变化
    this.observePageChanges();

    // 初始处理页面
    this.processPage();

    // 标签抽屉首次渲染（旧版由 observeGroups 触发，已删）——仅顶层，帧内窄列不放
    if (!IN_FRAME) this.initGroups();

    // 去广告开关（默认开）
    chrome.storage.local.get(["uiCleanSettings"], ({ uiCleanSettings }) => {
      this._hideAds = uiCleanSettings?.hideAds !== false;
    });
  }

  // 标签面板
  async getGroups() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "getGroups" }, (res) => {
        resolve(res || {}); // 确保返回一个对象，即使 storage 出错
      });
    });
  }

  // ---------- 标签抽屉（X 风格：左缘垂直居中圆钮 + 从左滑出抽屉，替代旧 nav 内彩色药丸条） ----------
  injectTagsStyle() {
    if (document.getElementById("xmark-tags-style")) return;
    const css = `
/* 贴边把手式抽屉：容器只负责定位/过渡，无背景——收起时左缘只露把手自己的 20×100 玻璃条 */
#xmark-tags-drawer{position:fixed;left:0;top:20%;transform:translateY(-50%) translateX(calc(-100% + 20px));display:flex;align-items:center;z-index:2;transition:transform .25s ease;font-family:inherit;box-sizing:border-box;--xt-hover:#f7f9f9;--xt-fg:#0f1419;--xt-muted:#536471}
#xmark-tags-drawer.open{transform:translateY(-50%) translateX(0)}
html[data-xmark-theme="dark"] #xmark-tags-drawer{--xt-hover:rgba(101,119,134,.18);--xt-fg:#e7e9ea;--xt-muted:#71767b}
/* 面板卡片（毛玻璃，左贴屏直角、右接把手） */
#xmark-tags-drawer .xt-card{width:200px;max-height:min(70vh,560px);display:flex;flex-direction:column;background:rgba(255,255,255,.85);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border-top:1px solid rgb(159,181,195);border-bottom:1px solid rgb(159,181,195);box-shadow:0 0 15px rgba(101,119,134,.2),0 0 3px 1px rgba(101,119,134,.15)}
html[data-xmark-theme="dark"] #xmark-tags-drawer .xt-card{background:rgba(0,0,0,.65);border-color:rgb(75,78,82);box-shadow:rgba(255,255,255,.2) 0 0 18px,rgba(255,255,255,.15) 0 0 4px 2px}
/* 固定标题头（不随列表滚动） */
#xmark-tags-drawer .xt-head{flex:none;padding:12px 14px 8px;font-size:15px;font-weight:800;color:var(--xt-fg);border-bottom:1px solid rgba(159,181,195,.35)}
html[data-xmark-theme="dark"] #xmark-tags-drawer .xt-head{border-bottom-color:rgba(75,78,82,.5)}
/* 滚动区（只滚列表） */
#xmark-tags-drawer .xt-scroll{flex:1;overflow-y:auto;scrollbar-width:none;padding:6px 2px 8px 0;min-height:64px}
#xmark-tags-drawer .xt-scroll::-webkit-scrollbar{display:none}
/* 把手（20×100 玻璃小条，自身带背景/边框/右侧圆角） */
#xmark-tags-handle{flex:none;width:20px;height:100px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;margin:0;color:#0f1419;background:rgba(255,255,255,.85);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border:1px solid rgb(159,181,195);border-left:none;border-radius:0 12px 12px 0;box-shadow:0 0 15px rgba(101,119,134,.2),0 0 3px 1px rgba(101,119,134,.15);outline:none}
#xmark-tags-handle:hover{background:rgba(255,255,255,.95)}
html[data-xmark-theme="dark"] #xmark-tags-handle{background:rgba(0,0,0,.65);border-color:rgb(75,78,82);color:#e7e9ea;box-shadow:rgba(255,255,255,.2) 0 0 18px,rgba(255,255,255,.15) 0 0 4px 2px}
html[data-xmark-theme="dark"] #xmark-tags-handle:hover{background:rgba(0,0,0,.75)}
#xmark-tags-handle svg{width:15px;height:15px;display:block}
#xmark-tags-handle .xt-chev-l{display:none}
#xmark-tags-drawer.open #xmark-tags-handle .xt-chev-r{display:none}
#xmark-tags-drawer.open #xmark-tags-handle .xt-chev-l{display:block}

/* 用户面板共享变量 */
#twitterTagPanel{--xt-hover:#f7f9f9;--xt-fg:#0f1419;--xt-muted:#536471}
html[data-xmark-theme="dark"] #twitterTagPanel{--xt-hover:rgba(101,119,134,.18);--xt-fg:#e7e9ea;--xt-muted:#71767b}

.xt-row{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:10px;cursor:pointer;user-select:none}
.xt-row:hover{background:var(--xt-hover)}
.xt-dot{width:11px;height:11px;border-radius:9999px;flex:none}
.xt-name{flex:1;font-size:14px;font-weight:700;color:var(--xt-fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xt-count{font-size:12px;color:var(--xt-muted)}
.xt-empty{padding:16px 10px;text-align:center;color:var(--xt-muted);font-size:13px}

/* 用户列表面板（右侧滑入，X 卡片规格） */
#twitterTagPanel{--xt-bg:#fff;--xt-line:#eff3f4;position:fixed;top:50%;transform:translateY(-50%);right:-340px;width:320px;max-height:calc(100vh - 400px);overflow-y:auto;scrollbar-width:none;background:var(--xt-bg);border:1px solid var(--xt-line);border-radius:16px;box-shadow:0 4px 18px rgba(101,119,134,.28);color:var(--xt-fg);z-index:9999;transition:right .25s ease;padding:8px}
#twitterTagPanel::-webkit-scrollbar{display:none}
#twitterTagPanel.open{right:12px}
html[data-xmark-theme="dark"] #twitterTagPanel{--xt-bg:#16181c;--xt-line:#2f3336}
.xt-user-head{display:flex;align-items:center;gap:10px;position:sticky;top:-8px;background:var(--xt-bg);padding:8px 10px;border-bottom:1px solid var(--xt-line);margin-bottom:4px;z-index:1}
.xt-user-head .xt-dot{width:10px;height:10px}
.xt-htitle{flex:1;font-size:16px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xt-uclose{border:none;background:none;font-size:18px;line-height:1;color:var(--xt-muted);cursor:pointer;width:32px;height:32px;border-radius:9999px;display:flex;align-items:center;justify-content:center;padding:0}
.xt-uclose:hover{background:var(--xt-hover);color:var(--xt-fg)}
.xt-user{display:flex;align-items:flex-start;gap:10px;padding:10px;border-radius:12px;text-decoration:none;color:var(--xt-fg);transition:background-color .15s}
.xt-user:hover{background:var(--xt-hover)}
.xt-user img{width:40px;height:40px;border-radius:9999px;flex:none}
.xt-uinfo{min-width:0;font-size:14px;line-height:1.4}
.xt-uinfo strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xt-uhandle{color:var(--xt-muted);display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xt-udesc{color:var(--xt-muted);display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
`;
    const style = document.createElement("style");
    style.id = "xmark-tags-style";
    style.textContent = css;
    document.documentElement.appendChild(style);
  }

  // 暗色三层检测（与 xfinder 共享 html[data-xmark-theme] 钩子，两侧幂等）
  applyXMarkTheme() {
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
        const m = (getComputedStyle(document.body).backgroundColor || "").match(
          /\d+/g
        );
        dark = m ? lum(m) : false;
      } catch (e) {
        dark = false;
      }
    }
    document.documentElement.dataset.xmarkTheme = dark ? "dark" : "light";
  }

  async initGroups() {
    // 初始化状态并设置样式
    const res = await new Promise((resolve) => {
      chrome.storage.local.get({ tagGroupsVisible: true }, resolve);
    });

    if (!res.tagGroupsVisible) {
      document.getElementById("xmark-tags-drawer")?.remove();
      return;
    }

    // 取出标签、顺序与备注（数量统计用）
    const { twitterNotes = {}, noteTags = {}, noteTagsOrder = [] } =
      await this.getGroups();

    this.injectTagsStyle();
    this.applyXMarkTheme();
    this.renderTagsDrawer(twitterNotes, noteTags, noteTagsOrder);
  }

  renderTagsDrawer(notes, tags, orderList) {
    const order = (orderList.length ? orderList : Object.keys(tags)).filter(
      (id) => tags[id]
    );

    // 每个标签的用户数
    const counts = {};
    for (const n of Object.values(notes || {})) {
      if (n.tagId) counts[n.tagId] = (counts[n.tagId] || 0) + 1;
    }

    // 抽屉容器（首建：卡片[固定标题头+滚动列表] + 贴边把手，一体结构）
    let drawer = document.getElementById("xmark-tags-drawer");
    if (!drawer) {
      drawer = document.createElement("div");
      drawer.id = "xmark-tags-drawer";

      const card = document.createElement("div");
      card.className = "xt-card";
      const head = document.createElement("div");
      head.className = "xt-head";
      head.textContent = langData?.tagsDrawerTitle || "标签";
      const scroll = document.createElement("div");
      scroll.className = "xt-scroll";
      card.appendChild(head);
      card.appendChild(scroll);
      drawer.appendChild(card);

      // 把手：20×100，箭头随开合翻转（chevron fill 型；DOMParser 必须显式 xmlns 且单根）
      const handle = document.createElement("button");
      handle.id = "xmark-tags-handle";
      handle.title = langData?.tagsDrawerTitle || "标签";
      const mkChev = (cls, d) => {
        const doc = new DOMParser().parseFromString(
          `<svg xmlns="http://www.w3.org/2000/svg" class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="${d}"/></svg>`,
          "image/svg+xml"
        );
        return document.importNode(doc.documentElement, true);
      };
      handle.appendChild(
        mkChev(
          "xt-chev-r",
          "M9.47 4.47a.75.75 0 0 1 1.06 0l7.06 7.06a.75.75 0 0 1 0 1.06l-7.06 7.06a.75.75 0 1 1-1.06-1.06L15.88 12 9.47 5.53a.75.75 0 0 1 0-1.06z"
        )
      );
      handle.appendChild(
        mkChev(
          "xt-chev-l",
          "M14.53 4.47a.75.75 0 0 0-1.06 0L6.41 11.53a.75.75 0 0 0 0 1.06l7.06 7.06a.75.75 0 1 0 1.06-1.06L8.12 12l6.41-6.47a.75.75 0 0 0 0-1.06z"
        )
      );
      handle.addEventListener("click", (e) => {
        e.stopPropagation();
        drawer.classList.toggle("open");
      });
      drawer.appendChild(handle);

      document.body.appendChild(drawer);

      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") drawer.classList.remove("open");
      });
      document.addEventListener("click", (e) => {
        if (!drawer.contains(e.target)) drawer.classList.remove("open");
      });
    }

    // 列表（渲染进滚动区；标题在固定头不随滚动）
    const scroll = drawer.querySelector(".xt-scroll");
    scroll.textContent = "";

    if (!order.length) {
      const empty = document.createElement("div");
      empty.className = "xt-empty";
      empty.textContent = langData?.noTag || "无标签";
      scroll.appendChild(empty);
      return;
    }

    order.forEach((id) => {
      const tag = tags[id];
      const row = document.createElement("div");
      row.className = "xt-row";
      const dot = document.createElement("span");
      dot.className = "xt-dot";
      dot.style.backgroundColor = safeColor(tag.color);
      const name = document.createElement("span");
      name.className = "xt-name";
      name.textContent = tag.name;
      const count = document.createElement("span");
      count.className = "xt-count";
      count.textContent = counts[id] || 0;
      row.appendChild(dot);
      row.appendChild(name);
      row.appendChild(count);
      row.addEventListener("click", () => {
        this.filterUsersByTag(id);
      });
      scroll.appendChild(row);
    });
  }

  // 旧 initGroups（nav 内彩色药丸条）已由上方标签抽屉替代

  async filterUsersByTag(tagId) {
    const { twitterNotes = {}, noteTags = {} } = await this.getGroups();
    const users = Object.values(twitterNotes || {}).filter(
      (u) => u.tagId === tagId
    );
    const tag = noteTags[tagId];

    // 创建或获取面板（X 卡片规格，class 驱动；样式见 injectTagsStyle）
    let panel = document.querySelector("#twitterTagPanel");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "twitterTagPanel";
      document.body.appendChild(panel);

      // 点击面板外关闭（一次性绑定）
      document.addEventListener("click", (e) => {
        if (!panel.contains(e.target)) panel.classList.remove("open");
      });
    }

    // 清空旧内容
    panel.textContent = "";

    // 标题栏（色点 + 标签名 + 关闭，X 列表头规格）
    const head = document.createElement("div");
    head.className = "xt-user-head";
    const dot = document.createElement("span");
    dot.className = "xt-dot";
    dot.style.backgroundColor = safeColor(tag?.color);
    const htitle = document.createElement("div");
    htitle.className = "xt-htitle";
    htitle.textContent = tag?.name || "标签";
    const uclose = document.createElement("button");
    uclose.className = "xt-uclose";
    uclose.textContent = "×";
    uclose.addEventListener("click", () => panel.classList.remove("open"));
    head.appendChild(dot);
    head.appendChild(htitle);
    head.appendChild(uclose);
    panel.appendChild(head);

    users.forEach((user) => {
      const link = document.createElement("a");
      link.href = `https://x.com/${user.username}`;
      link.target = "_blank";
      link.className = "xt-user";

      const img = document.createElement("img");
      chrome.runtime.sendMessage(
        { action: "fetchAvatar", username: user.username },
        (res) => {
          if (res && res.src) img.src = res.src;
        }
      );

      const info = document.createElement("div");
      info.className = "xt-uinfo";
      const strong = document.createElement("strong");
      strong.textContent = user.name;
      const handle = document.createElement("span");
      handle.className = "xt-uhandle";
      handle.textContent = "@" + user.username;
      info.appendChild(strong);
      info.appendChild(handle);
      if (user.description) {
        const desc = document.createElement("span");
        desc.className = "xt-udesc";
        desc.textContent = user.description;
        info.appendChild(desc);
      }
      link.appendChild(img);
      link.appendChild(info);
      panel.appendChild(link);
    });

    // 滑入面板
    requestAnimationFrame(() => panel.classList.add("open"));
  }

  // observeGroups 已删：抽屉/圆钮挂 body（fixed），SPA 重渲染不影响，
  // 无需旧版对 header nav 的 wrapper 重挂监视

  async loadNotes() {
    try {
      const result = await chrome.storage.local.get(["twitterNotes"]);
      this.notes = result.twitterNotes || {};
    } catch (error) {
      console.error("加载备注失败:", error);
    }
  }

  async saveNotes() {
    try {
      await chrome.storage.local.set({ twitterNotes: this.notes });
    } catch (error) {
      console.error("保存备注失败:", error);
    }
  }

  // 通用方法：从指定document中提取 Twitter 用户数字ID
  async extractUserIdFromDocument(doc, username) {
    try {
      const scripts = doc.querySelectorAll("script");
      for (const script of scripts) {
        if (script.textContent.includes(`"additionalName":"${username}"`)) {
          const match = script.textContent.match(/"identifier":"(\d+)"/);
          if (match) {
            return match[1];
          }
        }
      }
    } catch (error) {
      console.error("提取用户ID失败:", error);
    }
    return null;
  }

  // 从当前页面提取
  async extractUserIdFromPage(username) {
    const res = await this.extractUserIdFromDocument(document, username);
    return res;
  }

  // 从用户主页（新窗口）提取
  async fetchUserIdFromProfile(username) {
    return new Promise((resolve, reject) => {
      const tempWindow = window.open(
        `https://x.com/${username}`,
        "_blank",
        "width=1,height=1,left=-2000,top=" + window.screen.height + ""
      );

      if (!tempWindow) {
        reject("弹窗被浏览器拦截，无法获取用户 ID");
        return;
      }

      const checkInterval = setInterval(async () => {
        try {
          const id = await this.extractUserIdFromDocument(
            tempWindow.document,
            username
          );
          if (id) {
            clearInterval(checkInterval);
            tempWindow.close();
            resolve(id);
          }
        } catch (e) {
          // 跨域或未加载完成，继续等待
        }
      }, 500);

      setTimeout(() => {
        clearInterval(checkInterval);
        tempWindow.close();
        reject("超时未能获取用户 ID");
      }, 8000);
    });
  }

  // 检查当前是否在用户个人页面
  isUserProfilePage() {
    const url = window.location.href;
    // 匹配用户个人页面的URL模式
    const userPagePattern =
      /(?:twitter\.com|x\.com)\/([^\/\?]+)(?:\/(?:with_replies|media|likes)?)?(?:\?|$)/;
    const match = url.match(userPagePattern);

    if (match) {
      const username = match[1];
      // 排除一些特殊页面
      const excludePages = [
        "home",
        "explore",
        "notifications",
        "messages",
        "bookmarks",
        "lists",
        "profile",
        "settings",
        "i",
        "search",
      ];
      return !excludePages.includes(username.toLowerCase());
    }

    return false;
  }

  // 检查当前是否在关注者/粉丝页面
  isFollowingOrFollowersPage() {
    const url = window.location.href;
    // 匹配关注者/粉丝页面的URL模式
    const followingFollowersPattern =
      /(?:twitter\.com|x\.com)\/[^/?]+\/(following|followers|verified_followers)(?:\?|$)/;
    return followingFollowersPattern.test(url);
  }

  // 从URL提取用户名
  extractUsernameFromUrl(url) {
    const match = url.match(/(?:twitter\.com|x\.com)\/([^\/\?]+)/);
    return match ? match[1] : null;
  }

  // 获取用户的备注数据，优先使用用户ID，其次使用用户名
  getUserNote(username, userId = null) {
    if (userId && this.notes[userId]) {
      return this.notes[userId];
    }

    // 通过用户名查找：直接返回命中的 note（按用户名保存的旧备注 userId 为 null，
    // 原代码 return this.notes[note.userId] 会取到 this.notes[null] = undefined）
    for (const id in this.notes) {
      const note = this.notes[id];
      if (note.username === username) {
        return note;
      }
    }

    return null;
  }

  // 保存用户备注，在用户页面使用ID，其他页面使用用户名
  async saveUserNote(username, noteData, userId = null) {
    const key = userId || username;
    this.notes[key] = {
      ...noteData,
      username: username,
      userId: userId,
      updatedAt: new Date().toISOString(),
    };
    await this.saveNotes();
  }

  // 删除用户备注
  async deleteUserNote(username, userId = null) {
    const key = userId || username;
    delete this.notes[key];
    await this.saveNotes();
  }

  // 监听页面变化
  observePageChanges() {
    const self = this;
    const normalize = (p) => (p || "/").replace(/\/+$/, "") || "/";
    let lastPath = normalize(location.pathname);

    let alive = true;
    window.addEventListener("beforeunload", () => {
      alive = false;
    });

    // 防抖定时器
    let processTimer = null;
    const scheduleProcess = (delay = 500) => {
      if (processTimer) clearTimeout(processTimer);
      processTimer = setTimeout(() => {
        if (!alive) return; // 页面销毁后不再执行
        try {
          self.processPage();
        } catch (e) {
          if (e.message.includes("Extension context invalidated")) {
            return; // 忽略
          }
          console.error(e);
        }
      }, delay);
    };

    // URL 变化处理（基于 pathname）
    const onUrlChange = () => {
      const path = normalize(location.pathname);
      if (path !== lastPath) {
        lastPath = path;
        if (
          self._profileProcessStatus &&
          typeof self._profileProcessStatus.clear === "function"
        ) {
          self._profileProcessStatus.clear();
        }
        scheduleProcess(500); // 给 SPA 渲染一点时间
      }
    };

    // Hook history.pushState/replaceState + popstate -> 发 urlchange 事件
    (function () {
      const origPush = history.pushState;
      history.pushState = function () {
        origPush.apply(this, arguments);
        window.dispatchEvent(new Event("urlchange"));
      };
      const origReplace = history.replaceState;
      history.replaceState = function () {
        origReplace.apply(this, arguments);
        window.dispatchEvent(new Event("urlchange"));
      };
      window.addEventListener("popstate", () =>
        window.dispatchEvent(new Event("urlchange"))
      );
      window.addEventListener("urlchange", onUrlChange);
    })();

    // 等待某个选择器出现的简单 helper（避免过早处理）
    const waitFor = (selector, timeout = 3000) =>
      new Promise((resolve, reject) => {
        const el = document.querySelector(selector);
        if (el) return resolve(el);
        const obs = new MutationObserver(() => {
          const e = document.querySelector(selector);
          if (e) {
            obs.disconnect();
            resolve(e);
          }
        });
        obs.observe(document.body, { childList: true, subtree: true });
        if (timeout)
          setTimeout(() => {
            obs.disconnect();
            reject(new Error("timeout"));
          }, timeout);
      });

    // 主 MutationObserver：同时监听 childList（新增节点）和 attributes（class / aria-selected 等）
    const observer = new MutationObserver((mutations) => {
      let shouldProcess = false;
      for (const m of mutations) {
        if (m.type === "childList" && m.addedNodes.length) {
          for (const node of m.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            // 常见的触发点：推文、用户姓名、profile banner、或 role="tab" / following link 出现
            if (
              (node.matches &&
                (node.matches('[data-testid="tweet"]') ||
                  node.matches('[data-testid="UserName"]'))) ||
              (node.querySelector &&
                (node.querySelector('[data-testid="tweet"]') ||
                  node.querySelector('[data-testid="UserName"]') ||
                  node.querySelector(
                    'a[href$="/following"], a[href$="/followers"], [role="tab"]'
                  )))
            ) {
              shouldProcess = true;
              break;
            }
          }
        }
        if (m.type === "attributes") {
          // tab 切换通常是 class/aria-selected/aria-current 的变化
          const attr = m.attributeName;
          if (
            attr === "class" ||
            attr === "aria-selected" ||
            attr === "aria-current"
          ) {
            shouldProcess = true;
          }
        }
        if (shouldProcess) break;
      }

      if (shouldProcess) scheduleProcess(300); // 更短的延迟用于 DOM 增量更新
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "aria-selected", "aria-current"],
    });

    // 初始时或 profile header 出现时也主动触发一次
    waitFor(
      'header, [data-testid="primaryColumn"], [data-testid="UserProfileHeader_Items"]',
      4000
    )
      .then(() => scheduleProcess(400))
      .catch(() => {
        /* 忽略超时 */
      });
  }

  processPage() {
    // 清理页面切换前的临时 Observer
    this._disconnectPageObservers();

    // 加载语言
    let langData = null;
    updateTexts();

    if (IN_FRAME) {
      // 帧内（右列 Timeline）统一按时间线处理：列表/用户页/推文页的推文同构，
      // members 等用户卡页在 processHomePage 的帧内分支处理。
      // 跳过 processUserProfile（SSR 扒 ID / 1×1 弹窗依赖顶层文档）与粉丝页专门分支。
      this.processHomePage();
      return;
    }

    if (this.isUserProfilePage()) {
      // 在用户个人页面处理备注
      this.processUserProfile();
    } else if (this.isFollowingOrFollowersPage()) {
      // 在关注者/粉丝页面处理备注
      this.processFollowingFollowersPage();
    } else {
      // 在主页等其他页面，基于用户名显示备注
      this.processHomePage();
    }
  }

  _disconnectPageObservers() {
    if (this._followingObserver) {
      this._followingObserver.disconnect();
      this._followingObserver = null;
    }
    if (this._userTweetsObserver) {
      this._userTweetsObserver.disconnect();
      this._userTweetsObserver = null;
    }
  }

  // 记录每个用户名的处理状态
  // status: "processing" | "done"
  async processUserProfile(retryCount = 0) {
    const profileHeader = document.querySelector('[data-testid="UserName"]');
    if (!profileHeader) return;

    const username = this.extractUsernameFromUrl(window.location.href);
    if (!username) return;

    // 如果已经处理过这个用户名，就不再重复执行
    if (this._profileProcessStatus.get(username) === "done") {
      return;
    }

    // 如果当前正在处理，就不再并发执行
    if (this._profileProcessStatus.get(username) === "processing") {
      return;
    }

    // 标记为正在处理
    this._profileProcessStatus.set(username, "processing");

    // 获取用户ID
    const userId =
      this.userIdCache.get(username) ||
      (await this.extractUserIdFromPage(username));

    if (!userId) {
      // 最多重试 3 次，每次延迟 500ms
      if (retryCount < 3) {
        setTimeout(() => {
          this._profileProcessStatus.delete(username); // 释放锁，允许重试
          this.processUserProfile(retryCount + 1);
        }, 500);
      } else {
        console.log(
          `无法为用户 ${username} 获取到有效的用户ID，使用用户名作为标识`
        );
        this.addProfileNoteButton(profileHeader, null, username);
        this._profileProcessStatus.set(username, "done");
      }
      return;
    }

    // 缓存用户名到ID的映射
    this.userIdCache.set(username, userId);

    // 添加用户页面的备注按钮
    this.addProfileNoteButton(profileHeader, userId, username);

    // 检查是否需要迁移用户名备注到用户ID
    await this.migrateUserNameNote(username, userId);

    // 在用户页面的推文中也显示备注
    this.displayNotesInUserTweets(userId, username);

    // 标记完成
    this._profileProcessStatus.set(username, "done");
  }

  // 在主页等页面基于用户名显示备注
  processHomePage() {
    this.applyXMarkTheme(); // 标签抽屉/用户面板暗色跟随（幂等）

    // 帧内 members 等页的用户卡同构处理（顶层粉丝页走专门分支，不进这里）
    if (IN_FRAME) this.processUserCards();

    const tweets = document.querySelectorAll('[data-testid="tweet"]');

    tweets.forEach((tweet) => {
      if (tweet.hasAttribute("data-twitter-notes-processed")) return;

      // 去除广告推文
      const hintKeywords = ["广告", "推荐", "Promoted", "Recommended", "Ad"];

      const isAd = [...tweet.querySelectorAll('div[dir="ltr"] span')].some(
        (span) =>
          hintKeywords.includes((span.textContent || "").trim())
      );

      // 去广告开关关闭时不隐藏，广告推文走正常备注流程
      if (isAd && this._hideAds) {
        tweet.setAttribute("data-twitter-notes-processed", "true");
        tweet.setAttribute("data-xmark-ad-hidden", "true"); // 专属标记，关闭开关时还原用
        tweet.style.display = "none";
        this.incrementAdBlockedCount();
        return;
      }

      const userNameElement = tweet.querySelector(
        '[data-testid="User-Name"] a[href*="/"]'
      );
      if (!userNameElement) return;

      const username = this.extractUsername(userNameElement.href);
      if (!username) return;

      this.addTweetNoteElements(tweet, null, username, userNameElement, true);
      tweet.setAttribute("data-twitter-notes-processed", "true");
    });
  }

  // 去除广告计数：今日已去除 + 总计已去除，按自然日重置今日计数
  // 用 Promise 链串行化写入，避免同一批次多条广告并发读取导致丢计数
  incrementAdBlockedCount() {
    this._adCountChain = (this._adCountChain || Promise.resolve())
      .then(async () => {
        const result = await chrome.storage.local.get(["adBlockedStats"]);
        const today = new Date().toDateString();
        const stats = result.adBlockedStats || {
          date: today,
          todayCount: 0,
          totalCount: 0,
        };
        if (stats.date !== today) {
          stats.date = today;
          stats.todayCount = 0;
        }
        stats.todayCount += 1;
        stats.totalCount += 1;
        await chrome.storage.local.set({ adBlockedStats: stats });
      })
      .catch((err) => console.error("广告计数失败:", err));
    return this._adCountChain;
  }

  // 关闭去广告开关时，还原此前已隐藏的广告推文
  restoreHiddenAds() {
    document.querySelectorAll("[data-xmark-ad-hidden]").forEach((tweet) => {
      tweet.removeAttribute("data-xmark-ad-hidden");
      tweet.removeAttribute("data-twitter-notes-processed"); // 让 observer 重新按正常推文处理
      tweet.style.display = "";
    });
  }

  // 在用户页面的推文中也显示备注
  displayNotesInUserTweets(userId, username) {
    if (this._userTweetsObserver) {
      this._userTweetsObserver.disconnect();
    }
    this._userTweetsObserver = new MutationObserver(() => {
      const tweets = document.querySelectorAll('[data-testid="tweet"]');
      tweets.forEach((tweet) => {
        if (tweet.hasAttribute("data-twitter-notes-user-processed")) return;

        const userNameElement = tweet.querySelector(
          '[data-testid="User-Name"] a[href*="/' + username + '"]'
        );
        if (userNameElement) {
          this.addTweetNoteElements(
            tweet,
            userId,
            username,
            userNameElement,
            false
          );
          tweet.setAttribute("data-twitter-notes-user-processed", "true");
        }
      });
    });

    this._userTweetsObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  extractUsername(href) {
    const match = href.match(/\/([^\/\?]+)(?:\?|$)/);
    return match ? match[1] : null;
  }

  async migrateUserNameNote(username, userId) {
    // 如果存在用用户名保存的备注，迁移到用户ID
    if (this.notes[username] && !this.notes[userId]) {
      const oldNote = this.notes[username];
      this.notes[userId] = {
        name: oldNote.text || oldNote.name || "",
        description: oldNote.description || "",
        username: username,
        userId: userId,
        createdAt: oldNote.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      delete this.notes[username];
      await this.saveNotes();
      console.log(`已将用户 ${username} 的备注迁移到ID ${userId}`);
    }
  }

  async addTweetNoteElements(
    tweetContainer,
    userId,
    username,
    userNameElement,
    isHomePage = false
  ) {
    const userNameContainer = userNameElement.closest(
      '[data-testid="User-Name"]'
    );
    if (!userNameContainer) return;

    await this.createNoteUI(
      userNameContainer, userId, username, userNameContainer, isHomePage
    );
  }

  /* ==========================处理关注者/粉丝页面========================== */
  processFollowingFollowersPage() {
    // 处理已存在的用户卡片
    this.processUserCards();

    // 监听新加载的用户卡片
    if (this._followingObserver) {
      this._followingObserver.disconnect();
    }
    this._followingObserver = new MutationObserver(() => {
      this.processUserCards();
    });

    this._followingObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  // 处理用户卡片
  processUserCards() {
    // 查找用户卡片 - 关注者/粉丝页面的用户项
    const userCells = document.querySelectorAll('[data-testid="UserCell"]');

    userCells.forEach((userCell) => {
      if (userCell.hasAttribute("data-twitter-notes-processed")) return;

      // 查找用户名链接
      const userNameLink = userCell.querySelector('a[href*="/"][role="link"]');
      if (!userNameLink) return;

      const username = this.extractUsername(userNameLink.href);
      if (!username) return;

      // 查找用户名显示区域
      const userNameContainer = Array.from(
        userCell.querySelectorAll('a[href*="/"] span.css-1jxf684')
      ).find((span) => span.textContent.startsWith("@"));
      if (!userNameContainer) return;

      // 添加备注元素
      this.addUserCardNoteElements(userCell, userNameContainer, username);
      userCell.setAttribute("data-twitter-notes-processed", "true");
    });
  }

  // 在关注者/粉丝页面为用户卡片添加备注元素
  async addUserCardNoteElements(userCell, userNameContainer, username) {
    await this.createNoteUI(userCell, null, username, userNameContainer, true);
  }

  // 统一的备注 UI 创建逻辑
  async createNoteUI(container, userId, username, targetElement, needsFetchId = false) {
    // 检查是否已经添加过
    if (container.querySelector(".twitter-notes-inline")) return;

    const noteContainer = document.createElement("span");
    noteContainer.className = "twitter-notes-inline";
    noteContainer.setAttribute("data-username", username);
    if (userId) {
      noteContainer.setAttribute("data-user-id", userId);
    }

    const noteDisplay = document.createElement("span");
    noteDisplay.className = "twitter-notes-display";

    const noteButton = document.createElement("button");
    noteButton.className = "twitter-notes-inline-button";
    noteButton.textContent = "\u{1F4DD}";

    const detailButton = document.createElement("button");
    detailButton.className = "twitter-notes-detail-button";
    detailButton.textContent = "\u2139\uFE0F";
    detailButton.title = "\u67E5\u770B\u8BE6\u60C5";
    detailButton.style.display = "none";

    const screenshotsButton = document.createElement("button");
    screenshotsButton.className = "view-screenshots-button";
    screenshotsButton.textContent = "\u{1F4F8}";
    screenshotsButton.style.display = "none";

    const currentNote = this.getUserNote(username, userId);

    if (currentNote) {
      const noteName = currentNote.name || "";
      const noteDescription = currentNote.description || "";

      noteButton.classList.add("has-note");
      noteDisplay.textContent = `${noteName}`;
      noteDisplay.style.display = "inline";

      if (currentNote.tagId) {
        chrome.storage.local.get(["noteTags"]).then((result) => {
          const tags = result.noteTags || {};
          const tag = tags[currentNote.tagId];
          if (tag) {
            noteDisplay.style.backgroundColor = tag.color;
            noteDisplay.style.color = "white";
          }
        });
      }

      if (noteDescription) {
        detailButton.style.display = "inline";
        detailButton.dataset.titleKey = "viewDetail";
      }

      noteButton.dataset.titleKey = "editNote";
    } else {
      noteDisplay.style.display = "none";
      noteButton.dataset.titleKey = "addNote";
    }

    // 获取截图数据
    let finalId = userId || "";
    if (!finalId) {
      finalId = await this.fetchUserIdinDB(username);
    }

    if (finalId) {
      const count = await this.fetchUserScreenshotsNum(finalId);
      if (count) {
        screenshotsButton.style.display = "inline";
        screenshotsButton.title = `${count} ${langData.screenshotCount}`;
      }
    }

    // 绑定事件
    noteButton.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (currentNote) {
        this.showNoteDialog(currentNote.userId, username);
      } else if (needsFetchId) {
        try {
          const fetchedId =
            this.userIdCache.get(username) ||
            (await this.fetchUserIdFromProfile(username));
          this.userIdCache.set(username, fetchedId);
          this.showNoteDialog(fetchedId, username);
        } catch (error) {
          console.error("获取用户ID失败:", error);
          this.showNoteDialog(null, username);
        }
      } else {
        this.showNoteDialog(userId, username);
      }
    });

    detailButton.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const noteUserId = currentNote ? currentNote.userId : userId;
      this.showNoteDetail(noteUserId, username);
    });

    screenshotsButton.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      chrome.runtime.sendMessage({ action: "openTimelineWithUserId", finalId });
    });

    noteContainer.appendChild(noteDisplay);
    noteContainer.appendChild(noteButton);
    noteContainer.appendChild(detailButton);
    noteContainer.appendChild(screenshotsButton);
    targetElement.appendChild(noteContainer);
  }

  addProfileNoteButton(container, userId, username) {
    if (
      container.querySelector(
        ".twitter-notes-profile-button, .twitter-notes-profile-button-alert"
      )
    ) {
      return; // 已经加过按钮就不再加
    }

    const currentNote = this.getUserNote(username, userId);
    const noteButton = document.createElement("button");
    if (currentNote) {
      noteButton.className =
        currentNote.username === username
          ? "twitter-notes-profile-button"
          : "twitter-notes-profile-button-alert";
    } else {
      noteButton.className = "twitter-notes-profile-button";
    }

    noteButton.innerHTML = `📝 <span data-key=${
      currentNote ? "viewNote" : "addNote"
    }></span>
    `;
    noteButton.setAttribute("data-username", username);
    if (userId) {
      noteButton.setAttribute("data-user-id", userId);
    }

    noteButton.addEventListener("click", async (e) => {
      e.preventDefault();

      if (!userId) {
        userId = await this.fetchUserIdFromProfile(username);
        // 缓存用户名到ID的映射
        this.userIdCache.set(username, userId);
      }

      this.showNoteDialog(userId, username);
    });

    container.appendChild(noteButton);
  }

  async showNoteDetail(userId, username) {
    const currentNote = this.getUserNote(username, userId);
    if (!currentNote) return;

    const existingDialog = document.querySelector(
      ".twitter-notes-detail-dialog"
    );
    if (existingDialog) {
      existingDialog.remove();
    }

    const dialog = document.createElement("div");
    dialog.className = "twitter-notes-detail-dialog";

    const noteName = currentNote.name || "";
    const noteDescription = currentNote.description || "";

    // 加载标签选项
    const tagResult = await chrome.storage.local.get(["noteTags"]);
    const availableTags = tagResult.noteTags || {};

    dialog.innerHTML = `
				<div class="twitter-notes-detail-content">
					<div class="twitter-notes-detail-header">
						<h3><span data-key="noteDetail"></span>
							<span style="color:#1d9bf0">@${escapeHtml(username)}</span>
						</h3>
						<div class="user-id-info"><span data-key="userID"></span> ${
              escapeHtml(currentNote.userId)
            }</div>
						${
              currentNote && currentNote.username !== username
                ? `<div class="user-id-info"><span data-key="oldusername"></span> @ 
							<span style="color: red; font-size: 16px;">${escapeHtml(currentNote.username)}</span></div>`
                : ""
            }
						<button class="twitter-notes-close">×</button>
					</div>
					<div class="twitter-notes-detail-body">
						<div class="note-field">
							<label><span data-key="noteName"></span>:</label>
							<div class="note-value">${escapeHtml(noteName)}</div>
						</div>
						${
              noteDescription
                ? `
							<div class="note-field">
								<label><span data-key="noteContent"></span>:</label>
								<div class="note-value">${escapeHtml(noteDescription)}</div>
							</div>
						`
                : ""
            }
            ${
              currentNote.tagId && availableTags[currentNote.tagId]
                ? `
              <div class="note-field">
                <label><span data-key="tagName"></span></label>
                <div class="note-value">${
                  escapeHtml(availableTags[currentNote.tagId].name)
                }</div>
              </div>
            `
                : ""
            }
						<div class="note-field">
							<label><span data-key="noteCreated"></span>:</label>
							<div class="note-value">${new Date(
                currentNote.createdAt
              ).toLocaleString()}</div>
						</div>
						${
              currentNote.updatedAt !== currentNote.createdAt
                ? `
							<div class="note-field">
								<label><span data-key="noteUpdated"></span>:</label>
								<div class="note-value">${new Date(
                  currentNote.updatedAt
                ).toLocaleString()}</div>
							</div>
						`
                : ""
            }
					</div>
					<div class="twitter-notes-detail-footer">
						<button class="twitter-notes-btn twitter-notes-btn-primary" id="editNote">
							<span data-key="editNote"></span>
						</button>
					</div>
				</div>
			`;

    document.body.appendChild(dialog);

    const closeBtn = dialog.querySelector(".twitter-notes-close");
    const actionBtn =
      dialog.querySelector("#editNote") || dialog.querySelector("#goToProfile");

    const closeDialog = () => dialog.remove();
    closeBtn.addEventListener("click", closeDialog);
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) closeDialog();
    });

    actionBtn.addEventListener("click", () => {
      closeDialog();
      this.showNoteDialog(currentNote.userId, username);
    });

    document.addEventListener("keydown", function escHandler(e) {
      if (e.key === "Escape") {
        closeDialog();
        document.removeEventListener("keydown", escHandler);
      }
    });

    updateTexts();
  }

  async showNoteDialog(userId, username) {
    const existingDialog = document.querySelector(".twitter-notes-dialog");
    if (existingDialog) {
      existingDialog.remove();
    }

    const dialog = document.createElement("div");
    dialog.className = "twitter-notes-dialog";

    const currentNote = this.getUserNote(username, userId);
    const noteName = currentNote ? currentNote.name : "";
    const noteDescription = currentNote ? currentNote.description : "";

    // 格式化日期为 "YYYY-MM-DD"
    const formatDate = (date) => {
      const d = new Date(date);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
        2,
        "0"
      )}-${String(d.getDate()).padStart(2, "0")}`;
    };

    // 加载标签选项
    const { noteTags = {}, noteTagsOrder = [] } =
      await chrome.storage.local.get(["noteTags", "noteTagsOrder"]);
    // 计算渲染顺序：优先用持久化顺序，过滤掉已删除的 id
    const order = (
      noteTagsOrder.length ? noteTagsOrder : Object.keys(noteTags)
    ).filter((id) => noteTags[id]);
    // 渲染 select
    const noteTagSelect = document.getElementById("noteTag");

    dialog.innerHTML = `
				<div class="twitter-notes-dialog-content">
					<div class="twitter-notes-dialog-header">
						<h3><span data-key="addNote"></span> @${escapeHtml(username)}</h3>
						<div class="user-id-info"><span data-key="userID"></span> ${escapeHtml(userId)}</div>
						${
              currentNote && currentNote.username !== username
                ? `<div class="user-id-info">
								<span data-key="oldusername"></span> @ 
								<span style="color: red; font-size: 16px;">${escapeHtml(currentNote.username)}</span>
								<button class="add-old-username-btn" data-title-key="addtoNote">+</button>
							 </div>`
                : ""
            }
						<button class="twitter-notes-close">×</button>
					</div>
					<div class="twitter-notes-dialog-body">
						<div class="input-group">
							<label for="noteName"><span data-key="noteName"></span> *</label>
							<input 
								type="text"
								id="noteName"
								class="twitter-notes-input"
                data-placeholder-key="notePlaceholder"
					
								maxlength="50"
								value="${escapeHtml(noteName)}"
							/>
							<div class="char-count">
								<span class="current-name">${noteName.length}</span>/50
							</div>
						</div>
            <div class="input-group">
              <label for="noteTag"><span data-key="selectTag"></span></label>
              <select id="noteTag" class="tag-select">
                <option value=""><span data-key="noTag"></span></option>
  ${order
    .map((tagId) => {
      const tag = noteTags[tagId];
      const selected =
        currentNote && currentNote.tagId == tagId ? "selected" : "";
      return `<option value="${escapeHtml(tagId)}" ${selected} style="color:${safeColor(
        tag.color
      )}; font-weight:bold;">${escapeHtml(tag.name)}</option>`;
    })
    .join("")}
              </select>
            </div>
						<div class="input-group">
							<label for="noteDescription"><span data-key="noteContent"></span></label>
							<textarea 
								id="noteDescription"
								class="twitter-notes-textarea" 
                data-placeholder-key="noteContentInput"
				
								maxlength="500"
							>${escapeHtml(noteDescription)}</textarea>
							<div class="char-count">
								<span class="current-desc">${noteDescription.length}</span>/500
							</div>
						</div>
					</div>
					<div class="twitter-notes-dialog-footer">
						<button class="twitter-notes-btn twitter-notes-btn-secondary" id="deleteNote" ${
              !currentNote ? 'style="display:none"' : ""
            }>
							<span data-key="deleteNote"></span>
						</button>
						<button class="twitter-notes-btn twitter-notes-btn-primary" id="saveNote">
							<span data-key="saveNote"></span>
						</button>
					</div>
				</div>
			`;

    document.body.appendChild(dialog);

    const nameInput = dialog.querySelector("#noteName");
    const descTextarea = dialog.querySelector("#noteDescription");
    const nameCharCount = dialog.querySelector(".current-name");
    const descCharCount = dialog.querySelector(".current-desc");
    const closeBtn = dialog.querySelector(".twitter-notes-close");
    const saveBtn = dialog.querySelector("#saveNote");
    const deleteBtn = dialog.querySelector("#deleteNote");
    const tagSelectElement = dialog.querySelector("#noteTag");

    nameInput.focus();

    nameInput.addEventListener("input", () => {
      nameCharCount.textContent = nameInput.value.length;
    });

    descTextarea.addEventListener("input", () => {
      descCharCount.textContent = descTextarea.value.length;
    });

    // 点击加号按钮：插入“曾用名：xxx YYYY年MM月DD日添加”到备注说明最上方
    const addOldUsernameBtn = dialog.querySelector(".add-old-username-btn");
    if (addOldUsernameBtn) {
      addOldUsernameBtn.addEventListener("click", () => {
        const oldName = currentNote.username;
        const today = formatDate(new Date());
        const insertText =
          `${langData.oldusername} @${oldName}  (${langData.added} ${today})\n` +
          descTextarea.value;
        descTextarea.value = insertText;
        descCharCount.textContent = descTextarea.value.length;
        descTextarea.focus();
        descTextarea.selectionStart = 0;
        descTextarea.selectionEnd = 0;
      });
    }

    const closeDialog = () => dialog.remove();
    closeBtn.addEventListener("click", closeDialog);
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) closeDialog();
    });

    saveBtn.addEventListener("click", async () => {
      const noteName = nameInput.value.trim();
      const noteDescription = descTextarea.value.trim();
      const tagId = tagSelectElement.value || null;

      if (!noteName) {
        alert(langData.notePlaceholder);
        nameInput.focus();
        return;
      }

      const noteData = {
        name: noteName,
        description: noteDescription,
        tagId: tagId,
        username: username,
        userId: userId,
        createdAt: currentNote
          ? currentNote.createdAt
          : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await this.saveUserNote(username, noteData, userId);
      this.updateNoteElements(userId, username);
      closeDialog();
    });

    deleteBtn.addEventListener("click", async () => {
      if (confirm(langData.deleteConfirm)) {
        await this.deleteUserNote(username, userId);
        this.updateNoteElements(userId, username);
        closeDialog();
      }
    });

    document.addEventListener("keydown", function escHandler(e) {
      if (e.key === "Escape") {
        closeDialog();
        document.removeEventListener("keydown", escHandler);
      }
    });

    updateTexts();
  }

  updateNoteElements(userId, username) {
    // 更新所有相关的备注元素
    const selectors = [];
    if (userId) {
      selectors.push(`[data-user-id="${userId}"]`);
    }
    selectors.push(`[data-username="${username}"]`);

    const elements = document.querySelectorAll(selectors.join(", "));

    elements.forEach((element) => {
      const hasNote = this.getUserNote(username, userId);

      if (element.classList.contains("twitter-notes-profile-button")) {
        element.innerHTML = `📝 <span data-key=${
          hasNote ? "viewNote" : "addNote"
        }></span>`;
      } else if (element.classList.contains("twitter-notes-inline")) {
        const button = element.querySelector(".twitter-notes-inline-button");
        const display = element.querySelector(".twitter-notes-display");
        const detailButton = element.querySelector(
          ".twitter-notes-detail-button"
        );

        if (button && display && detailButton) {
          button.classList.toggle("has-note", !!hasNote);

          if (hasNote) {
            const noteName = hasNote.name || "";
            const noteDescription = hasNote.description || "";

            button.dataset.titleKey = "editNote";
            display.textContent = `${noteName}`;
            display.style.display = "inline";

            // 添加标签颜色显示
            if (hasNote.tagId) {
              chrome.storage.local.get(["noteTags"]).then((result) => {
                const tags = result.noteTags || {};
                const tag = tags[hasNote.tagId];
                if (tag) {
                  display.style.backgroundColor = tag.color;
                  display.style.color = "white";
                }
              });
            }

            if (noteDescription) {
              detailButton.style.display = "inline";
              detailButton.dataset.titleKey = "viewDetail";
            } else {
              detailButton.style.display = "none";
            }
          } else {
            button.dataset.titleKey = "addNote";
            display.textContent = "";
            display.style.display = "none";
            display.style.backgroundColor = "";
            display.style.color = "";
            detailButton.style.display = "none";
          }
        }
      }
    });
  }

  updateAllLanguageDependentElements() {
    // 找到页面中所有已处理的备注元素（含 userId 或 username）
    const processedElements = new Set();

    // 先找所有带 userId 的元素
    document.querySelectorAll("[data-user-id]").forEach((el) => {
      const userId = el.getAttribute("data-user-id");
      const username = el.getAttribute("data-username") || null;
      const key = userId + (username || "");
      if (!processedElements.has(key)) {
        this.updateNoteElements(userId, username);
        processedElements.add(key);
      }
    });

    // 再找所有没有 userId 只有 username 的元素
    document.querySelectorAll("[data-username]").forEach((el) => {
      const userId = el.getAttribute("data-user-id");
      if (userId) return; // 已处理过
      const username = el.getAttribute("data-username");
      if (username && !processedElements.has(username)) {
        this.updateNoteElements(null, username);
        processedElements.add(username);
      }
    });
  }

  /* ==========================保存推文快照========================== */
  initTwitterScreenshot() {
    if (
      !window.location.hostname.includes("twitter.com") &&
      !window.location.hostname.includes("x.com")
    ) {
      return;
    }

    setTimeout(() => this.addTwitterScreenshotButtons(), 1000);

    if (this.twitterObserver) {
      this.twitterObserver.disconnect();
    }

    this.twitterObserver = new MutationObserver((mutations) => {
      let shouldUpdate = false;
      mutations.forEach((mutation) => {
        if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (
                node.matches('[data-testid="tweet"]') ||
                node.querySelector('[data-testid="tweet"]')
              ) {
                shouldUpdate = true;
                break;
              }
            }
          }
        }
      });

      if (shouldUpdate) {
        setTimeout(() => this.addTwitterScreenshotButtons(), 500);
      }
    });

    this.twitterObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  addTwitterScreenshotButtons() {
    if (
      !window.location.hostname.includes("twitter.com") &&
      !window.location.hostname.includes("x.com")
    ) {
      return;
    }

    document.querySelectorAll(".screenshot-btn").forEach((btn) => btn.remove());

    const tweetSelectors = [
      '[data-testid="tweet"]',
      'article[data-testid="tweet"]',
      '[data-testid="tweetText"]',
    ];

    let tweets = [];
    for (const selector of tweetSelectors) {
      tweets = document.querySelectorAll(selector);
      if (tweets.length > 0) break;
    }

    tweets.forEach((tweet) => {
      if (tweet.querySelector(".screenshot-btn")) return;

      const actionBar =
        tweet.querySelector('[role="group"]') ||
        tweet.querySelector('[data-testid="reply"]')?.parentElement ||
        tweet.querySelector('[aria-label*="reply"]')?.parentElement;

      if (actionBar) {
        const screenshotBtn = document.createElement("div");
        screenshotBtn.className = "screenshot-btn";

        screenshotBtn.innerHTML = `
          <div class="screenshot-inner">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgb(83, 100, 113)" stroke-width="2">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
              <circle cx="12" cy="13" r="4"></circle>
            </svg>
          </div>
        `;

        // 添加样式（仅一次）
        if (!document.getElementById('xmark-screenshot-style')) {
          const style = document.createElement("style");
          style.id = 'xmark-screenshot-style';
          style.textContent = `
          .screenshot-inner {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            height: 100%;
            border-radius: 9999px;
            cursor: pointer;
            margin-left: 12px;
            transition: background-color 0.2s, transform 0.15s;
          }
          .screenshot-inner:hover {
            background-color: rgba(29, 155, 240, 0.1);
            transform: scale(1.1);
          }
          .screenshot-inner:hover svg {
            stroke: rgb(29, 155, 240);
          }
        `;
          document.head.appendChild(style);
        }

        screenshotBtn.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();

          const showToast = async (
            tweet,
            save2Files = false,
            saveToWebDAV = false
          ) => {
            await this.screenshotTweet(tweet, save2Files, saveToWebDAV);

            const toast = document.createElement("div");
            toast.style.cssText = `
              position: fixed;
              bottom: 20px;
              right: 20px;
              background: #15202b;
              color: #fff;
              border-radius: 16px;
              padding: 12px 16px;
              min-width: 220px;
              box-shadow: 0 4px 16px rgba(0,0,0,0.3);
              display: flex;
              align-items: center;
              justify-content: space-between;
              font-size: 14px;
              opacity: 0;
              transform: translateY(20px);
              transition: opacity 0.3s ease, transform 0.3s ease;
              z-index: 9999;
            `;
            toast.innerHTML = `
              <span>${
                save2Files
                  ? saveToWebDAV
                    ? langData.messages.SavedToWebDAV
                    : langData.messages.SavedToLocal
                  : langData.messages.SavedToDB
              }</span>
              <button style="
                background: transparent;
                border: none;
                color: #1da1f2;
                font-weight: bold;
                cursor: pointer;
                font-size: 14px;
              ">关闭</button>
            `;
            document.body.appendChild(toast);

            requestAnimationFrame(() => {
              toast.style.opacity = "1";
              toast.style.transform = "translateY(0)";
            });

            const removeToast = () => {
              toast.style.opacity = "0";
              toast.style.transform = "translateY(20px)";
              setTimeout(() => toast.remove(), 300);
              document.removeEventListener("click", handleOutsideClick);
            };

            toast
              .querySelector("button")
              .addEventListener("click", removeToast);

            // 点击空白区域关闭
            const handleOutsideClick = (event) => {
              if (!toast.contains(event.target)) {
                removeToast();
              }
            };
            // 延迟绑定，避免立即触发点击事件关闭
            setTimeout(
              () => document.addEventListener("click", handleOutsideClick),
              0
            );

            // 自动消失
            setTimeout(removeToast, 4000);
          };

          // 检查截图保存选项
          const res = await new Promise((resolve) => {
            chrome.storage.local.get({ TimelineSaveChoice: true }, resolve);
          });
          const save2Files = res.TimelineSaveChoice;

          if (save2Files) {
            // 获取 WebDAV 连接状态
            const result = await chrome.storage.local.get([
              "webdavConnectionStatus",
            ]);
            const connectionStatus = result.webdavConnectionStatus;

            if (connectionStatus) {
              // 已连接 WebDAV，显示选择小浮窗
              const toast = document.createElement("div");
              toast.style.cssText = `
              position: fixed;
              bottom: 20px;
              right: 20px;
              background: #15202b;
              color: #fff;
              border-radius: 16px;
              padding: 12px 16px;
              min-width: 240px;
              box-shadow: 0 4px 16px rgba(0,0,0,0.3);
              display: flex;
              flex-direction: column;
              gap: 8px;
              font-size: 14px;
              opacity: 0;
              transform: translateY(20px);
              transition: opacity 0.3s ease, transform 0.3s ease;
              z-index: 9999;
            `;
              toast.innerHTML = `
              <div style="font-weight: 500; margin-bottom: 4px;">选择保存位置</div>
              <div style="display:flex; gap:8px; justify-content: flex-end;">
                <button id="saveLocal" style="
                  background-color: #1da1f2;
                  color: #fff;
                  border: none;
                  padding: 6px 12px;
                  border-radius: 9999px;
                  cursor: pointer;
                  font-weight: 500;
                  transition: filter 0.2s;
                ">保存到本地</button>
                <button id="saveWebDAV" style="
                  background-color: #17bf63;
                  color: #fff;
                  border: none;
                  padding: 6px 12px;
                  border-radius: 9999px;
                  cursor: pointer;
                  font-weight: 500;
                  transition: filter 0.2s;
                ">保存到 WebDAV</button>
              </div>
            `;
              document.body.appendChild(toast);

              requestAnimationFrame(() => {
                toast.style.opacity = "1";
                toast.style.transform = "translateY(0)";
              });

              const removeToast = () => {
                toast.style.opacity = "0";
                toast.style.transform = "translateY(20px)";
                setTimeout(() => toast.remove(), 300);
              };

              // 按钮悬停效果
              toast.querySelectorAll("button").forEach((btn) => {
                btn.addEventListener(
                  "mouseenter",
                  () => (btn.style.filter = "brightness(1.1)")
                );
                btn.addEventListener(
                  "mouseleave",
                  () => (btn.style.filter = "brightness(1)")
                );
              });

              toast
                .querySelector("#saveLocal")
                .addEventListener("click", () => {
                  showToast(tweet, true, false);
                  removeToast();
                });
              toast
                .querySelector("#saveWebDAV")
                .addEventListener("click", () => {
                  showToast(tweet, true, true);
                  removeToast();
                });

              // 点击空白区域关闭浮窗
              const handleOutsideClick = (event) => {
                if (!toast.contains(event.target)) {
                  removeToast();
                }
              };
              setTimeout(
                () => document.addEventListener("click", handleOutsideClick),
                0
              );
            } else {
              // 未连接 WebDAV，直接保存到本地
              showToast(tweet, true, false);
            }
          } else {
            showToast(tweet, false, false);
          }
        });

        actionBar.appendChild(screenshotBtn);
      }
    });
  }

  // 根据handle获取userId
  async getUserId(handle) {
    // 先尝试从已有 notes 里查找
    for (const id in this.notes) {
      const note = this.notes[id];
      if (note.username === handle) {
        return note.userId; // 直接返回 userId
      }
    }

    // 如果没找到，就调用 fetchUserIdFromProfile
    const userId = await this.fetchUserIdFromProfile(handle);
    return userId;
  }

  // 帧内截图专用：临时隐藏悬顶 sticky bar，返回还原函数。
  // 三路候选（不依赖单一选择器，抗 X 改版；全部 visibility:hidden 保布局）：
  //   ① timeline 滚动 sticky header——推文格子（cellInnerDiv）内 inline sticky 贴顶层
  //   ② 返回按钮（app-bar-back）所在的 sticky 祖先——推文详情/用户页顶栏
  //   ③ frame-clean 首屏 header 两层同源选择器——滚动后浮出的变体兜底
  hideFrameStickyBars() {
    const saved = [];
    const hide = (el) => {
      if (!el || el.style.visibility === "hidden") return;
      saved.push([el, el.style.visibility]);
      el.style.visibility = "hidden";
    };
    try {
      document
        .querySelectorAll('[data-testid="cellInnerDiv"] > div')
        .forEach((d) => {
          const cs = getComputedStyle(d);
          if (cs.position === "sticky" && parseFloat(cs.top || "0") < 1) {
            hide(d);
          }
        });
      document
        .querySelectorAll('[data-testid="app-bar-back"]')
        .forEach((b) => {
          let n = b.parentElement;
          while (n && n !== document.body) {
            const cs = getComputedStyle(n);
            if (cs.position === "sticky" || cs.position === "fixed") {
              hide(n);
              break;
            }
            n = n.parentElement;
          }
        });
      document
        .querySelectorAll(
          'div.r-1habvwh:has(>h2[role="heading"]), div.r-1pz39u2:has([data-testid="share-button"])'
        )
        .forEach(hide);
    } catch (e) {
      /* ignore */
    }
    return () => saved.forEach(([el, v]) => (el.style.visibility = v));
  }

  async screenshotTweet(
    tweetElement,
    save2Files = false,
    saveToWebDAV = false
  ) {
    try {
      // 生成文件名
      const handleElement =
        tweetElement.querySelector('[data-testid="User-Name"] a[href*="/"]') ||
        tweetElement.querySelector('a[href*="/"][role="link"]') ||
        tweetElement.querySelector('[href*="/"]');

      let handle = "unknown";
      if (handleElement) {
        const href = handleElement.getAttribute("href");
        const match = href.match(/\/([^/?]+)/);
        if (match) {
          handle = match[1];
        }
      }

      let tweetlink = "";
      if (handle) {
        const anchor = tweetElement.querySelector(
          `a[href^="/${handle}/status/"]`
        );
        if (!anchor) return null;

        const href = anchor.getAttribute("href");

        // 匹配 /handle/status/数字 开头的部分
        const match = href.match(new RegExp(`^/${handle}/status/\\d+`));
        if (match) {
          tweetlink = `https://x.com${match[0]}`;
        } else {
          return null;
        }
      }

      const userId = await this.getUserId(handle);

      const now = new Date();
      const dateStr =
        now.getFullYear() +
        String(now.getMonth() + 1).padStart(2, "0") +
        String(now.getDate()).padStart(2, "0") +
        "_" +
        String(now.getHours()).padStart(2, "0") +
        String(now.getMinutes()).padStart(2, "0");

      const filename = `${handle}_${dateStr}.png`;

      // 隐藏grok按钮
      const grokButton = Array.from(
        tweetElement.querySelectorAll("button[aria-label]")
      ).find((btn) => {
        const label = btn.getAttribute("aria-label");
        return label && /Grok/i.test(label);
      });

      let originalGrokDisplay = null;
      if (grokButton) {
        originalGrokDisplay = grokButton.style.display;
        grokButton.style.display = "none";
      }

      // 隐藏右上角的三个点
      const menuButton = tweetElement.querySelector('[data-testid="caret"]');
      let originalDisplay = null;
      if (menuButton) {
        originalDisplay = menuButton.style.display;
        menuButton.style.display = "none";
      }

      // 隐藏备注（twitter-notes-inline）
      const noteElement = tweetElement.querySelector(".twitter-notes-inline");
      let originalNoteDisplay = null;
      if (noteElement) {
        originalNoteDisplay = noteElement.style.display;
        noteElement.style.display = "none";
      }

      // 隐藏订阅按钮
      const subscribeButton = [
        ...tweetElement.querySelectorAll("button[data-testid]"),
      ].find((btn) => btn.getAttribute("data-testid")?.endsWith("-subscribe"));
      let originalsubscribeDisplay = null;
      if (subscribeButton) {
        originalsubscribeDisplay = subscribeButton.style.display;
        subscribeButton.style.display = "none";
      }

      // 帧内：临时隐藏悬顶 sticky bar（列表/详情页滚动后浮出的「返回+标题」层会盖住
      // 推文首屏用户名）。用 visibility:hidden 而非 display:none——保布局占位，截图坐标不受影响
      const restoreFrameBars = IN_FRAME ? this.hideFrameStickyBars() : null;

      // 获取位置和尺寸
      const rect = tweetElement.getBoundingClientRect();
      const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
      const scrollY = window.pageYOffset || document.documentElement.scrollTop;

      const totalHeight = tweetElement.scrollHeight;
      const viewportHeight = window.innerHeight;

      // 读取scale
      const { screenshotScale } = await new Promise((resolve) =>
        chrome.storage.local.get("screenshotScale", resolve)
      );

      const scale = screenshotScale || 2;

      const info = {
        x: rect.left + scrollX,
        y: rect.top + scrollY,
        width: rect.width,
        height: totalHeight,
        scrollX,
        scrollY,
        devicePixelRatio: window.devicePixelRatio || 1,
        scale,
      };

      const absoluteTop = rect.top + scrollY; // 推文元素在文档里的绝对 Y
      // 每段向上多滚 53px 让推文顶部避开 sticky 区（长期实测调校，顶层/帧内同构保留）；
      // 帧内 sticky 顶栏遮挡由 hideFrameStickyBars 截图期间临时隐藏处理，与本偏移无关
      const headerHeight = 53;
      const stepHeight = viewportHeight - headerHeight; // 每次滚动时减掉 header
      const maxScroll = document.documentElement.scrollHeight - viewportHeight;

      const steps = Math.ceil(totalHeight / stepHeight);
      const captures = [];

      let placeholder = null;
      for (let i = 0; i < steps; i++) {
        const scrollPos = absoluteTop + i * stepHeight - headerHeight;

        if (scrollPos > maxScroll) {
          if (!placeholder) {
            placeholder = document.createElement("div");
            placeholder.style.height = scrollPos + 50 + "px"; // 多留 50px buffer
            placeholder.style.visibility = "hidden"; // 不显示但占位
            placeholder.style.pointerEvents = "none"; // 不影响交互
            tweetElement.insertAdjacentElement("afterend", placeholder); // 插在 tweetElement 后面
          } else {
            // 如果还不够高，扩展高度
            const need = scrollPos + 50;
            const curH = parseInt(placeholder.style.height || "0", 10);
            if (need > curH) placeholder.style.height = need + "px";
          }
        }

        window.scrollTo(0, scrollPos);
        await new Promise((r) => setTimeout(r, 500)); // 等待渲染

        const partial = await chrome.runtime.sendMessage({
          action: "partialShot",
          elementInfo: {
            ...info,
            viewportHeight,
            ...(IN_FRAME ? frameShotOverride(rect, scrollY) || {} : null),
            rectTop: rect.top,
            // 帧内也不改：bg 公式 elemTop - captureTop 恰好给出元素在顶层视口的 y
            scrollY: scrollPos,
            step: i,
            headerHeight,
            stepHeight,
          },
        });

        captures.push(partial);
      }

      // 先恢复 UI
      if (restoreFrameBars) restoreFrameBars();
      if (grokButton) {
        grokButton.style.display = originalGrokDisplay || "";
      }
      if (menuButton) {
        menuButton.style.display = originalDisplay || "";
      }
      if (noteElement) {
        noteElement.style.display = originalNoteDisplay || "";
      }
      if (subscribeButton) {
        subscribeButton.style.display = originalsubscribeDisplay || "";
      }
      if (placeholder) {
        placeholder.remove();
        placeholder = null;
      }

      // 最后通知后台合成
      await chrome.runtime.sendMessage(
        {
          action: "mergeShot",
          captures,
          elementInfo: info,
          totalHeight,
          handle,
          tweetlink,
          userId,
          filename,
          save2Files,
          choice: saveToWebDAV,
        },
        (response) => {
          console.log("截图成功");
        }
      );
    } catch (error) {
      console.error("Screenshot error:", error);
      this.showNotification("截图失败，请重试", "error");
    }
  }

  createNotification() {
    if (this.notificationElement) return this.notificationElement;

    this.notificationElement = document.createElement("div");
    this.notificationElement.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) scale(0);
    background: rgba(0, 0, 0, 0.15);
    color: #ffffffff;
    padding: 16px 32px;
    border-radius: 8px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 16px;
    font-weight: 500;
    z-index: 10000000;
    transition: transform 0.2s ease;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.3);
    text-align: center;
    min-width: 160px;
    text-shadow: 0 1px 2px rgba(255, 255, 255, 0.8);
  `;
    document.body.appendChild(this.notificationElement);
    return this.notificationElement;
  }

  showNotification(message, type = "success") {
    if (!this.extensionEnabled) return;

    const notification = this.createNotification();

    const colors = {
      success: "rgba(16, 185, 129, 0.6)",
      error: "rgba(239, 68, 68, 0.8)",
      info: "rgba(8, 145, 178, 0.8)",
    };

    notification.style.background = colors[type] || "rgba(0, 0, 0, 0.7)";
    notification.textContent = message;
    notification.style.transform = "translate(-50%, -50%) scale(1)";

    setTimeout(() => {
      notification.style.transform = "translate(-50%, -50%) scale(0)";
    }, 1500);
  }

  /* ==========================截图数据========================== */
  fetchUserScreenshotsNum(userId) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: "getScreenshotCountByUserId", userId },
        (response) => {
          // SW 冷启动窗口期消息可能无人应答（callback 收 undefined）——判空兜底
          if (response && response.success) {
            resolve(response.data);
          } else {
            reject(response ? response.error : "no response");
          }
        }
      );
    });
  }

  fetchUserIdinDB(username) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: "getUserIdinDB", username },
        (response) => {
          // 同上：SW 冷启动窗口期判空兜底
          if (response && response.success) {
            resolve(response.data);
          } else {
            console.log("错误");
            reject(response ? response.error : "no response");
          }
        }
      );
    });
  }
}

// 初始化
const twitterNotes = new TwitterNotes();

// 监听语言变化
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.lang) {
    langData = null;
    updateTexts();
  }

  // 界面净化-去广告开关实时生效
  if (area === "local" && changes.uiCleanSettings) {
    const hideAds = changes.uiCleanSettings.newValue?.hideAds !== false;
    if (hideAds !== twitterNotes._hideAds) {
      twitterNotes._hideAds = hideAds;
      if (hideAds) twitterNotes.processHomePage(); // 立即隐藏现存广告推文
      else twitterNotes.restoreHiddenAds(); // 还原此前已隐藏的
    }
  }

  if (area === "local" && changes.noteTagsOrder) {
    if (!IN_FRAME && twitterNotes.initGroups) {
      twitterNotes.initGroups(); // 帧内无标签抽屉
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.action === "initGroups") {
    // 帧内无抽屉：直接应答（防广播挂起 + 防抽屉误建进帧）
    if (IN_FRAME) {
      sendResponse({ ok: true });
      return;
    }
    if (twitterNotes.initGroups) {
      twitterNotes
        .initGroups()
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true; // 表示异步响应
    }
  }
});
