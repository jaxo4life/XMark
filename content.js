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
    // 路由变化检测 - 清空 profile 状态
    let lastUrl = location.href;
    let processTimeout = null;

    new MutationObserver(() => {
      const url = location.href;
      if (url !== lastUrl) {
        lastUrl = url;
        this._profileProcessStatus.clear();
      }
    }).observe(document, { subtree: true, childList: true });

    // 原来的 DOM 元素变化监听
    const observer = new MutationObserver((mutations) => {
      let shouldProcess = false;

      mutations.forEach((mutation) => {
        if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // 检查是否有新的推文或用户页面元素
              if (
                node.querySelector &&
                (node.querySelector('[data-testid="tweet"]') ||
                  node.querySelector('[data-testid="UserName"]') ||
                  node.querySelector('img[src*="profile_banners"]') ||
                  node.matches('[data-testid="tweet"]') ||
                  node.matches('[data-testid="UserName"]'))
              ) {
                shouldProcess = true;
              }
            }
          });
        }
      });

      if (shouldProcess) {
        setTimeout(() => this.processPage(), 500);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  processPage() {
    if (this.isUserProfilePage()) {
      // 在用户个人页面处理备注
      this.processUserProfile();
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
    const userId = await this.extractUserIdFromPage(username);

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

  processHomePage() {
    // 在主页等页面基于用户名显示备注
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
      noteDisplay.textContent = `[${noteName}]`;
      noteDisplay.style.display = "inline";

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
          const userId = await this.fetchUserIdFromProfile(username);
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
      .then(() => {
        const dialog = document.createElement("div");
        dialog.className = "twitter-notes-detail-dialog";

        const noteName = currentNote.name || "";
        const noteDescription = currentNote.description || "";

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
          this.showNoteDialog(userId, username);
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
      .then(() => {
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

          if (!noteName) {
            alert(langData.notePlaceholder);
            nameInput.focus();
            return;
          }

          const noteData = {
            name: noteName,
            description: noteDescription,
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

          const isHomePage = !this.isUserProfilePage();

          if (hasNote) {
            const noteName = hasNote.name || "";
            const noteDescription = hasNote.description || "";

            button.title = `${langData.editNote}: ${noteName}`;
            display.textContent = `[${noteName}]`;
            display.style.display = "inline";

            if (noteDescription) {
              detailButton.style.display = "inline";
              detailButton.title = `${langData.viewDetail}: ${noteDescription}`;
            } else {
              detailButton.style.display = "none";
            }
          } else {
            button.title = `${langData.addNote}`;
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
