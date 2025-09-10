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

// Twitter Notes Content Script
class TwitterNotes {
  constructor() {
    this.notes = {}; // 存储备注数据，键可能是用户名或用户ID
    this.userIdCache = new Map(); // 缓存用户名到ID的映射
    this.init();
    this.avatarTTLMap = {};
    this.observeGroups();
    this.twitterObserver = null;
    this._profileProcessStatus = new Map();
    this.extensionEnabled = true;
    this.notificationElement = null;
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
  }

  // 标签面板
  async getGroups() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "getGroups" }, (res) => {
        resolve(res || {}); // 确保返回一个对象，即使 storage 出错
      });
    });
  }

  async initGroups() {
    // 初始化状态并设置样式
    const res = await new Promise((resolve) => {
      chrome.storage.local.get({ tagGroupsVisible: true }, resolve);
    });

    if (!res.tagGroupsVisible) {
      return;
    }

    // 取出标签和顺序
    const { noteTags = {}, noteTagsOrder = [] } = await this.getGroups();

    const nav = document.querySelector("header nav");
    if (!nav) return;

    // 删除旧 wrapper，保证每次刷新都生效
    const oldWrapper = nav.querySelector("[data-groups-nav]");
    if (oldWrapper) oldWrapper.remove();

    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-groups-nav", "true");

    // 样式优化
    wrapper.style.display = "flex"; // 水平排列
    wrapper.style.flexWrap = "wrap"; // 多行换行
    wrapper.style.gap = "6px"; // 标签之间间距
    wrapper.style.maxWidth = "100%"; // 不超出父元素宽度
    wrapper.style.padding = "4px 0"; // 上下内边距
    wrapper.style.overflowX = "auto"; // 超出可横向滚动
    wrapper.style.scrollBehavior = "smooth"; // 滑动平滑

    // 渲染顺序：先按 noteTagsOrder，再补上缺的
    const order = (
      noteTagsOrder.length ? noteTagsOrder : Object.keys(noteTags)
    ).filter((id) => noteTags[id]);

    order.forEach((id) => {
      const tag = noteTags[id];
      if (!tag) return;

      const btn = document.createElement("span");
      btn.textContent = tag.name;

      btn.style.cursor = "pointer";
      btn.style.fontWeight = "bold";
      btn.style.color = "#fff";
      btn.style.backgroundColor = tag.color || "rgb(29,155,240)";
      btn.style.borderRadius = "12px";
      btn.style.padding = "2px 8px";
      btn.style.fontSize = "12px";
      btn.style.whiteSpace = "nowrap"; // 保证文字不换行
      btn.style.display = "inline-flex";
      btn.style.alignItems = "center";
      btn.style.justifyContent = "center";

      btn.addEventListener("click", () => {
        this.filterUsersByTag(tag.id);
      });

      wrapper.appendChild(btn);
    });

    nav.appendChild(wrapper);
  }

  async filterUsersByTag(tagId) {
    const { twitterNotes = {}, noteTags = {} } = await this.getGroups();
    const users = Object.values(twitterNotes || {}).filter(
      (u) => u.tagId === tagId
    );
    const tag = noteTags[tagId];

    // 创建或获取面板
    let panel = document.querySelector("#twitterTagPanel");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "twitterTagPanel";
      panel.style.position = "fixed";
      panel.style.top = "100px";
      panel.style.right = "-340px";
      panel.style.width = "320px";
      panel.style.maxHeight = "70%";
      panel.style.overflowY = "auto";
      panel.style.borderRadius = "12px";
      panel.style.boxShadow = "0 4px 12px rgba(0,0,0,0.1)";
      panel.style.padding = "0";
      panel.style.zIndex = "9999";
      panel.style.fontFamily =
        'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
      panel.style.transition = "right 0.3s ease, background 0.3s ease";
      document.body.appendChild(panel);

      // 关闭按钮
      const closeBtn = document.createElement("div");
      closeBtn.textContent = "✕";
      closeBtn.style.position = "absolute";
      closeBtn.style.top = "8px";
      closeBtn.style.right = "12px";
      closeBtn.style.cursor = "pointer";
      closeBtn.style.fontSize = "18px";
      closeBtn.style.fontWeight = "bold";
      closeBtn.addEventListener("click", () => (panel.style.right = "-340px"));
      panel.appendChild(closeBtn);

      // 点击面板外关闭
      document.addEventListener("click", (e) => {
        if (
          !panel.contains(e.target) &&
          e.target.dataset.tagButton !== "true"
        ) {
          panel.style.right = "-340px";
        }
      });
    }

    // 清空旧内容
    panel.innerHTML = "";

    // 标题栏
    const titleBar = document.createElement("div");
    titleBar.style.display = "flex";
    titleBar.style.alignItems = "center";
    titleBar.style.justifyContent = "center";
    titleBar.style.position = "sticky";
    titleBar.style.top = "0";
    titleBar.style.zIndex = "1";
    titleBar.style.background = tag?.color || "#1DA1F2";
    titleBar.style.color = "#fff";
    titleBar.style.padding = "10px";
    titleBar.style.fontWeight = "bold";
    titleBar.style.fontSize = "16px";
    titleBar.style.borderTopLeftRadius = "12px";
    titleBar.style.borderTopRightRadius = "12px";

    // 标题文字
    const titleText = document.createElement("div");
    titleText.textContent = tag?.name || "标签";
    titleText.style.flex = "1";
    titleText.style.textAlign = "center";
    titleBar.appendChild(titleText);

    // 关闭按钮
    const closeBtn = document.createElement("div");
    closeBtn.textContent = "✕";
    closeBtn.style.cursor = "pointer";
    closeBtn.style.fontSize = "18px";
    closeBtn.style.fontWeight = "bold";
    closeBtn.style.position = "absolute";
    closeBtn.style.right = "12px";
    closeBtn.style.top = "50%";
    closeBtn.style.transform = "translateY(-50%)";
    closeBtn.addEventListener("click", () => (panel.style.right = "-340px"));
    titleBar.appendChild(closeBtn);

    panel.appendChild(titleBar);

    users.forEach(async (user) => {
      const link = document.createElement("a");
      link.href = `https://x.com/${user.username}`;
      link.target = "_blank";
      link.className = "userItem";
      link.style.display = "flex";
      link.style.alignItems = "center";
      link.style.padding = "8px";
      link.style.borderRadius = "8px";
      link.style.textDecoration = "none";
      link.style.color = "#000";
      link.style.marginBottom = "0";
      link.style.backgroundColor = "#fff";
      link.style.transition = "background-color 160ms ease";

      link.addEventListener(
        "mouseenter",
        () => (link.style.backgroundColor = tag?.color || "#1DA1F2")
      );
      link.addEventListener(
        "mouseleave",
        () => (link.style.backgroundColor = "#fff")
      );

      const img = document.createElement("img");
      img.style.width = "40px";
      img.style.height = "40px";
      img.style.borderRadius = "50%";
      img.style.marginRight = "10px";

      // 获取缓存
      const result = await chrome.storage.local.get("avatarTTLMap");
      this.avatarTTLMap = result.avatarTTLMap || {};

      // 如果没有TTL就新随机
      if (!this.avatarTTLMap[user.username]) {
        await this.updateUserTTL(user.username);
      }
      const initialTTL = this.avatarTTLMap[user.username];

      chrome.runtime.sendMessage(
        {
          action: "fetchAvatar",
          username: user.username,
          ttl: initialTTL,
        },
        (res) => {
          if (res && res.src) {
            img.src = res.src;
          }
        }
      );

      const text = document.createElement("div");
      text.innerHTML = `<strong>${user.name}</strong><br>@${user.username}<br>${
        user.description || ""
      }`;
      text.style.fontSize = "14px";
      text.style.lineHeight = "1.4";

      link.appendChild(img);
      link.appendChild(text);
      panel.appendChild(link);
    });

    // 滑入面板
    requestAnimationFrame(() => (panel.style.right = "0"));
  }

  async updateUserTTL(username, ttl = null) {
    this.avatarTTLMap[username] = ttl ?? Math.floor(Math.random() * 120) + 48;
    await chrome.storage.local.set({ avatarTTLMap: this.avatarTTLMap });
  }

  observeGroups() {
    let busy = false;
    const observer = new MutationObserver(() => {
      if (busy) return; // 避免递归触发
      busy = true;

      const wrapper = document.querySelector("[data-groups-nav]");
      if (!wrapper) {
        // ❌ wrapper 不存在，才初始化并设置 display
        this.initGroups()
          .catch(console.error)
          .finally(() => (busy = false));
      }

      busy = false;
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

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

    // 通过用户名查找 ID
    for (const id in this.notes) {
      const note = this.notes[id];
      if (note.username === username) {
        return this.notes[note.userId];
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
    // 加载语言
    let langData = null;
    updateTexts();

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
    const tweets = document.querySelectorAll('[data-testid="tweet"]');

    tweets.forEach((tweet) => {
      if (tweet.hasAttribute("data-twitter-notes-processed")) return;

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

  // 在用户页面的推文中也显示备注
  displayNotesInUserTweets(userId, username) {
    const observer = new MutationObserver(() => {
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

    observer.observe(document.body, {
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

    // 检查是否已经添加过
    if (userNameContainer.querySelector(".twitter-notes-inline")) return;

    const noteContainer = document.createElement("span");
    noteContainer.className = "twitter-notes-inline";
    noteContainer.setAttribute("data-username", username);
    if (userId) {
      noteContainer.setAttribute("data-user-id", userId);
    }

    // 创建备注显示元素（放在前面）
    const noteDisplay = document.createElement("span");
    noteDisplay.className = "twitter-notes-display";

    // 创建备注按钮（放在后面）
    const noteButton = document.createElement("button");
    noteButton.className = "twitter-notes-inline-button";
    noteButton.innerHTML = "📝";

    // 创建详情按钮
    const detailButton = document.createElement("button");
    detailButton.className = "twitter-notes-detail-button";
    detailButton.innerHTML = "ℹ️";
    detailButton.title = "查看详情";
    detailButton.style.display = "none";

    // 创建详情按钮
    const sreenshotsButton = document.createElement("button");
    sreenshotsButton.className = "view-screenshots-button";
    sreenshotsButton.innerHTML = "📸";
    sreenshotsButton.style.display = "none";

    // 获取备注数据
    const currentNote = this.getUserNote(username, userId);

    if (currentNote) {
      const noteName = currentNote.name || "";
      const noteDescription = currentNote.description || "";

      noteButton.classList.add("has-note");
      noteDisplay.textContent = `${noteName}`;
      noteDisplay.style.display = "inline";

      // 添加标签颜色显示
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

      // 如果有描述，显示详情按钮
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
    let finalId = "";
    if (userId) {
      finalId = userId;
    } else {
      finalId = await this.fetchUserIdinDB(username);
    }

    if (finalId) {
      const count = await this.fetchUserScreenshotsNum(finalId);

      if (count) {
        sreenshotsButton.style.display = "inline";
        sreenshotsButton.title = `${count} ${langData.screenshotCount}`;
      }
    }

    // 绑定事件
    noteButton.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (isHomePage) {
        if (currentNote) {
          // 已经有备注，直接编辑
          this.showNoteDialog(currentNote.userId, username);
        } else {
          // 没有备注，通过用户名获取 userId
          const userId =
            this.userIdCache.get(username) ||
            (await this.fetchUserIdFromProfile(username));

          // 缓存用户名到ID的映射
          this.userIdCache.set(username, userId);

          this.showNoteDialog(userId, username);
        }
      } else {
        // 用户页面直接编辑
        this.showNoteDialog(userId, username);
      }
    });

    detailButton.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.showNoteDetail(userId, username);
    });

    sreenshotsButton.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      chrome.runtime.sendMessage({ action: "openTimelineWithUserId", finalId });
    });

    // 按顺序添加：备注显示 -> 编辑按钮 -> 详情按钮
    noteContainer.appendChild(noteDisplay);
    noteContainer.appendChild(noteButton);
    noteContainer.appendChild(detailButton);
    noteContainer.appendChild(sreenshotsButton);
    userNameContainer.appendChild(noteContainer);
  }

  /* ==========================处理关注者/粉丝页面========================== */
  processFollowingFollowersPage() {
    // 处理已存在的用户卡片
    this.processUserCards();

    // 监听新加载的用户卡片
    const observer = new MutationObserver(() => {
      this.processUserCards();
    });

    observer.observe(document.body, {
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
    // 检查是否已经添加过
    if (userCell.querySelector(".twitter-notes-inline")) return;

    const noteContainer = document.createElement("span");
    noteContainer.className = "twitter-notes-inline";
    noteContainer.setAttribute("data-username", username);

    // 创建备注显示元素
    const noteDisplay = document.createElement("span");
    noteDisplay.className = "twitter-notes-display";

    // 创建备注按钮
    const noteButton = document.createElement("button");
    noteButton.className = "twitter-notes-inline-button";
    noteButton.innerHTML = "📝";

    // 创建详情按钮
    const detailButton = document.createElement("button");
    detailButton.className = "twitter-notes-detail-button";
    detailButton.innerHTML = "ℹ️";
    detailButton.title = "查看详情";
    detailButton.style.display = "none";

    // 创建详情按钮
    const sreenshotsButton = document.createElement("button");
    sreenshotsButton.className = "view-screenshots-button";
    sreenshotsButton.innerHTML = "📸";
    sreenshotsButton.style.display = "none";

    // 获取备注数据
    const currentNote = this.getUserNote(username);

    if (currentNote) {
      const noteName = currentNote.name || "";
      const noteDescription = currentNote.description || "";

      noteButton.classList.add("has-note");
      noteDisplay.textContent = `${noteName}`;
      noteDisplay.style.display = "inline";

      // 添加标签颜色显示
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
      } else {
        detailButton.style.display = "none";
      }
    } else {
      noteDisplay.style.display = "none";
      noteButton.dataset.titleKey = "addNote";
    }

    // 获取截图数据
    const finalId = await this.fetchUserIdinDB(username);

    if (finalId) {
      const count = await this.fetchUserScreenshotsNum(finalId);

      if (count) {
        sreenshotsButton.style.display = "inline";
        sreenshotsButton.title = `${count} ${langData.screenshotCount}`;
      }
    }

    // 绑定事件
    noteButton.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (currentNote) {
        // 已经有备注，直接编辑
        this.showNoteDialog(currentNote.userId, username);
      } else {
        // 没有备注，通过用户名获取 userId
        try {
          const userId =
            this.userIdCache.get(username) ||
            (await this.fetchUserIdFromProfile(username));

          // 缓存用户名到ID的映射
          this.userIdCache.set(username, userId);

          this.showNoteDialog(userId, username);
        } catch (error) {
          console.error("获取用户ID失败:", error);
          // 如果获取ID失败，使用用户名作为标识
          this.showNoteDialog(null, username);
        }
      }
    });

    detailButton.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.showNoteDetail(currentNote.userId, username);
    });

    sreenshotsButton.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      chrome.runtime.sendMessage({ action: "openTimelineWithUserId", finalId });
    });

    // 按顺序添加：备注显示 -> 编辑按钮 -> 详情按钮
    noteContainer.appendChild(noteDisplay);
    noteContainer.appendChild(noteButton);
    noteContainer.appendChild(detailButton);
    noteContainer.appendChild(sreenshotsButton);
    userNameContainer.appendChild(noteContainer);
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

    noteButton.addEventListener("click", (e) => {
      e.preventDefault();
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
							<span style="color:#1d9bf0">@${username}</span>
						</h3>
						<div class="user-id-info"><span data-key="userID"></span> ${
              currentNote.userId
            }</div>
						${
              currentNote && currentNote.username !== username
                ? `<div class="user-id-info"><span data-key="oldusername"></span> @ 
							<span style="color: red; font-size: 16px;">${currentNote.username}</span></div>`
                : ""
            }
						<button class="twitter-notes-close">×</button>
					</div>
					<div class="twitter-notes-detail-body">
						<div class="note-field">
							<label><span data-key="noteName"></span>:</label>
							<div class="note-value">${noteName}</div>
						</div>
						${
              noteDescription
                ? `
							<div class="note-field">
								<label><span data-key="noteContent"></span>:</label>
								<div class="note-value">${noteDescription}</div>
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
                  availableTags[currentNote.tagId].name
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
						<h3><span data-key="addNote"></span> @${username}</h3>
						<div class="user-id-info"><span data-key="userID"></span> ${userId}</div>
						${
              currentNote && currentNote.username !== username
                ? `<div class="user-id-info">
								<span data-key="oldusername"></span> @ 
								<span style="color: red; font-size: 16px;">${currentNote.username}</span>
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
								value="${noteName}"
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
      return `<option value="${tagId}" ${selected} style="color:${tag.color}; font-weight:bold;">${tag.name}</option>`;
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
							>${noteDescription}</textarea>
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

        // 添加样式
        const style = document.createElement("style");
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
      const headerHeight = 53; // 推文顶部 header 大小（自己调）
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
            rectTop: rect.top,
            scrollY: scrollPos,
            viewportHeight,
            step: i,
            headerHeight,
            stepHeight,
          },
        });

        captures.push(partial);
      }

      // 先恢复 UI
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
          if (response.success) {
            resolve(response.data);
          } else {
            reject(response.error);
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
          if (response.success) {
            resolve(response.data);
          } else {
            console.log("错误");
            reject(response.error);
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

  if (area === "local" && changes.noteTagsOrder) {
    if (twitterNotes.initGroups) {
      twitterNotes.initGroups();
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.action === "initGroups") {
    if (twitterNotes.initGroups) {
      twitterNotes
        .initGroups()
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true; // 表示异步响应
    }
  }

  if (message?.action === "updateTTL") {
    if (twitterNotes.initGroups) {
      twitterNotes.updateUserTTL(message.username, message.ttl);
    }
  }
});
