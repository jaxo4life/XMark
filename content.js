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

getCurrentLangData();

// Twitter Notes Content Script
class TwitterNotes {
  constructor() {
    this.notes = {}; // 存储备注数据，键可能是用户名或用户ID
    this.userIdCache = new Map(); // 缓存用户名到ID的映射
    this.init();
    this.observeGroups();
    this._profileProcessStatus = new Map();
  }

  async init() {
    // 加载已保存的备注
    await this.loadNotes();

    // 监听页面变化
    this.observePageChanges();

    // 初始处理页面
    this.processPage();
  }

  async getGroups() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "getGroups" }, (res) => {
        resolve(res || {}); // 确保返回一个对象，即使 storage 出错
      });
    });
  }

  async initGroups() {
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

    // **读取保存的显示状态**
    chrome.storage.local.get(
      ["twitterGroupsVisible"],
      ({ twitterGroupsVisible }) => {
        if (twitterGroupsVisible === false) {
          wrapper.style.display = "none";
        }
      }
    );
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

    users.forEach((user) => {
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

      img.src = `https://unavatar.io/x/${user.username}`;

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

  observeGroups() {
    let busy = false;
    const observer = new MutationObserver(() => {
      if (busy) return; // 避免无限循环
      busy = true;
      this.initGroups()
        .catch(() => {})
        .finally(() => {
          busy = false;
        });
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

    // ⛏️ 通过用户名查找 ID
    for (const id in this.notes) {
      const note = this.notes[id];
      if (note.username === username) {
        return this.notes[note.userId]; // ✅ 找到了 username，返回 userId 对应的数据
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

  observePageChanges() {
    const self = this;
    const normalize = (p) => (p || "/").replace(/\/+$/, "") || "/";
    let lastPath = normalize(location.pathname);

    // 防抖定时器
    let processTimer = null;
    const scheduleProcess = (delay = 500) => {
      if (processTimer) clearTimeout(processTimer);
      processTimer = setTimeout(() => {
        try {
          self.processPage();
        } catch (e) {
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

      // 在主页基于用户名显示备注
      this.addTweetNoteElements(tweet, null, username, userNameElement, true); // 主页模式
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

  addTweetNoteElements(
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
        detailButton.title = `${langData.viewDetail}: ${noteDescription}`;
      }

      noteButton.title = `${langData.editNote}: ${noteName}`;
    } else {
      noteDisplay.style.display = "none";
      noteButton.title = langData.addNote;
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

    // 按顺序添加：备注显示 -> 编辑按钮 -> 详情按钮
    noteContainer.appendChild(noteDisplay);
    noteContainer.appendChild(noteButton);
    noteContainer.appendChild(detailButton);
    userNameContainer.appendChild(noteContainer);
  }

  // 处理关注者/粉丝页面
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

  // 为用户卡片添加备注元素
  addUserCardNoteElements(userCell, userNameContainer, username) {
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
        detailButton.title = `${langData.viewDetail}: ${noteDescription}`;
      } else {
        detailButton.style.display = "none";
      }
    } else {
      noteDisplay.style.display = "none";
      noteButton.title = langData.addNote;
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

    // 按顺序添加：备注显示 -> 编辑按钮 -> 详情按钮
    noteContainer.appendChild(noteDisplay);
    noteContainer.appendChild(noteButton);
    noteContainer.appendChild(detailButton);

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

    noteButton.innerHTML = `📝 ${
      currentNote ? langData.viewNote : langData.addNote
    }`;
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

  showNoteDetail(userId, username) {
    const currentNote = this.getUserNote(username, userId);
    if (!currentNote) return;

    const existingDialog = document.querySelector(
      ".twitter-notes-detail-dialog"
    );
    if (existingDialog) {
      existingDialog.remove();
    }

    getCurrentLangData()
      .then(async () => {
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
						<h3>${langData.noteDetail}
							<span style="color:#1d9bf0">@${username}</span>
						</h3>
						<div class="user-id-info">${langData.userID} ${currentNote.userId}</div>
						${
              currentNote && currentNote.username !== username
                ? `<div class="user-id-info">${langData.oldusername} @ 
							<span style="color: red; font-size: 16px;">${currentNote.username}</span></div>`
                : ""
            }
						<button class="twitter-notes-close">×</button>
					</div>
					<div class="twitter-notes-detail-body">
						<div class="note-field">
							<label>${langData.noteName}:</label>
							<div class="note-value">${noteName}</div>
						</div>
						${
              noteDescription
                ? `
							<div class="note-field">
								<label>${langData.noteContent}:</label>
								<div class="note-value">${noteDescription}</div>
							</div>
						`
                : ""
            }
            ${
              currentNote.tagId && availableTags[currentNote.tagId]
                ? `
              <div class="note-field">
                <label>${langData.tagName}</label>
                <div class="note-value">${
                  availableTags[currentNote.tagId].name
                }</div>
              </div>
            `
                : ""
            }
						<div class="note-field">
							<label>${langData.noteCreated}:</label>
							<div class="note-value">${new Date(
                currentNote.createdAt
              ).toLocaleString()}</div>
						</div>
						${
              currentNote.updatedAt !== currentNote.createdAt
                ? `
							<div class="note-field">
								<label>${langData.noteUpdated}:</label>
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
							${langData.editNote}
						</button>
					</div>
				</div>
			`;

        document.body.appendChild(dialog);

        const closeBtn = dialog.querySelector(".twitter-notes-close");
        const actionBtn =
          dialog.querySelector("#editNote") ||
          dialog.querySelector("#goToProfile");

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
      })
      .catch((e) => {
        console.error("加载语言数据失败:", e);
      });
  }

  showNoteDialog(userId, username) {
    const existingDialog = document.querySelector(".twitter-notes-dialog");
    if (existingDialog) {
      existingDialog.remove();
    }

    getCurrentLangData()
      .then(async () => {
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
        const tagResult = await chrome.storage.local.get(["noteTags"]);
        const availableTags = tagResult.noteTags || {};

        dialog.innerHTML = `
				<div class="twitter-notes-dialog-content">
					<div class="twitter-notes-dialog-header">
						<h3>${langData.addNote} @${username}</h3>
						<div class="user-id-info">${langData.userID}  ${userId}</div>
						${
              currentNote && currentNote.username !== username
                ? `<div class="user-id-info">
								${langData.oldusername}: @ 
								<span style="color: red; font-size: 16px;">${currentNote.username}</span>
								<button class="add-old-username-btn" title="${langData.addtoNote}">+</button>
							 </div>`
                : ""
            }
						<button class="twitter-notes-close">×</button>
					</div>
					<div class="twitter-notes-dialog-body">
						<div class="input-group">
							<label for="noteName">${langData.noteName} *</label>
							<input 
								type="text"
								id="noteName"
								class="twitter-notes-input" 
								placeholder="${langData.notePlaceholder}"
								maxlength="50"
								value="${noteName}"
							/>
							<div class="char-count">
								<span class="current-name">${noteName.length}</span>/50
							</div>
						</div>
            <div class="input-group">
              <label for="noteTag">${langData.selectTag}</label>
              <select id="noteTag" class="tag-select">
                <option value="">${langData.noTag}</option>
                ${Object.entries(availableTags)
                  .map(([tagId, tag]) => {
                    // 判断是否选中
                    const selected =
                      currentNote && currentNote.tagId == tagId
                        ? "selected"
                        : "";
                    // 注意 style 内要用双引号包围属性值
                    return `<option value="${tagId}" ${selected} style="color:${tag.color}; font-weight:bold;">${tag.name}</option>`;
                  })
                  .join("")}
              </select>
            </div>
						<div class="input-group">
							<label for="noteDescription">${langData.noteContent}</label>
							<textarea 
								id="noteDescription"
								class="twitter-notes-textarea" 
								placeholder="${langData.noteContentInput}"
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
							${langData.deleteNote}
						</button>
						<button class="twitter-notes-btn twitter-notes-btn-primary" id="saveNote">
							${langData.saveNote}
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
      })
      .catch((e) => {
        console.error("加载语言数据失败:", e);
      });
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
        element.innerHTML = `📝 ${
          hasNote ? langData.viewNote : langData.addNote
        }`;
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

            button.title = `${langData.editNote}: ${noteName}`;
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
              detailButton.title = `${langData.viewDetail}: ${noteDescription}`;
            } else {
              detailButton.style.display = "none";
            }
          } else {
            button.title = `${langData.addNote}`;
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
}

// 初始化
const twitterNotes = new TwitterNotes();

// 监听语言变化
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.lang) {
    langData = null; // 清缓存
    getCurrentLangData().then(() => {
      twitterNotes.updateAllLanguageDependentElements(); // 更新界面文本
    });
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
});
