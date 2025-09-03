import { cryptoUtils } from "./crypto-utils.js";

const langBtn = document.getElementById("langBtn");
let currentLang = localStorage.getItem("lang") || "zh";
let langData = {};
const Expires = "0";

// 标签颜色库
const colors = [
  // 蓝色系
  "#1565C0",
  "#64B5F6",
  // 青绿系
  "#00695C",
  "#1DE9B6",
  // 橙色系
  "#BF360C",
  "#FF8A65",
  // 红色系
  "#B71C1C",
  "#EF5350",
  // 紫色系
  "#4527A0",
  "#B388FF",
  // 粉色系
  "#880E4F",
  "#F48FB1",
  // 金黄色系
  "#FF6F00",
  "#FFD54F",
  // 草绿色系
  "#33691E",
  "#AED581",
  // 湖蓝系
  "#01579B",
  "#4DD0E1",
  // 桃/珊瑚系
  "#AD1457",
  "#F06292",
  // 中性灰系
  "#263238",
  "#90A4AE",
  // 补充色
  "#283593",
  "#00ACC1",
];

// 载入语言文件并更新文本
async function loadLanguage(lang) {
  try {
    const response = await fetch(`lang/${lang}.json`);
    langData = await response.json();
    localStorage.setItem("lang", lang);
    currentLang = lang;
    chrome.storage.local.set({ lang: currentLang });
    langBtn.textContent = lang === "zh" ? "English" : "中文";
    console.log(langData.status.webdavConnected);

    updateTexts();
    updateConfigurationStatus();
    loadAutoBackupSettings();
    loadRecentNotes();
  } catch (e) {
    console.error("加载语言文件失败:", e);
  }
}

// 语言模块
async function getCurrentLangData() {
  return new Promise((resolve, reject) => {
    if (langData && Object.keys(langData).length > 0) {
      resolve();
    } else {
      loadLanguage(currentLang)
        .then(() => resolve())
        .catch((error) => reject(error));
    }
  });
}

// 更新页面中所有需要翻译的文本
function updateTexts() {
  // 统计部分标签更新
  document.querySelectorAll("[data-key]").forEach((el) => {
    const key = el.getAttribute("data-key");
    if (langData[key]) {
      el.textContent = langData[key];
      el.placeholder = langData[key];
    }
  });

  // 更新频率选项
  const frequencySelect = document.getElementById("backupFrequency");
  const options = frequencySelect.querySelectorAll("option");
  options[0].textContent = langData.frequencies.hourly;
  options[1].textContent = langData.frequencies.daily;
  options[2].textContent = langData.frequencies.weekly;
  options[3].textContent = langData.frequencies.monthly;

  // 更新设置提示
  const setupNotice = document.getElementById("setupNotice");
  if (setupNotice) {
    setupNotice.innerHTML = `
      <span class="icon">🌐</span>
      <div>${langData.setup.configureWebdav}</div>
      <div style="margin-top: 8px; font-size: 11px; color: #999;">
        ${langData.setup.supportedServices}
      </div>
    `;
  }

  // 最近备注无数据提示
  const recentNotesDiv = document.getElementById("recentNotes");
  const noNotesMsg = langData.noNotes || "No notes available";
  if (
    recentNotesDiv.textContent.trim() === "" ||
    recentNotesDiv.textContent.trim() === langData.noNotes ||
    recentNotesDiv.textContent.trim() === "暂无备注数据"
  ) {
    recentNotesDiv.innerHTML = `<div style="text-align: center; color: #536471; padding: 20px;">${noNotesMsg}</div>`;
  }
}

// 语言切换按钮事件
langBtn.addEventListener("click", () => {
  const newLang = currentLang === "zh" ? "en" : "zh";
  loadLanguage(newLang);
});

document.addEventListener("DOMContentLoaded", async function () {
  // 先加载语言
  await loadLanguage(currentLang);

  // 获取并设置版本号
  const manifest = chrome.runtime.getManifest();
  const versionElement = document.querySelector(".version");
  if (versionElement) {
    versionElement.textContent = `v${manifest.version}`;
  }

  // 检查版本更新
  await checkForUpdates(manifest.version);

  // 加载统计数据
  await loadStats();

  // 加载推文截图开关
  await Screeshot();

  // 加载最近备注
  await loadRecentNotes();

  // 加载WebDAV开关
  await toggleWebDAV();

  // 加载标签面板
  await TagGroups();

  // 加载标签
  await loadTags();

  // 绑定其他事件
  document
    .getElementById("exportBtn")
    .addEventListener("click", showExportDialog);
  document.getElementById("importBtn").addEventListener("click", () => {
    document.getElementById("fileInput").click();
  });
  document.getElementById("fileInput").addEventListener("change", importNotes);
  document.getElementById("clearBtn").addEventListener("click", clearAllNotes);

  // WebDAV 备份事件
  document
    .getElementById("webdavBackup")
    .addEventListener("click", showBackupDialog);
  document
    .getElementById("webdavRestore")
    .addEventListener("click", restoreFromWebDAV);
  document
    .getElementById("viewBackupList")
    .addEventListener("click", showBackupList);

  // WebDAV 配置事件
  document
    .getElementById("saveWebdavConfig")
    .addEventListener("click", saveWebdavConfig);
  document
    .getElementById("testWebdavConnection")
    .addEventListener("click", testWebdavConnection);

  // 自动备份事件
  document
    .getElementById("autoBackupToggle")
    .addEventListener("click", toggleAutoBackup);
  document
    .getElementById("backupFrequency")
    .addEventListener("change", updateAutoBackupFrequency);
  document
    .getElementById("testAutoBackup")
    .addEventListener("click", testAutoBackup);
  const autoBackupTagFilterToggle = document.getElementById(
    "autoBackupTagFilterToggle"
  );
  if (autoBackupTagFilterToggle) {
    autoBackupTagFilterToggle.addEventListener(
      "click",
      toggleAutoBackupTagFilter
    );
  }

  // 标签管理事件
  document
    .getElementById("addTagBtn")
    .addEventListener("click", showAddTagDialog);

  const tagList = document.getElementById("tagList");
  tagList.addEventListener("click", (event) => {
    if (event.target.classList.contains("tag-edit")) {
      const tagId = event.target.dataset.id;
      showEditTagDialog(tagId);
    }
  });

  // 监听配置输入变化 - 只更新状态，不改变折叠状态
  document
    .getElementById("webdavUrl")
    .addEventListener("input", updateConfigurationStatusOnly);
  document
    .getElementById("webdavUsername")
    .addEventListener("input", updateConfigurationStatusOnly);
  document
    .getElementById("webdavPassword")
    .addEventListener("input", updateConfigurationStatusOnly);

  // WebDAV 配置折叠事件
  document
    .getElementById("webdavConfigHeader")
    .addEventListener("click", toggleWebdavConfigPanel);
});

// 检查版本更新
async function checkForUpdates(currentVersion) {
  try {
    console.log("检查版本更新，当前版本:", currentVersion);

    // GitHub Releases API URL
    const githubReleasesUrl =
      "https://api.github.com/repos/jaxo4life/XMark/releases/latest";

    const response = await fetch(githubReleasesUrl, {
      cache: "no-cache",
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
        Expires: Expires, // Use the declared Expires variable
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "XMark-Extension",
      },
    });

    if (!response.ok) {
      console.log("无法获取远程版本信息，状态码:", response.status);
      return;
    }

    const releaseData = await response.json();
    const remoteVersion = releaseData.tag_name.replace(/^v/, ""); // 移除可能的 'v' 前缀

    console.log("远程版本:", remoteVersion, "当前版本:", currentVersion);

    if (compareVersions(remoteVersion, currentVersion) > 0) {
      console.log("发现新版本:", remoteVersion);
      showUpdateNotification(remoteVersion, releaseData.html_url);
    } else {
      console.log("当前版本是最新的");
    }
  } catch (error) {
    console.error("检查更新失败:", error);
  }
}

// 比较版本号
function compareVersions(version1, version2) {
  const v1parts = version1.split(".").map(Number);
  const v2parts = version2.split(".").map(Number);

  const maxLength = Math.max(v1parts.length, v2parts.length);

  for (let i = 0; i < maxLength; i++) {
    const v1part = v1parts[i] || 0;
    const v2part = v2parts[i] || 0;

    if (v1part > v2part) return 1;
    if (v1part < v2part) return -1;
  }

  return 0;
}

// 显示更新通知
function showUpdateNotification(newVersion, releaseUrl) {
  const versionElement = document.querySelector(".version");
  if (versionElement) {
    // 创建更新按钮
    const updateButton = document.createElement("button");
    updateButton.className = "update-button";
    updateButton.innerHTML = `🔄 v${newVersion}`;
    updateButton.title = `${langData.updateAvailable} v${newVersion}`;
    updateButton.onclick = () => {
      window.open(
        releaseUrl || "https://github.com/jaxo4life/XMark/releases",
        "_blank"
      );
    };

    // 替换版本显示
    versionElement.style.display = "none";
    versionElement.parentNode.appendChild(updateButton);
  }
}

// 加载统计数据
async function loadStats() {
  try {
    const result = await chrome.storage.local.get(["twitterNotes"]);
    const notes = result.twitterNotes || {};

    const totalNotes = Object.keys(notes).length;
    document.getElementById("totalNotes").textContent = totalNotes;

    // 计算今日新增
    const today = new Date().toDateString();
    const todayNotes = Object.values(notes).filter(
      (note) => new Date(note.createdAt).toDateString() === today
    ).length;
    document.getElementById("todayNotes").textContent = todayNotes;
  } catch (error) {
    console.error("加载统计数据失败:", error);
  }
}

// 加载推文保存按钮
async function Screeshot() {
  const toggle = document.getElementById("toggle-screenshot");

  // 读取状态并初始化样式
  const res = await new Promise((resolve) => {
    chrome.storage.local.get({ enableScreenshot: true }, resolve);
  });

  if (res.enableScreenshot) {
    toggle.classList.add("active");
  } else {
    toggle.classList.remove("active");
  }

  // 点击切换状态
  toggle.addEventListener("click", () => {
    const isActive = toggle.classList.toggle("active"); // 切换样式
    chrome.storage.local.set({ enableScreenshot: isActive }); // 保存状态
  });
}

// 加载最近备注
async function loadRecentNotes() {
  try {
    const result = await chrome.storage.local.get(["twitterNotes", "noteTags"]);
    const notes = result.twitterNotes || {};
    const tags = result.noteTags || {};

    const recentNotesContainer = document.getElementById("recentNotes");

    if (Object.keys(notes).length === 0) {
      recentNotesContainer.innerHTML = `
        <div style="text-align: center; color: #536471; padding: 20px;">
          ${langData.noNotes}
        </div>
      `;
      return;
    }

    // 按创建时间排序，显示最近10条
    const sortedNotes = Object.entries(notes)
      .sort(([, a], [, b]) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 10);

    recentNotesContainer.innerHTML = sortedNotes
      .map(([userId, note]) => {
        const noteName = note.name || "";
        const noteTag = note.tagId || "";

        return `
        <div class="note-item">
          <div class="note-user">@${note.username || "unknown"}</div>
          <div class="note-id">ID: ${userId}</div>
          <div class="note-name">${langData.noteName}: ${noteName}</div>
          ${
            noteTag && tags[noteTag]
              ? `<div class="note-desc">${langData.tagName}: ${tags[noteTag].name}</div>`
              : ""
          }
        </div>
      `;
      })
      .join("");
  } catch (error) {
    console.error("加载最近备注失败:", error);
  }
}

// 监听来自 background script 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "autoBackupComplete") {
    if (message.success) {
      showMessage(`${langData.messages.autoBackupSuccess} ${message.fileName}`);
    } else {
      showMessage(
        `${langData.messages.autoBackupFailed} ${message.error}`,
        "error"
      );
    }
    // 重新加载自动备份状态

    loadAutoBackupSettings();
  }
});

/* ==========================基础模块========================== */
// 导出备注
async function exportNotes() {
  try {
    const result = await chrome.storage.local.get([
      "twitterNotes",
      "noteTags",
      "noteTagsOrder",
    ]);
    const notes = result.twitterNotes || {};
    const tags = result.noteTags || {};
    const order = result.noteTagsOrder || [];

    const manifest = chrome.runtime.getManifest();
    const exportData = {
      version: manifest.version,
      exportTime: new Date().toISOString(),
      notes: notes,
      tags: tags,
      noteTagsOrder: order,
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });

    const filename = `Xmark/Backup/XMark-${
      new Date().toISOString().split("T")[0]
    }.json`;

    // 创建临时 URL
    const url = URL.createObjectURL(blob);

    // 使用 chrome.downloads.download 保存到子目录
    chrome.downloads.download(
      {
        url: url,
        filename: filename,
        saveAs: false, // 如果想让用户选择路径改成 true
      },
      (downloadId) => {
        URL.revokeObjectURL(url); // 释放对象 URL
        if (chrome.runtime.lastError) {
          console.error("导出失败:", chrome.runtime.lastError);
          showMessage(langData.exportFail, "error");
        } else {
          showMessage(langData.exportSuccess);
        }
      }
    );
  } catch (error) {
    showMessage(langData.exportFail, "error");
  }
}

// 导入备注
async function importNotes(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const importData = JSON.parse(text);

    if (!importData.notes) {
      throw new Error(langData.invalidFormat);
    }

    // 处理导入的数据
    await processImportedNotes(importData);

    showMessage(langData.importSuccess);
  } catch (error) {
    showMessage(langData.importFail, "error");
  }

  // 清空文件输入
  event.target.value = "";
}

// 处理导入的备注数据
async function processImportedNotes(importData) {
  // 获取现有备注
  const result = await chrome.storage.local.get([
    "twitterNotes",
    "noteTags",
    "noteTagsOrder",
  ]);
  const existingNotes = result.twitterNotes || {};
  const existingTags = result.noteTags || {};
  const existingOrder = result.noteTagsOrder || [];

  // 处理导入的备注，确保格式正确
  const processedNotes = {};
  Object.entries(importData.notes).forEach(([userId, note]) => {
    if (typeof note === "string") {
      // 旧格式兼容
      processedNotes[userId] = {
        name: note,
        description: "",
        username: userId,
        userId: userId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    } else if (note.text && !note.name) {
      // 旧格式兼容
      processedNotes[userId] = {
        name: note.text,
        description: note.description || "",
        username: note.username || userId,
        userId: note.userId || userId,
        createdAt: note.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    } else {
      // 新格式
      processedNotes[userId] = note;
    }
  });

  // 处理导入的标签
  const processedTags = {};
  if (importData.tags) {
    Object.entries(importData.tags).forEach(([tagId, tag]) => {
      processedTags[tagId] = tag;
    });
  }

  // 合并备注（导入的备注会覆盖现有的同用户备注）
  const mergedNotes = { ...existingNotes, ...processedNotes };
  const mergedTags = { ...existingTags, ...processedTags };

  // 处理导入的标签顺序
  let mergedOrder = [];
  if (importData.noteTagsOrder) {
    mergedOrder = existingOrder.concat(
      importData.noteTagsOrder.filter((id) => !existingOrder.includes(id))
    );
  } else {
    // 老文件，没有 noteTagsOrder，用标签对象的顺序自动生成
    mergedOrder = Object.keys(importData.tags || {});
  }

  await chrome.storage.local.set({
    twitterNotes: mergedNotes,
    noteTags: mergedTags,
    noteTagsOrder: mergedOrder,
  });

  // 重新加载数据
  await loadStats();
  await loadRecentNotes();
  await loadTags();
}

// 按标签筛选备注
function filterNotesByTags(notes, selectedTagIds) {
  if (!selectedTagIds || selectedTagIds.length === 0) {
    return notes;
  }

  const filteredNotes = {};
  Object.entries(notes).forEach(([userId, note]) => {
    if (note.tagId && selectedTagIds.includes(note.tagId)) {
      filteredNotes[userId] = note;
    }
  });

  return filteredNotes;
}

// 按标签导出备注
async function exportNotesByTags(selectedTagIds) {
  try {
    const result = await chrome.storage.local.get(["twitterNotes", "noteTags"]);
    const allNotes = result.twitterNotes || {};
    const tags = result.noteTags || {};

    // 筛选指定标签的备注
    const filteredNotes = filterNotesByTags(allNotes, selectedTagIds);

    if (Object.keys(filteredNotes).length === 0) {
      showMessage(langData.messages.noNotesWithSelectedTags, "error");
      return;
    }

    // 筛选相关的标签
    const filteredTags = {};
    selectedTagIds.forEach((tagId) => {
      if (tags[tagId]) {
        filteredTags[tagId] = tags[tagId];
      }
    });

    const manifest = chrome.runtime.getManifest();
    const exportData = {
      version: manifest.version,
      exportTime: new Date().toISOString(),
      notes: filteredNotes,
      tags: filteredTags,
      exportType: "tags",
      selectedTags: selectedTagIds,
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });

    const filename = `Xmark/Backup/XMark-tags-${
      new Date().toISOString().split("T")[0]
    }.json`;

    // 创建临时 URL
    const url = URL.createObjectURL(blob);

    // 使用 chrome.downloads.download 保存到子目录
    chrome.downloads.download(
      {
        url: url,
        filename: filename,
        saveAs: false, // 如果想让用户选择路径改成 true
      },
      (downloadId) => {
        URL.revokeObjectURL(url); // 释放对象 URL
        if (chrome.runtime.lastError) {
          console.error("导出失败:", chrome.runtime.lastError);
          showMessage(langData.exportFail, "error");
        } else {
          showMessage(langData.exportSuccess);
        }
      }
    );
  } catch (error) {
    showMessage(langData.exportFail, "error");
  }
}

// 显示导出对话框
function showExportDialog() {
  const existingDialog = document.querySelector(".export-dialog");
  if (existingDialog) {
    existingDialog.remove();
  }

  getCurrentLangData()
    .then(async () => {
      const dialog = document.createElement("div");
      dialog.className = "export-dialog";

      // 加载标签数据
      const tagResult = await chrome.storage.local.get(["noteTags"]);
      const availableTags = tagResult.noteTags || {};

      dialog.innerHTML = `
        <div class="export-dialog-content">
          <div class="export-dialog-header">
            <h3>📤 ${langData.exportOptions}</h3>
            <button class="twitter-notes-close">×</button>
          </div>
          <div class="export-dialog-body">
            <div class="export-options">
              <div class="option-group">
                <label>
                  <input type="radio" name="exportType" value="all" checked>
                  ${langData.exportAll}
                </label>
              </div>
              <div class="option-group">
                <label>
                  <input type="radio" name="exportType" value="tags">
                  ${langData.exportByTags}
                </label>
              </div>
            </div>
            <div id="exportTagSelection" class="tag-selection hidden">
              <h4>${langData.selectTagsToExport}</h4>
              <div class="tag-checkboxes">
                ${Object.entries(availableTags)
                  .map(
                    ([tagId, tag]) => `
                  <div class="tag-checkbox">
                    <input type="checkbox" id="exportTag_${tagId}" value="${tagId}">
                    <label for="exportTag_${tagId}">
                      <span class="tag-color-indicator" style="background-color: ${tag.color}"></span>
                      ${tag.name}
                    </label>
                  </div>
                `
                  )
                  .join("")}
              </div>
            </div>
          </div>
          <div class="export-dialog-footer">
            <button id="cancelExport" class="deleteTagBtn">
              ${langData.exportCancel}
            </button>
            <button id="confirmExport" class="saveTagBtn">
              ${langData.exportSelectedTags}
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(dialog);

      const closeBtn = dialog.querySelector(".twitter-notes-close");
      const cancelBtn = dialog.querySelector("#cancelExport");
      const confirmBtn = dialog.querySelector("#confirmExport");
      const radioButtons = dialog.querySelectorAll('input[name="exportType"]');
      const tagSelection = dialog.querySelector("#exportTagSelection");

      const closeDialog = () => dialog.remove();
      closeBtn.addEventListener("click", closeDialog);
      cancelBtn.addEventListener("click", closeDialog);
      dialog.addEventListener("click", (e) => {
        if (e.target === dialog) closeDialog();
      });

      // 切换导出类型
      radioButtons.forEach((radio) => {
        radio.addEventListener("change", () => {
          if (radio.value === "tags") {
            tagSelection.classList.remove("hidden");
          } else {
            tagSelection.classList.add("hidden");
          }
        });
      });

      // 确认导出
      confirmBtn.addEventListener("click", async () => {
        const exportType = dialog.querySelector(
          'input[name="exportType"]:checked'
        ).value;

        if (exportType === "all") {
          closeDialog();
          await exportNotes();
        } else {
          // 按标签导出
          const selectedTags = [];
          dialog
            .querySelectorAll(
              '#exportTagSelection input[type="checkbox"]:checked'
            )
            .forEach((checkbox) => {
              selectedTags.push(checkbox.value);
            });

          if (selectedTags.length === 0) {
            alert(langData.noTagsSelected);
            return;
          }

          closeDialog();
          await exportNotesByTags(selectedTags);
        }
      });
    })
    .catch((e) => {
      console.error("加载语言数据失败:", e);
    });
}

// 清空所有备注
async function clearAllNotes() {
  if (!confirm(langData.confirmClear)) {
    return;
  }

  try {
    await exportNotes();
    await chrome.storage.local.remove([
      "twitterNotes",
      "noteTags",
      "noteTagsOrder",
    ]);
    await loadStats();
    await loadRecentNotes();
    await loadTags();

    showMessage(
      '<span style="font-weight:bold; font-size:16px;color:#960e0eff;">' +
        langData.allCleared +
        "</span>\n" +
        langData.exportReminder
    );
  } catch (error) {
    showMessage(langData.clearFail, "error");
  }
}

/* ==========================WebDAV模块========================== */
// WebDAV 开关
async function toggleWebDAV() {
  const toggle = document.getElementById("webdavToggle");
  const webdav = document.getElementById("webdav");

  // 读取存储状态并初始化 UI
  const res = await new Promise((resolve) => {
    chrome.storage.local.get({ WebDAVisOn: { enabled: false } }, resolve);
  });

  if (res.WebDAVisOn.enabled) {
    toggle.classList.add("active");
    webdav.classList.remove("hidden");
  } else {
    toggle.classList.remove("active");
    webdav.classList.add("hidden");
  }

  // 刷新配置面板或自动备份设置
  await loadWebdavConfig();
  await loadAutoBackupSettings();
  await updateConfigurationStatus();
  // 点击切换状态
  toggle.addEventListener("click", async () => {
    const isEnabled = toggle.classList.toggle("active"); // 切换样式
    await chrome.storage.local.set({ WebDAVisOn: { enabled: isEnabled } }); // 保存状态

    // 刷新配置面板或自动备份设置
    await loadWebdavConfig();
    await loadAutoBackupSettings();
    await updateConfigurationStatus();

    // 提示信息
    if (isEnabled) {
      webdav.classList.remove("hidden");
      showMessage(langData.messages.webdavEnabled);
    } else {
      webdav.classList.add("hidden");
      showMessage(langData.messages.webdavDisabled, "error");
    }
  });
}

// 切换 WebDAV 配置面板
async function toggleWebdavConfigPanel() {
  try {
    const header = document.getElementById("webdavConfigHeader");
    const panel = document.getElementById("webdavConfigPanel");
    const toggle = document.getElementById("configToggle");
    const result = await chrome.storage.local.get(["WebDAVisOn"]);
    const settings = result.WebDAVisOn || { enabled: false };
    if (settings.enabled) {
      if (panel.classList.contains("hidden")) {
        panel.classList.remove("hidden");
        toggle.classList.add("expanded");
      } else {
        panel.classList.add("hidden");
        toggle.classList.remove("expanded");
      }
    } else {
      header.classList.add("hidden");
    }
  } catch (error) {}
}

// 加载WebDAV配置
async function loadWebdavConfig() {
  try {
    const result = await chrome.storage.local.get(["webdavConfig"]);
    let config = result.webdavConfig || {};

    // 如果配置是加密的，先解密
    if (config.encrypted) {
      config = await cryptoUtils.decryptWebDAVConfig(config);
    }

    if (config.url) document.getElementById("webdavUrl").value = config.url;
    if (config.username)
      document.getElementById("webdavUsername").value = config.username;
    if (config.password)
      document.getElementById("webdavPassword").value = config.password;
  } catch (error) {
    console.error("加载 WebDAV 配置失败:", error);
  }
}

// 保存WebDAV配置
async function saveWebdavConfig() {
  const url = document.getElementById("webdavUrl").value.trim();
  const username = document.getElementById("webdavUsername").value.trim();
  const password = document.getElementById("webdavPassword").value.trim();

  if (!url) {
    showMessage(langData.messages.enterServerAddress, "error");
    return;
  }

  if (!username || !password) {
    showMessage(langData.messages.enterCredentials, "error");
    return;
  }

  try {
    // 加密配置
    const encryptedConfig = await cryptoUtils.encryptWebDAVConfig({
      url,
      username,
      password,
    });

    await chrome.storage.local.set({ webdavConfig: encryptedConfig });

    // 清除之前的连接状态
    await chrome.storage.local.remove(["webdavConnectionStatus"]);

    showMessage(langData.messages.webdavConfigSaved);
    await updateConfigurationStatusOnly(); // 只更新状态，不改变折叠状态
  } catch (error) {
    showMessage(
      `langData.messages.webdavConfigSaveFailed + ${error.message}`,
      "error"
    );
  }
}

// 测试WebDAV连接
async function testWebdavConnection() {
  const button = document.getElementById("testWebdavConnection");
  const originalText = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `<span>⏳</span> ${langData.buttons.testing}`;

  try {
    const configResult = await chrome.storage.local.get(["webdavConfig"]);
    let config = configResult.webdavConfig;

    if (!config || !config.url) {
      throw new Error(langData.messages.configureWebdavFirst);
    }

    // 解密配置
    if (config.encrypted) {
      config = await cryptoUtils.decryptWebDAVConfig(config);
    }

    // 准备认证头
    const headers = {};
    if (config.username && config.password) {
      headers["Authorization"] =
        "Basic " + btoa(config.username + ":" + config.password);
    }

    // 测试连接 - 使用 OPTIONS 方法
    const testResult = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          action: "webdavRequest",
          url: config.url,
          method: "OPTIONS",
          headers: headers,
        },
        resolve
      );
    });

    // 创建/Xmark/Backup/
    await makedir(config.url, headers);

    if (!testResult.success) {
      throw new Error(testResult.error);
    }

    if (
      testResult.response.ok ||
      testResult.response.status === 200 ||
      testResult.response.status === 204
    ) {
      // 保存连接成功状态
      await chrome.storage.local.set({
        webdavConnectionStatus: "connected",
      });
      showMessage(langData.messages.webdavTestSuccess);
    } else {
      // 保存连接失败状态
      await chrome.storage.local.set({
        webdavConnectionStatus: "failed",
      });
      throw new Error(
        `${langData.messages.connectionFailed} ${testResult.response.status} ${testResult.response.statusText}`
      );
    }
  } catch (error) {
    await chrome.storage.local.set({ webdavConnectionStatus: "failed" });
    showMessage(
      `${langData.messages.webdavTestFailed} + ${error.message}`,
      "error"
    );
  } finally {
    button.disabled = false;
    button.innerHTML = originalText;
    await updateConfigurationStatus();
  }
}

async function makedir(baseUrl, headers) {
  // 二级目录依次检查
  const dirs = ["Xmark", "Backup"];
  let currentUrl = baseUrl.replace(/\/?$/, ""); // 确保 baseUrl 末尾没有多余斜杠

  for (const dir of dirs) {
    currentUrl += `/${dir}`;

    // 检查目录是否存在
    const res = await fetch(currentUrl, { method: "PROPFIND", headers });
    if (!res.ok) {
      // 如果不存在，就创建
      try {
        await fetch(currentUrl, {
          method: "MKCOL",
          headers,
        });
        console.log("MKCOL 创建成功:", currentUrl);
      } catch (err) {
        console.warn("MKCOL 创建失败（可能已存在）:", currentUrl, err);
      }
    } else {
      console.log("目录已存在:", currentUrl);
    }
  }

  return;
}

// 只更新配置状态，不改变折叠状态（用于输入变化时）
async function updateConfigurationStatusOnly() {
  const url = document.getElementById("webdavUrl").value.trim();
  const username = document.getElementById("webdavUsername").value.trim();
  const password = document.getElementById("webdavPassword").value.trim();

  const configStatus = document.getElementById("configStatus");
  const backupFunctions = document.getElementById("backupFunctions");
  const setupNotice = document.getElementById("setupNotice");

  const isConfigured = url && username && password;

  // 读取存储状态并初始化 UI
  const res = await new Promise((resolve) => {
    chrome.storage.local.get({ WebDAVisOn: { enabled: false } }, resolve);
  });

  if (isConfigured) {
    // 检查是否已测试连接
    const result = await chrome.storage.local.get(["webdavConnectionStatus"]);
    const connectionStatus = result.webdavConnectionStatus;

    if (connectionStatus === "connected") {
      configStatus.className = "config-status connected";
      configStatus.innerHTML = `<span>✅</span> ${langData.status.webdavConnected}`;
      backupFunctions.classList.remove("hidden");
      setupNotice.classList.add("hidden");
    } else if (connectionStatus === "failed") {
      configStatus.className = "config-status disconnected";
      configStatus.innerHTML = `<span>❌</span> ${langData.status.webdavConnectionFailed}`;
      backupFunctions.classList.add("hidden");
      setupNotice.classList.add("hidden");
    } else {
      configStatus.className = "config-status disconnected";
      configStatus.innerHTML = `<span>⚠️</span> ${langData.status.webdavConfigFilled}`;
      backupFunctions.classList.add("hidden");
      setupNotice.classList.add("hidden");
    }
  } else {
    configStatus.className = "config-status unconfigured";
    configStatus.innerHTML = `<span>⚠️</span> ${langData.status.webdavConfigRequired}`;
    backupFunctions.classList.add("hidden");
    setupNotice.classList.remove("hidden");
  }
}

// 检查并更新配置状态（包括折叠状态管理）
async function updateConfigurationStatus() {
  const url = document.getElementById("webdavUrl").value.trim();
  const username = document.getElementById("webdavUsername").value.trim();
  const password = document.getElementById("webdavPassword").value.trim();

  const configStatus = document.getElementById("configStatus");
  const backupFunctions = document.getElementById("backupFunctions");
  const setupNotice = document.getElementById("setupNotice");
  const configPanel = document.getElementById("webdavConfigPanel");
  const configToggle = document.getElementById("configToggle");

  const isConfigured = url && username && password;

  if (isConfigured) {
    // 检查是否已测试连接
    const result = await chrome.storage.local.get(["webdavConnectionStatus"]);
    const connectionStatus = result.webdavConnectionStatus;

    if (connectionStatus === "connected") {
      configStatus.className = "config-status connected";
      configStatus.innerHTML = `<span>✅</span> ${langData.status.webdavConnected}`;
      backupFunctions.classList.remove("hidden");
      setupNotice.classList.add("hidden");

      // 连接成功后自动折叠配置面板

      configPanel.classList.add("hidden");
      configToggle.classList.remove("expanded");
    } else if (connectionStatus === "failed") {
      configStatus.className = "config-status disconnected";
      configStatus.innerHTML = `<span>❌</span> ${langData.status.webdavConnectionFailed}`;
      backupFunctions.classList.add("hidden");
      setupNotice.classList.add("hidden");

      // 连接失败时保持折叠状态，用户需要手动展开
      configPanel.classList.add("hidden");
      configToggle.classList.remove("expanded");
    } else {
      configStatus.className = "config-status disconnected";
      configStatus.innerHTML = `<span>⚠️</span> ${langData.status.webdavConfigFilled}`;
      backupFunctions.classList.add("hidden");
      setupNotice.classList.add("hidden");

      // 配置未测试时保持折叠状态，用户需要手动展开
      configPanel.classList.add("hidden");
      configToggle.classList.remove("expanded");
    }
  } else {
    configStatus.className = "config-status unconfigured";
    configStatus.innerHTML = `<span>⚠️</span> ${langData.status.webdavConfigRequired}`;
    backupFunctions.classList.add("hidden");
    setupNotice.classList.remove("hidden");

    // 未配置时也保持折叠状态，用户需要手动展开
    configPanel.classList.add("hidden");
    configToggle.classList.remove("expanded");
  }
}

// 加载自动备份设置
async function loadAutoBackupSettings() {
  try {
    const result = await chrome.storage.local.get(["autoBackupSettings"]);
    const settings = result.autoBackupSettings || {
      enabled: false,
      frequency: "daily",
      lastBackup: null,
      tagFilter: {
        enabled: false,
        selectedTags: [],
      },
    };

    const toggle = document.getElementById("autoBackupToggle");
    const settingsDiv = document.getElementById("autoBackupSettings");
    const frequencySelect = document.getElementById("backupFrequency");
    const tagFilterToggle = document.getElementById(
      "autoBackupTagFilterToggle"
    );
    const tagFilterSettings = document.getElementById(
      "autoBackupTagFilterSettings"
    );

    // 更新开关状态
    toggle.classList.toggle("active", settings.enabled);

    // 显示/隐藏设置
    if (settings.enabled) {
      settingsDiv.classList.remove("hidden");
    } else {
      settingsDiv.classList.add("hidden");
    }

    // 设置频率选择
    frequencySelect.value = settings.frequency;

    // 更新标签筛选设置
    if (settings.tagFilter) {
      tagFilterToggle.classList.toggle("active", settings.tagFilter.enabled);
      if (settings.tagFilter.enabled) {
        tagFilterSettings.classList.remove("hidden");
        await loadAutoBackupTagOptions(settings.tagFilter.selectedTags);
      } else {
        tagFilterSettings.classList.add("hidden");
      }
    }

    // 更新状态显示
    updateAutoBackupStatus(settings);
  } catch (error) {
    console.error("加载自动备份设置失败:", error);
  }
}

// 加载自动备份标签选项
async function loadAutoBackupTagOptions(selectedTags = []) {
  try {
    const result = await chrome.storage.local.get(["noteTags"]);
    const tags = result.noteTags || {};
    const container = document.getElementById("autoBackupTagOptions");

    if (Object.keys(tags).length === 0) {
      container.innerHTML = `<div style="color: #536471; font-size: 12px; text-align: center; padding: 10px;">暂无标签</div>`;
      return;
    }

    container.innerHTML = Object.entries(tags)
      .map(
        ([tagId, tag]) => `
        <div class="tag-filter-option">
          <input type="checkbox" id="autoBackupTag_${tagId}" value="${tagId}" ${
          selectedTags.includes(tagId) ? "checked" : ""
        }>
          <label for="autoBackupTag_${tagId}">
            <span class="tag-color-indicator" style="background-color: ${
              tag.color
            }"></span>
            ${tag.name}
          </label>
        </div>
      `
      )
      .join("");

    // 绑定变化事件
    container.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
      checkbox.addEventListener("change", saveAutoBackupTagFilter);
    });
  } catch (error) {
    console.error("加载自动备份标签选项失败:", error);
  }
}

// 保存自动备份标签筛选设置
async function saveAutoBackupTagFilter() {
  try {
    const result = await chrome.storage.local.get(["autoBackupSettings"]);
    const settings = result.autoBackupSettings || {};

    if (!settings.tagFilter) {
      settings.tagFilter = { enabled: false, selectedTags: [] };
    }

    // 获取选中的标签
    const selectedTags = [];
    document
      .querySelectorAll('#autoBackupTagOptions input[type="checkbox"]:checked')
      .forEach((checkbox) => {
        selectedTags.push(checkbox.value);
      });

    settings.tagFilter.selectedTags = selectedTags;
    await chrome.storage.local.set({ autoBackupSettings: settings });
  } catch (error) {
    console.error("保存自动备份标签筛选设置失败:", error);
  }
}

// 切换自动备份标签筛选
async function toggleAutoBackupTagFilter() {
  try {
    const result = await chrome.storage.local.get(["autoBackupSettings"]);
    const settings = result.autoBackupSettings || {};

    if (!settings.tagFilter) {
      settings.tagFilter = { enabled: false, selectedTags: [] };
    }

    settings.tagFilter.enabled = !settings.tagFilter.enabled;
    await chrome.storage.local.set({ autoBackupSettings: settings });
    await loadAutoBackupSettings();
  } catch (error) {
    console.error("切换自动备份标签筛选失败:", error);
  }
}

// 更新自动备份状态显示
function updateAutoBackupStatus(settings) {
  const statusDiv = document.getElementById("autoBackupStatus");

  if (settings.enabled) {
    statusDiv.classList.add("enabled");

    const frequencyText = langData.frequencies[settings.frequency];
    let statusText = `✅ ${langData.status.autoBackupEnabled} (${frequencyText})`;

    // 添加标签筛选状态
    if (settings.tagFilter && settings.tagFilter.enabled) {
      const tagCount = settings.tagFilter.selectedTags.length;
      statusText += `\n🏷️ ${langData.autoBackupSelectedTags} (${tagCount}个标签)`;
    } else {
      statusText += `\n🏷️ ${langData.autoBackupAllTags}`;
    }

    if (settings.lastBackup) {
      const lastBackupDate = new Date(settings.lastBackup);
      const now = new Date();
      const diffMinutes = Math.floor((now - lastBackupDate) / (1000 * 60));

      if (diffMinutes < 1) {
        statusText += `\n${langData.status.lastBackup}: ${langData.status.justNow}`;
      } else if (diffMinutes < 60) {
        statusText += `\n${langData.status.lastBackup}: ${diffMinutes} ${langData.status.minutesAgo} `;
      } else {
        const diffHours = Math.floor(diffMinutes / 60);
        if (diffHours < 24) {
          statusText += `\n${langData.status.lastBackup}: ${diffHours} ${langData.status.hoursAgo}`;
        } else {
          const diffDays = Math.floor(diffHours / 24);
          statusText += `\n${langData.status.lastBackup}: ${diffDays} ${langData.status.daysAgo}`;
        }
      }
    } else {
      statusText += `\n${langData.status.noAutoBackup}`;
    }

    statusDiv.textContent = statusText;
  } else {
    statusDiv.classList.remove("enabled");
    statusDiv.textContent = langData.status.autoBackupDisabled;
  }
}

// 切换自动备份
async function toggleAutoBackup() {
  try {
    const result = await chrome.storage.local.get(["autoBackupSettings"]);
    const settings = result.autoBackupSettings || {
      enabled: false,
      frequency: "daily",
      lastBackup: null,
      tagFilter: {
        enabled: false,
        selectedTags: [],
      },
    };

    settings.enabled = !settings.enabled;

    await chrome.storage.local.set({ autoBackupSettings: settings });
    await loadAutoBackupSettings();

    if (settings.enabled) {
      showMessage(langData.messages.autoBackupEnabled);
    } else {
      showMessage(langData.messages.autoBackupDisabled, "error");
    }
  } catch (error) {
    showMessage(langData.messages.settingsFailed, "error");
  }
}

// 更新自动备份频率
async function updateAutoBackupFrequency() {
  try {
    const frequency = document.getElementById("backupFrequency").value;
    const result = await chrome.storage.local.get(["autoBackupSettings"]);
    const settings = result.autoBackupSettings || {};

    settings.frequency = frequency;

    await chrome.storage.local.set({ autoBackupSettings: settings });
    await loadAutoBackupSettings();

    const frequencyText = langData.frequencies[frequency];
    showMessage(`${langData.messages.frequencyUpdated} ${frequencyText}`);
  } catch (error) {
    showMessage(langData.messages.updateFailed, "error");
  }
}

// 测试自动备份
async function testAutoBackup() {
  const button = document.getElementById("testAutoBackup");
  const originalText = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `<span>⏳</span> ${langData.buttons.testing}`;

  try {
    // 检查 WebDAV 配置
    const configResult = await chrome.storage.local.get(["webdavConfig"]);
    let config = configResult.webdavConfig;

    if (!config || !config.url) {
      throw new Error(langData.messages.configureWebdavFirst);
    }

    // 触发自动备份
    await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "triggerAutoBackup" }, resolve);
    });

    showMessage(langData.messages.autoBackupTriggered);
  } catch (error) {
    showMessage(`${langData.messages.testFailed} + ${error.message}`, "error");
  } finally {
    button.disabled = false;
    button.innerHTML = originalText;
  }
}

// 显示备份对话框
function showBackupDialog() {
  const existingDialog = document.querySelector(".backup-dialog");
  if (existingDialog) {
    existingDialog.remove();
  }

  getCurrentLangData()
    .then(async () => {
      const dialog = document.createElement("div");
      dialog.className = "backup-dialog";

      // 加载标签数据
      const tagResult = await chrome.storage.local.get(["noteTags"]);
      const availableTags = tagResult.noteTags || {};

      dialog.innerHTML = `
        <div class="backup-dialog-content">
          <div class="backup-dialog-header">
            <h3>🌐 ${langData.backupOptions}</h3>
            <button class="twitter-notes-close">×</button>
          </div>
          <div class="backup-dialog-body">
            <div class="backup-options">
              <div class="option-group">
                <label>
                  <input type="radio" name="backupType" value="all" checked>
                  ${langData.backupAll}
                </label>
              </div>
              <div class="option-group">
                <label>
                  <input type="radio" name="backupType" value="tags">
                  ${langData.backupByTags}
                </label>
              </div>
            </div>
            <div id="backupTagSelection" class="tag-selection hidden">
              <h4>${langData.selectTagsToBackup}</h4>
              <div class="tag-checkboxes">
                ${Object.entries(availableTags)
                  .map(
                    ([tagId, tag]) => `
                  <div class="tag-checkbox">
                    <input type="checkbox" id="backupTag_${tagId}" value="${tagId}">
                    <label for="backupTag_${tagId}">
                      <span class="tag-color-indicator" style="background-color: ${tag.color}"></span>
                      ${tag.name}
                    </label>
                  </div>
                `
                  )
                  .join("")}
              </div>
            </div>
          </div>
          <div class="backup-dialog-footer">
            <button class="deleteTagBtn" id="cancelBackup">
              ${langData.exportCancel}
            </button>
            <button class="saveTagBtn" id="confirmBackup">
              ${langData.backupSelectedTags}
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(dialog);

      const closeBtn = dialog.querySelector(".twitter-notes-close");
      const cancelBtn = dialog.querySelector("#cancelBackup");
      const confirmBtn = dialog.querySelector("#confirmBackup");
      const radioButtons = dialog.querySelectorAll('input[name="backupType"]');
      const tagSelection = dialog.querySelector("#backupTagSelection");

      const closeDialog = () => dialog.remove();
      closeBtn.addEventListener("click", closeDialog);
      cancelBtn.addEventListener("click", closeDialog);
      dialog.addEventListener("click", (e) => {
        if (e.target === dialog) closeDialog();
      });

      // 切换备份类型
      radioButtons.forEach((radio) => {
        radio.addEventListener("change", () => {
          if (radio.value === "tags") {
            tagSelection.classList.remove("hidden");
          } else {
            tagSelection.classList.add("hidden");
          }
        });
      });

      // 确认备份
      confirmBtn.addEventListener("click", async () => {
        const backupType = dialog.querySelector(
          'input[name="backupType"]:checked'
        ).value;

        if (backupType === "all") {
          closeDialog();
          await backupToWebDAV();
        } else {
          // 按标签备份
          const selectedTags = [];
          dialog
            .querySelectorAll(
              '#backupTagSelection input[type="checkbox"]:checked'
            )
            .forEach((checkbox) => {
              selectedTags.push(checkbox.value);
            });

          if (selectedTags.length === 0) {
            alert(langData.noTagsSelected);
            return;
          }

          closeDialog();
          await backupToWebDAVByTags(selectedTags);
        }
      });
    })
    .catch((e) => {
      console.error("加载语言数据失败:", e);
    });
}

// WebDAV 手动备份
async function backupToWebDAV() {
  const button = document.getElementById("webdavBackup");
  button.disabled = true;
  button.innerHTML = `<span>⏳</span> ${langData.buttons.backing}`;

  try {
    const configResult = await chrome.storage.local.get(["webdavConfig"]);
    let config = configResult.webdavConfig;

    if (!config || !config.url) {
      throw new Error(langData.messages.configureWebdavFirst);
    }

    // 解密配置
    if (config.encrypted) {
      config = await cryptoUtils.decryptWebDAVConfig(config);
    }

    // 获取备注和标签数据
    const result = await chrome.storage.local.get([
      "twitterNotes",
      "noteTags",
      "noteTagsOrder",
    ]);
    const notes = result.twitterNotes || {};
    const tags = result.noteTags || {};
    const order = result.noteTagsOrder || [];

    const manifest = chrome.runtime.getManifest();
    const exportData = {
      version: manifest.version,
      exportTime: new Date().toISOString(),
      notes: notes,
      tags: tags,
      noteTagsOrder: order,
    };

    const fileName = `XMark-backup-${
      new Date().toISOString().split("T")[0]
    }.json`;
    const fileContent = JSON.stringify(exportData, null, 2);

    // 构建 WebDAV URL
    const webdavUrl = config.url.endsWith("/")
      ? config.url + "Xmark/Backup/" + fileName
      : config.url + "/Xmark/Backup/" + fileName;

    // 准备认证头
    const headers = {
      "Content-Type": "application/json",
    };

    if (config.username && config.password) {
      headers["Authorization"] =
        "Basic " + btoa(config.username + ":" + config.password);
    }

    // 通过 background script 发送请求以绕过 CORS
    const uploadResult = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          action: "webdavRequest",
          url: webdavUrl,
          method: "PUT",
          headers: headers,
          body: fileContent,
        },
        resolve
      );
    });

    if (!uploadResult.success) {
      throw new Error(uploadResult.error);
    }

    if (!uploadResult.response.ok) {
      throw new Error(
        `WebDAV 上传失败: ${uploadResult.response.status} ${uploadResult.response.statusText}`
      );
    }

    showMessage(langData.messages.webdavBackupSuccess);
  } catch (error) {
    showMessage(
      `${langData.messages.webdavBackupFailed} + ${error.message}`,
      "error"
    );
  } finally {
    button.disabled = false;
    button.innerHTML = `<span>${langData.manualBackup}</span>`;
  }
}

// WebDAV 恢复
async function restoreFromWebDAV() {
  const button = document.getElementById("webdavRestore");
  button.disabled = true;
  button.innerHTML = `<span>⏳</span> ${langData.buttons.restoring}`;

  try {
    const configResult = await chrome.storage.local.get(["webdavConfig"]);
    let config = configResult.webdavConfig;

    if (!config || !config.url) {
      throw new Error(langData.messages.configureWebdavFirst);
    }

    // 解密配置
    if (config.encrypted) {
      config = await cryptoUtils.decryptWebDAVConfig(config);
    }

    // 获取所有备份文件列表
    console.log("正在查找最新的备份文件...");
    const backupFiles = await getWebDAVBackupList(config);

    if (backupFiles.length === 0) {
      throw new Error("服务器上没有找到任何备份文件");
    }

    // 按修改时间排序，获取最新的备份文件
    const latestBackup = backupFiles.sort((a, b) => {
      const dateA = new Date(a.lastModified);
      const dateB = new Date(b.lastModified);
      return dateB - dateA;
    })[0];

    const webdavUrl = config.url.endsWith("/")
      ? config.url + "Xmark/Backup/" + latestBackup.name
      : config.url + "/Xmark/Backup/" + latestBackup.name;

    // 准备认证头
    const headers = {};
    if (config.username && config.password) {
      headers["Authorization"] =
        "Basic " + btoa(config.username + ":" + config.password);
    }

    // 通过 background script 发送请求以绕过 CORS
    const downloadResult = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          action: "webdavRequest",
          url: webdavUrl,
          method: "GET",
          headers: headers,
        },
        resolve
      );
    });

    if (!downloadResult.success) {
      throw new Error(downloadResult.error);
    }

    if (!downloadResult.response.ok) {
      if (downloadResult.response.status === 404) {
        throw new Error(langData.messages.noBackupToday);
      }
      throw new Error(
        `${langData.messages.WebDAVDownloadFailed}: ${downloadResult.response.status} ${downloadResult.response.statusText}`
      );
    }

    const fileContent = downloadResult.response.text;
    const importData = JSON.parse(fileContent);

    if (!importData.notes) {
      throw new Error(langData.messages.missingNotesData);
    }

    await processImportedNotes(importData);

    showMessage(langData.messages.webdavRestoreSuccess);
  } catch (error) {
    showMessage(
      `${langData.messages.webdavRestoreFailed} + ${error.message}`,
      "error"
    );
  } finally {
    button.disabled = false;
    button.innerHTML = `<span>${langData.restoreData}</span>`;
  }
}

// 从特定备份恢复
async function restoreFromSpecificBackup(fileName) {
  const button = document.getElementById("viewBackupList");
  const originalText = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `<span>⏳</span> ${langData.buttons.restoring}`;

  try {
    const configResult = await chrome.storage.local.get(["webdavConfig"]);
    let config = configResult.webdavConfig;

    if (!config || !config.url) {
      throw new Error(langData.messages.configureWebdavFirst);
    }

    // 解密配置
    if (config.encrypted) {
      config = await cryptoUtils.decryptWebDAVConfig(config);
    }

    const webdavUrl = config.url.endsWith("/")
      ? config.url + "Xmark/Backup/" + fileName
      : config.url + "/Xmark/Backup/" + fileName;

    const headers = {};
    if (config.username && config.password) {
      headers["Authorization"] =
        "Basic " + btoa(config.username + ":" + config.password);
    }

    const downloadResult = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          action: "webdavRequest",
          url: webdavUrl,
          method: "GET",
          headers: headers,
        },
        resolve
      );
    });

    if (!downloadResult.success) {
      throw new Error(downloadResult.error);
    }

    if (!downloadResult.response.ok) {
      throw new Error(
        `${langData.messages.WebDAVDownloadFailed}: ${downloadResult.response.status} ${downloadResult.response.statusText}`
      );
    }

    const fileContent = downloadResult.response.text;

    if (!fileContent) {
      throw new Error(langData.messages.emptyBackupFile);
    }

    let importData;
    try {
      importData = JSON.parse(fileContent);
    } catch (parseError) {
      throw new Error(langData.messages.invalidBackupFormat);
    }

    if (!importData.notes) {
      throw new Error(langData.messages.missingNotesData);
    }

    // 询问用户是否要覆盖现有数据
    const shouldMerge = confirm(
      `${langData.messages.restoreFromBackup} ${
        Object.keys(importData.notes).length
      } ${langData.messages.restoreFromBackup2}`
    );

    if (!shouldMerge) {
      showMessage(langData.messages.restoreCancelled, "error");
      return;
    }

    await processImportedNotes(importData);

    showMessage(langData.messages.restoreSuccess);
  } catch (error) {
    showMessage(
      `${langData.messages.restoreFailed} + ${error.message}`,
      "error"
    );
  } finally {
    button.disabled = false;
    button.innerHTML = originalText;
  }
}

// 按标签备份到WebDAV
async function backupToWebDAVByTags(selectedTagIds) {
  const button = document.getElementById("webdavBackup");
  button.disabled = true;
  button.innerHTML = `<span>⏳</span> ${langData.buttons.backing}`;

  try {
    const configResult = await chrome.storage.local.get(["webdavConfig"]);
    let config = configResult.webdavConfig;

    if (!config || !config.url) {
      throw new Error(langData.messages.configureWebdavFirst);
    }

    // 如果配置是加密的，先解密
    if (config.encrypted) {
      config = await cryptoUtils.decryptWebDAVConfig(config);
    }

    // 获取备注和标签数据
    const result = await chrome.storage.local.get(["twitterNotes", "noteTags"]);
    const allNotes = result.twitterNotes || {};
    const allTags = result.noteTags || {};

    // 筛选指定标签的备注
    const filteredNotes = filterNotesByTags(allNotes, selectedTagIds);

    if (Object.keys(filteredNotes).length === 0) {
      throw new Error(langData.messages.noNotesWithSelectedTags);
    }

    // 筛选相关的标签
    const filteredTags = {};
    selectedTagIds.forEach((tagId) => {
      if (allTags[tagId]) {
        filteredTags[tagId] = allTags[tagId];
      }
    });

    const manifest = chrome.runtime.getManifest();
    const exportData = {
      version: manifest.version,
      exportTime: new Date().toISOString(),
      notes: filteredNotes,
      tags: filteredTags,
      backupType: "tags",
      selectedTags: selectedTagIds,
    };

    const fileName = `XMark-tags-backup-${
      new Date().toISOString().split("T")[0]
    }.json`;
    const fileContent = JSON.stringify(exportData, null, 2);

    // 构建 WebDAV URL
    const webdavUrl = config.url.endsWith("/")
      ? config.url + "Xmark/Backup/" + fileName
      : config.url + "/Xmark/Backup/" + fileName;

    // 准备认证头
    const headers = {
      "Content-Type": "application/json",
    };

    if (config.username && config.password) {
      headers["Authorization"] =
        "Basic " + btoa(config.username + ":" + config.password);
    }

    // 通过 background script 发送请求以绕过 CORS
    const uploadResult = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          action: "webdavRequest",
          url: webdavUrl,
          method: "PUT",
          headers: headers,
          body: fileContent,
        },
        resolve
      );
    });

    if (!uploadResult.success) {
      throw new Error(uploadResult.error);
    }

    if (!uploadResult.response.ok) {
      throw new Error(
        `WebDAV 上传失败: ${uploadResult.response.status} ${uploadResult.response.statusText}`
      );
    }

    showMessage(
      `${langData.messages.backupTaggedNotes} ${
        Object.keys(filteredNotes).length
      } ${langData.notes}`
    );
  } catch (error) {
    showMessage(
      `${langData.messages.webdavBackupFailed} + ${error.message}`,
      "error"
    );
  } finally {
    button.disabled = false;
    button.innerHTML = `<span>🌐</span> ${langData.manualBackup}`;
  }
}

// 显示备份列表
async function showBackupList() {
  const button = document.getElementById("viewBackupList");
  const originalText = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `<span>⏳</span> ${langData.buttons.loading}`;

  try {
    const configResult = await chrome.storage.local.get(["webdavConfig"]);
    let config = configResult.webdavConfig;

    if (!config || !config.url) {
      throw new Error(langData.messages.configureWebdavFirst);
    }

    // 解密配置
    if (config.encrypted) {
      config = await cryptoUtils.decryptWebDAVConfig(config);
    }

    // 创建备份列表对话框
    const dialog = document.createElement("div");
    dialog.className = "backup-list-dialog";
    dialog.innerHTML = `
      <div class="backup-list-content">
        <div class="backup-list-header">
          <h3>📋 ${langData.dialog.webdavBackupList}</h3>
          <button class="twitter-notes-close">×</button>
        </div>
        <div class="backup-list-body">
          <div class="backup-loading">
            <span>⏳</span> ${langData.dialog.loading}
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    const closeBtn = dialog.querySelector(".twitter-notes-close");
    const bodyDiv = dialog.querySelector(".backup-list-body");

    const closeDialog = () => dialog.remove();
    closeBtn.addEventListener("click", closeDialog);
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) closeDialog();
    });

    // 获取备份文件列表
    const backupFiles = await getWebDAVBackupList(config);

    if (backupFiles.length === 0) {
      bodyDiv.innerHTML = `
        <div class="backup-empty">
          <span>📁</span><br>
          ${langData.dialog.noBackupFiles}<br>
          <small style="color: #999; margin-top: 8px; display: block;">
            ${langData.dialog.searchPattern}
          </small>
        </div>
      `;
    } else {
      bodyDiv.innerHTML = backupFiles
        .map(
          (file) => `
        <div class="backup-item">
          <div class="backup-info">
            <div class="backup-name">${file.name}</div>
            <div class="backup-details">
              ${langData.dialog.size}: ${file.size} | ${
            langData.dialog.modifiedTime
          }: ${file.lastModified}
              ${
                file.notesCount
                  ? ` | ${langData.dialog.notesCount}: ${file.notesCount}`
                  : ""
              }
            </div>
          </div>
          <div class="backup-actions">
            <button class="backup-btn backup-btn-restore" data-filename="${
              file.name
            }">
              ${langData.dialog.restore}
            </button>
            <button class="backup-btn backup-btn-delete" data-filename="${
              file.name
            }">
              ${langData.dialog.delete}
            </button>
          </div>
        </div>
      `
        )
        .join("");

      // 为每个按钮添加事件监听器
      const restoreButtons = bodyDiv.querySelectorAll(".backup-btn-restore");
      const deleteButtons = bodyDiv.querySelectorAll(".backup-btn-delete");

      restoreButtons.forEach((button) => {
        button.addEventListener("click", async (e) => {
          const fileName = e.target.getAttribute("data-filename");
          closeDialog();
          await restoreFromSpecificBackup(fileName);
        });
      });

      deleteButtons.forEach((button) => {
        button.addEventListener("click", async (e) => {
          const fileName = e.target.getAttribute("data-filename");
          if (
            confirm(`${langData.messages.confirmDeleteBackup} : ${fileName}`)
          ) {
            closeDialog();
            await deleteBackupFile(fileName);
          }
        });
      });
    }
  } catch (error) {
    showMessage(
      `${langData.messages.loadBackupListFailed} + ${error.message}`,
      "error"
    );
  } finally {
    button.disabled = false;
    button.innerHTML = originalText;
  }
}

// 获取 WebDAV 备份文件列表（只使用文件名模式匹配）
async function getWebDAVBackupList(config) {
  console.log("开始获取 WebDAV 备份列表（使用文件名模式匹配）...");

  // 构造请求头
  const headers = {};
  if (config.username && config.password) {
    headers["Authorization"] =
      "Basic " + btoa(config.username + ":" + config.password);
  }
  headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
  headers["Pragma"] = "no-cache";
  headers["Expires"] = "0";

  // 调用 tryCommonFilePatterns 获取所有 XMark-*.json 文件
  const backupFiles = await tryCommonFilePatterns(config, headers);

  if (backupFiles.length === 0) {
    console.warn("未找到任何备份文件！");
    return [];
  }

  // 按 lastModified 排序（最新的在前面）
  backupFiles.sort((a, b) => {
    const dateA = new Date(a.lastModified).getTime();
    const dateB = new Date(b.lastModified).getTime();
    return dateB - dateA; // 最新的在前
  });

  console.log(`找到 ${backupFiles.length} 个备份文件，按最新排序完成`);
  return backupFiles;
}

// 测试文件是否存在
async function testFileExists(config, headers, fileName) {
  try {
    const fileUrl = config.url.endsWith("/")
      ? config.url + "Xmark/Backup/" + fileName
      : config.url + "/Xmark/Backup/" + fileName;

    // 添加时间戳和缓存控制头
    const urlWithTimestamp = fileUrl + "?t=" + Date.now();
    const headersWithCache = {
      ...headers,
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: Expires,
    };

    const result = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          action: "webdavRequest",
          url: urlWithTimestamp,
          method: "HEAD", // 使用 HEAD 方法只获取头信息
          headers: headersWithCache,
        },
        resolve
      );
    });

    if (result.success && result.response.ok) {
      const contentLength = result.response.headers["content-length"];
      const lastModified = result.response.headers["last-modified"];

      return {
        name: fileName,
        href: fileName,
        size: formatSize(Number.parseInt(contentLength)),
        lastModified: formatDate(lastModified),
        rawSize: Number.parseInt(contentLength) || 0,
      };
    }
  } catch (error) {
    // 忽略错误，文件不存在
  }

  return null;
}

// 尝试匹配常见的文件名模式（只匹配 XMark-*.json）
async function tryCommonFilePatterns(config, headers) {
  console.log("尝试使用通用文件名模式...");
  const backupFiles = [];

  const patterns = [];
  const now = new Date();

    // 最近30天的日期
  for (let i = 0; i < 30; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split("T")[0];

    patterns.push(`XMark-backup-${dateStr}.json`);
    patterns.push(`XMark-auto-backup-${dateStr}.json`);
    patterns.push(`XMark-tags-backup-${dateStr}.json`);
    patterns.push(`XMark-${dateStr}.json`);
  }

  // 最近3天按小时（按本地时间）
  for (let i = 0; i < 3; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);

    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const day = date.getDate().toString().padStart(2, "0");

    const dateStr = `${year}-${month}-${day}`;
    // 小时备份模式（每天 24 小时）
    for (let hour = 0; hour < 24; hour++) {
      const hourStr = hour.toString().padStart(2, "0");
      patterns.push(`XMark-hourly-${dateStr}-${hourStr}.json`);
    }
  }

  // 兜底几个常见文件名
  patterns.push("XMark.json");
  patterns.push("XMark-backup.json");

  console.log(`生成了 ${patterns.length} 个可能的文件名`);

  // 并发测试文件是否存在（限制 batch）
  const batchSize = 5;
  for (let i = 0; i < patterns.length; i += batchSize) {
    const batch = patterns.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map((fileName) => testFileExists(config, headers, fileName))
    );

    results.forEach((result, index) => {
      if (result) {
        console.log(`找到文件: ${batch[index]}`);
        backupFiles.push(result);
      }
    });
  }

  console.log(`模式匹配完成，找到 ${backupFiles.length} 个备份文件`);
  return backupFiles;
}

// 格式化文件大小
function formatSize(bytes) {
  if (!bytes || bytes === 0) return "未知";
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + " " + sizes[i];
}

// 格式化修改时间
function formatDate(dateString) {
  if (!dateString) return "未知";
  try {
    return new Date(dateString).toLocaleString("zh-CN");
  } catch {
    return dateString;
  }
}

// 删除备份文件
async function deleteBackupFile(fileName) {
  try {
    const configResult = await chrome.storage.local.get(["webdavConfig"]);
    let config = configResult.webdavConfig;

    if (!config || !config.url) {
      throw new Error(langData.messages.configureWebdavFirst);
    }

    // 解密配置
    if (config.encrypted) {
      config = await cryptoUtils.decryptWebDAVConfig(config);
    }

    const webdavUrl = config.url.endsWith("/")
      ? config.url + fileName
      : config.url + "/" + fileName;

    const headers = {};
    if (config.username && config.password) {
      headers["Authorization"] =
        "Basic " + btoa(config.username + ":" + config.password);
    }

    const deleteResult = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          action: "webdavRequest",
          url: webdavUrl,
          method: "DELETE",
          headers: headers,
        },
        resolve
      );
    });

    if (!deleteResult.success) {
      throw new Error(deleteResult.error);
    }

    if (!deleteResult.response.ok) {
      throw new Error(
        `删除备份失败: ${deleteResult.response.status} ${deleteResult.response.statusText}`
      );
    }

    showMessage(`${langData.messages.backupDeleted} : ${fileName}`);
  } catch (error) {
    showMessage(
      `${langData.messages.deleteFailed} + ${error.message}`,
      "error"
    );
  }
}

/* ==========================标签模块========================== */
// 添加标签面板
function showAddTagDialog() {
  const existingDialog = document.querySelector(".tag-dialog");
  if (existingDialog) {
    existingDialog.remove();
  }

  getCurrentLangData()
    .then(() => {
      const dialog = document.createElement("div");
      dialog.className = "tag-dialog";

      dialog.innerHTML = `
        <div class="tag-dialog-content">
          <div class="tag-dialog-header">
            <h3>🏷️ ${langData.addTag}</h3>
            <button class="twitter-notes-close">×</button>
          </div>
          <div class="tag-dialog-body">
            <div class="input-group">
              <label for="tagName">${langData.tagName}</label>
              <input 
                type="text"
                id="tagName"
                class="twitter-notes-input" 
                placeholder="${langData.tagNamePlaceholder}"
                maxlength="20"
              />
            </div>
            <div class="input-group">
              <label>${langData.tagColor}</label>
              <div class="color-picker-grid">
                ${colors
                  .map(
                    (color, index) => `
                  <div class="color-option ${index === 0 ? "selected" : ""}" 
                       style="background-color: ${color}" 
                       data-color="${color}"></div>
                `
                  )
                  .join("")}
              </div>
            </div>
          </div>
          <div class="tag-dialog-footer">
            <button class="saveTagBtn" id="saveTag">
              ${langData.saveTag}
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(dialog);

      const nameInput = dialog.querySelector("#tagName");
      const colorOptions = dialog.querySelectorAll(".color-option");
      const closeBtn = dialog.querySelector(".twitter-notes-close");
      const saveBtn = dialog.querySelector("#saveTag");

      let selectedColor = colors[0];

      nameInput.focus();

      // 颜色选择
      colorOptions.forEach((option) => {
        option.addEventListener("click", () => {
          colorOptions.forEach((opt) => opt.classList.remove("selected"));
          option.classList.add("selected");
          selectedColor = option.getAttribute("data-color");
        });
      });

      const closeDialog = () => dialog.remove();
      closeBtn.addEventListener("click", closeDialog);
      dialog.addEventListener("click", (e) => {
        if (e.target === dialog) closeDialog();
      });

      saveBtn.addEventListener("click", async () => {
        const tagName = nameInput.value.trim();

        if (!tagName) {
          alert(langData.tagNameRequired);
          nameInput.focus();
          return;
        }

        // 检查标签名是否已存在
        const result = await chrome.storage.local.get([
          "noteTags",
          "noteTagsOrder",
        ]);
        const existingTags = result.noteTags || {};
        const order = result.noteTagsOrder || [];

        const tagExists = Object.values(existingTags).some(
          (tag) => tag.name === tagName
        );
        if (tagExists) {
          alert(langData.tagExists);
          nameInput.focus();
          return;
        }

        const tagId = Date.now().toString();
        const newTag = {
          id: tagId,
          name: tagName,
          color: selectedColor,
          createdAt: new Date().toISOString(),
        };

        // 更新标签 & 顺序
        existingTags[tagId] = newTag;
        order.push(tagId);

        await chrome.storage.local.set({
          noteTags: existingTags,
          noteTagsOrder: order,
        });

        await loadTags();
        await loadAutoBackupSettings(); // 重新加载自动备份设置以更新标签选项

        try {
          const [tab] = await chrome.tabs.query({
            active: true,
            currentWindow: true,
          });
          await new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(
              tab.id,
              { action: "initGroups" },
              (resp) => {
                if (chrome.runtime.lastError)
                  return reject(chrome.runtime.lastError);
                resolve(resp);
              }
            );
          });
        } catch (err) {
          console.error("刷新页面标签失败：", err);
        }

        closeDialog();
        showMessage(`${tagName} ${langData.messages.tagCreated}`);
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

// 在标签面板后添加编辑标签功能
function showEditTagDialog(tagId) {
  const existingDialog = document.querySelector(".tag-dialog");
  if (existingDialog) {
    existingDialog.remove();
  }

  getCurrentLangData()
    .then(async () => {
      // 获取标签数据
      const result = await chrome.storage.local.get(["noteTags"]);
      const tags = result.noteTags || {};
      const tag = tags[tagId];

      if (!tag) {
        showMessage("标签不存在", "error");
        return;
      }

      const dialog = document.createElement("div");
      dialog.className = "tag-dialog";

      dialog.innerHTML = `
        <div class="tag-dialog-content">
          <div class="tag-dialog-header">
            <h3>🏷️ ${langData.editTag}</h3>
            <button class="twitter-notes-close">×</button>
          </div>
          <div class="tag-dialog-body">
            <div class="input-group">
              <label for="tagName">${langData.tagName}</label>
              <input 
                type="text"
                id="tagName"
                class="twitter-notes-input" 
                placeholder="${langData.tagNamePlaceholder}"
                maxlength="20"
                value="${tag.name}"
              />
            </div>
            <div class="input-group">
              <label>${langData.tagColor}</label>
              <div class="color-picker-grid">
                ${colors
                  .map(
                    (color) => `
                  <div class="color-option ${
                    color === tag.color ? "selected" : ""
                  }" 
                       style="background-color: ${color}" 
                       data-color="${color}"></div>
                `
                  )
                  .join("")}
              </div>
            </div>
          </div>
          <div class="tag-dialog-footer">
            <button class="deleteTagBtn" id="deleteTag">
              ${langData.deleteTag}
            </button>
            <button class="saveTagBtn" id="saveTag">
              ${langData.saveTag}
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(dialog);

      const nameInput = dialog.querySelector("#tagName");
      const colorOptions = dialog.querySelectorAll(".color-option");
      const closeBtn = dialog.querySelector(".twitter-notes-close");
      const saveBtn = dialog.querySelector("#saveTag");
      const deleteBtn = dialog.querySelector("#deleteTag");

      let selectedColor = tag.color;

      nameInput.focus();

      // 颜色选择
      colorOptions.forEach((option) => {
        option.addEventListener("click", () => {
          colorOptions.forEach((opt) => opt.classList.remove("selected"));
          option.classList.add("selected");
          selectedColor = option.getAttribute("data-color");
        });
      });

      const closeDialog = () => dialog.remove();
      closeBtn.addEventListener("click", closeDialog);
      dialog.addEventListener("click", (e) => {
        if (e.target === dialog) closeDialog();
      });

      // 保存标签
      saveBtn.addEventListener("click", async () => {
        const tagName = nameInput.value.trim();

        if (!tagName) {
          alert(langData.tagNameRequired);
          nameInput.focus();
          return;
        }

        // 检查标签名是否已存在（排除当前标签）
        const result = await chrome.storage.local.get(["noteTags"]);
        const existingTags = result.noteTags || {};

        const tagExists = Object.entries(existingTags).some(
          ([id, existingTag]) => id !== tagId && existingTag.name === tagName
        );
        if (tagExists) {
          alert(langData.tagExists);
          nameInput.focus();
          return;
        }

        // 更新标签
        existingTags[tagId] = {
          ...tag,
          name: tagName,
          color: selectedColor,
          updatedAt: new Date().toISOString(),
        };

        await chrome.storage.local.set({ noteTags: existingTags });
        await loadTags();
        await loadAutoBackupSettings(); // 重新加载自动备份设置以更新标签选项
        closeDialog();
        showMessage(`${tagName} ${langData.messages.tagUpdated}`);
      });

      // 删除标签
      deleteBtn.addEventListener("click", async () => {
        if (!confirm(langData.confirmDeleteTag)) {
          return;
        }

        try {
          const result = await chrome.storage.local.get([
            "noteTags",
            "noteTagsOrder",
          ]);
          const tags = result.noteTags || {};
          let order = result.noteTagsOrder || [];

          const tagName = tags[tagId]?.name;
          delete tags[tagId];

          // 从顺序中移除
          order = order.filter((id) => id !== tagId);

          await chrome.storage.local.set({
            noteTags: tags,
            noteTagsOrder: order,
          });
          await loadTags();
          await loadAutoBackupSettings(); // 重新加载自动备份设置以更新标签选项

          try {
            const [tab] = await chrome.tabs.query({
              active: true,
              currentWindow: true,
            });
            await new Promise((resolve, reject) => {
              chrome.tabs.sendMessage(
                tab.id,
                { action: "initGroups" },
                (resp) => {
                  if (chrome.runtime.lastError)
                    return reject(chrome.runtime.lastError);
                  resolve(resp);
                }
              );
            });
          } catch (err) {
            console.error("刷新页面标签失败：", err);
          }

          closeDialog();

          showMessage(`${tagName} ${langData.messages.tagDeleted}`);
        } catch (error) {
          showMessage(langData.messages.tagDeletedFailed, "error");
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

// loadTags 函数，添加编辑功能，拖拽排序 + 持久化顺序（原生实现）
async function loadTags() {
  try {
    const { noteTags = {}, noteTagsOrder = [] } =
      await chrome.storage.local.get(["noteTags", "noteTagsOrder"]);

    const tagList = document.getElementById("tagList");

    // 计算用于渲染的顺序：优先用持久化顺序，过滤掉已删除的 id；没有则退回当前对象键
    const order = (
      noteTagsOrder.length ? noteTagsOrder : Object.keys(noteTags)
    ).filter((id) => noteTags[id]);

    if (order.length === 0) {
      tagList.innerHTML = `<div style="color:#536471;font-size:12px;text-align:center;padding:10px;">暂无标签</div>`;
      return;
    }

    // 渲染（按顺序数组）
    tagList.innerHTML = order
      .map((id) => {
        const tag = noteTags[id];
        return `
          <div class="tag-item"
               draggable="true"
               data-id="${id}"
               style="background-color:${
                 tag.color
               };display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:10px;margin:6px 0;cursor:grab;">
            <span style="flex:1;user-select:none;">${escapeHtml(
              tag.name
            )}</span>
            <button class="tag-edit" data-id="${id}" title="编辑" style="border:none;background:transparent;cursor:pointer;">✏️</button>
          </div>
        `;
      })
      .join("");

    // 绑定原生拖拽事件（委托到容器，省心）
    initDragAndDrop(tagList);
  } catch (error) {
    console.error("加载标签失败:", error);
  }
}

// 简单的转义，避免名字里有 < > & 之类导致布局异常
function escapeHtml(str = "") {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// 标签拖拽
function initDragAndDrop(tagList) {
  let dragEl = null;

  tagList.addEventListener("dragstart", (e) => {
    const item = e.target.closest(".tag-item");
    if (!item) return;
    dragEl = item;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", item.dataset.id);
    // 小延迟避免被浏览器默认拖拽样式遮挡
    requestAnimationFrame(() => item.classList.add("dragging"));
  });

  tagList.addEventListener("dragover", (e) => {
    e.preventDefault(); // 必须阻止默认，drop 才会触发
    const overItem = e.target.closest(".tag-item");
    if (!dragEl || !overItem || overItem === dragEl) return;

    const rect = overItem.getBoundingClientRect();
    const after = e.clientY - rect.top > rect.height / 2;
    tagList.insertBefore(dragEl, after ? overItem.nextSibling : overItem);
  });

  tagList.addEventListener("drop", async (e) => {
    e.preventDefault();
    await persistOrder(tagList);
  });

  tagList.addEventListener("dragend", async () => {
    if (dragEl) dragEl.classList.remove("dragging");
    await persistOrder(tagList);
    dragEl = null;
  });
}

// 保存标签顺序
async function persistOrder(tagList) {
  // 仅保存顺序数组，不再依赖对象键顺序
  const newOrder = [...tagList.querySelectorAll(".tag-item")].map(
    (el) => el.dataset.id
  );
  const { noteTags = {} } = await chrome.storage.local.get(["noteTags"]);

  // 过滤掉已被删除的 id（以防万一）
  const filtered = newOrder.filter((id) => noteTags[id]);

  await chrome.storage.local.set({ noteTagsOrder: filtered });

  await loadTags();
  await loadAutoBackupSettings(); // 重新加载自动备份设置以更新标签选项
}

// 控制页面标签显示
async function TagGroups() {
  const toggle = document.getElementById("toggle-groups");

  // 1️⃣ 初始化状态并设置样式
  const res = await new Promise((resolve) => {
    chrome.storage.local.get({ tagGroupsVisible: true }, resolve);
  });

  if (res.tagGroupsVisible) {
    toggle.classList.add("active");
  } else {
    toggle.classList.remove("active");
  }

  // 2️⃣ 点击切换状态
  toggle.addEventListener("click", async () => {
    // 3️⃣ 在当前 tab 执行显示/隐藏逻辑
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (
      !tab.url.startsWith("https://x.com") &&
      !tab.url.startsWith("https://twitter.com")
    ) {
      alert("请在 Twitter/X 页面使用该功能");
      return;
    }

    const isActive = toggle.classList.toggle("active"); // 切换样式
    chrome.storage.local.set({ tagGroupsVisible: isActive });

    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (visible) => {
        const wrapper = document.querySelector("[data-groups-nav]");
        if (wrapper) {
          wrapper.style.display = visible ? "flex" : "none";
        } else {
          chrome.runtime.sendMessage({ action: "initGroups" }, (resp) => {
            chrome.storage.local.get(
              ["twitterGroupsVisible"],
              ({ twitterGroupsVisible }) => {
                const w = document.querySelector("[data-groups-nav]");
                if (w && !twitterGroupsVisible) w.style.display = "none";
              }
            );
          });
        }
      },
      args: [isActive],
    });

    showMessage(
      isActive ? langData.messages.TagGroupsOn : langData.messages.TagGroupsOff,
      isActive ? "" : "error"
    );
  });
}

/* ==========================消息模块========================== */
function showMessage(messageHTML, type = "success") {
  const messageDiv = document.createElement("div");

  // 样式配置
  const styles = {
    success: {
      background: "mediumseagreen",
      color: "white",
      fontWeight: "normal",
      closeColor: "rebeccapurple",
    },
    error: {
      background: "red",
      color: "white",
      fontWeight: "bold",
      closeColor: "darkblue",
    },
  };

  const { background, color, fontWeight, closeColor } =
    styles[type] || styles.success;

  // 创建消息元素
  messageDiv.innerHTML = messageHTML;
  messageDiv.style.cssText = `
    position: fixed;
    bottom: 10px;
    left: 50%;
    transform: translateX(-50%);
    background: ${background};
    color: ${color};
    padding: 8px 16px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: ${fontWeight};
    z-index: 1000;
    white-space: pre-wrap;
  `;

  // 创建关闭按钮
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "×";
  closeBtn.style.cssText = `
    position: absolute;
    top: 2px;
    right: 2px;
    background: transparent;
    border: none;
    color: ${closeColor};
    font-size: 16px;
    font-weight: bold;
    cursor: pointer;
    line-height: 1;
  `;
  closeBtn.onclick = () => {
    messageDiv.style.display = "none";
  };

  messageDiv.appendChild(closeBtn);
  document.body.appendChild(messageDiv);

  // 自动移除
  setTimeout(() => {
    if (messageDiv.parentNode) {
      document.body.removeChild(messageDiv);
    }
  }, 3000);
}
