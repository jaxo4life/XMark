import { cryptoUtils } from "./crypto-utils.js";

const langBtn = document.getElementById("langBtn");
let currentLang = localStorage.getItem("lang") || "zh";
let langData = {};
const Expires = "0";

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

// 更新页面中所有需要翻译的文本
function updateTexts() {
  // 统计部分标签更新
  document.querySelectorAll("[data-key]").forEach((el) => {
    const key = el.getAttribute("data-key");
    if (langData[key]) {
      el.textContent = langData[key];
    }
  });

  // 按钮和提示特殊更新
  document.getElementById("exportBtn").textContent =
    langData.exportNotes || "Export";
  document.getElementById("importBtn").textContent =
    langData.importNotes || "Import";
  document.getElementById("clearBtn").textContent =
    langData.clearNotes || "Clear";

  // 标签更新
  document.querySelector(".tag-section h4").textContent =
    langData.tagManagement;
  document.getElementById(
    "addTagBtn"
  ).innerHTML = `<span>➕</span> ${langData.addTag}`;

  // WebDAV更新
  document.querySelector(".cloud-section h4").textContent =
    langData.webdavCloudBackup;
  document.querySelector(
    "#webdavConfigHeader h4 span:first-child"
  ).textContent = `⚙️ ${langData.webdavServerConfig}`;

  // 更新表单标签
  document.querySelector(
    'label[for="webdavUrl"]'
  ).textContent = `${langData.serverAddress}:`;
  document.querySelector(
    'label[for="webdavUsername"]'
  ).textContent = `${langData.username}:`;
  document.querySelector(
    'label[for="webdavPassword"]'
  ).textContent = `${langData.password}:`;

  // 更新按钮
  document.getElementById(
    "saveWebdavConfig"
  ).innerHTML = `<span>💾</span> ${langData.saveConfig}`;
  document.getElementById(
    "testWebdavConnection"
  ).innerHTML = `<span>🔗</span> ${langData.testConnection}`;
  document.getElementById(
    "webdavBackup"
  ).innerHTML = `<span>🌐</span> ${langData.manualBackup}`;
  document.getElementById(
    "webdavRestore"
  ).innerHTML = `<span>📥</span> ${langData.restoreData}`;
  document.getElementById(
    "viewBackupList"
  ).innerHTML = `<span>📋</span> ${langData.viewBackupList}`;

  // 更新自动备份部分
  document.querySelector(
    ".auto-backup-title"
  ).textContent = `🕒 ${langData.autoBackup}`;
  document.querySelector(
    'label[for="backupFrequency"]'
  ).textContent = `${langData.backupFrequency}:`;

  // 更新频率选项
  const frequencySelect = document.getElementById("backupFrequency");
  const options = frequencySelect.querySelectorAll("option");
  options[0].textContent = langData.frequencies.hourly;
  options[1].textContent = langData.frequencies.daily;
  options[2].textContent = langData.frequencies.weekly;
  options[3].textContent = langData.frequencies.monthly;

  document.getElementById(
    "testAutoBackup"
  ).innerHTML = `<span>🧪</span> ${langData.test}`;

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

  // 加载最近备注
  await loadRecentNotes();

  // 加载 WebDAV 配置
  await loadWebdavConfig();

  // 加载自动备份设置
  await loadAutoBackupSettings();

  // 加载标签
  await loadTags();

  // 检查配置状态并更新界面
  await updateConfigurationStatus();

  // 绑定其他事件
  document.getElementById("exportBtn").addEventListener("click", exportNotes);
  document.getElementById("importBtn").addEventListener("click", () => {
    document.getElementById("fileInput").click();
  });
  document.getElementById("fileInput").addEventListener("change", importNotes);
  document.getElementById("clearBtn").addEventListener("click", clearAllNotes);

  // WebDAV 备份事件
  document
    .getElementById("webdavBackup")
    .addEventListener("click", backupToWebDAV);
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

// 监听来自 background script 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "autoBackupComplete") {
    if (message.success) {
      showMessage(
        `${langData.messages.autoBackupSuccess} ${message.fileName}`,
        "success"
      );
    } else {
      showErrorMessage(
        `${langData.messages.autoBackupFailed} ${message.error}`,
        "error"
      );
    }
    // 重新加载自动备份状态

    loadAutoBackupSettings();
  }
});

// 切换 WebDAV 配置面板
function toggleWebdavConfigPanel() {
  const panel = document.getElementById("webdavConfigPanel");
  const toggle = document.getElementById("configToggle");

  if (panel.classList.contains("hidden")) {
    panel.classList.remove("hidden");
    toggle.classList.add("expanded");
  } else {
    panel.classList.add("hidden");
    toggle.classList.remove("expanded");
  }
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
    };

    const toggle = document.getElementById("autoBackupToggle");
    const settingsDiv = document.getElementById("autoBackupSettings"); 
    const frequencySelect = document.getElementById("backupFrequency");

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

    // 更新状态显示
    updateAutoBackupStatus(settings);
  } catch (error) {
    console.error("加载自动备份设置失败:", error);
  }
}

// 更新自动备份状态显示
function updateAutoBackupStatus(settings) {
  const statusDiv = document.getElementById("autoBackupStatus");

  if (settings.enabled) {
    statusDiv.classList.add("enabled");

    const frequencyText = langData.frequencies[settings.frequency];
    let statusText = `✅ ${langData.status.autoBackupEnabled} (${frequencyText})`;

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
      statusText += "\n${langData.status.noAutoBackup}";
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
    };

    settings.enabled = !settings.enabled;

    await chrome.storage.local.set({ autoBackupSettings: settings });
    await loadAutoBackupSettings();

    if (settings.enabled) {
      showMessage(langData.messages.autoBackupEnabled, "success");
    } else {
      showMessage(langData.messages.autoBackupDisabled, "info");
    }
  } catch (error) {
    showErrorMessage(langData.messages.settingsFailed, "error");
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
    showMessage(
      `${langData.messages.frequencyUpdated} ${frequencyText}`,
      "success"
    );
  } catch (error) {
    showErrorMessage(langData.messages.updateFailed, "error");
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

    showMessage(langData.messages.autoBackupTriggered, "info");
  } catch (error) {
    showErrorMessage(
      `${langData.messages.testFailed} + ${error.message}`,
      "error"
    );
  } finally {
    button.disabled = false;
    button.innerHTML = originalText;
  }
}

// 处理导入的备注数据
async function processImportedNotes(importedNotes) {
  // 获取现有备注
  const result = await chrome.storage.local.get(["twitterNotes"]);
  const existingNotes = result.twitterNotes || {};

  // 处理导入的备注，确保格式正确
  const processedNotes = {};
  Object.entries(importedNotes).forEach(([userId, note]) => {
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

  // 合并备注（导入的备注会覆盖现有的同用户备注）
  const mergedNotes = { ...existingNotes, ...processedNotes };

  await chrome.storage.local.set({ twitterNotes: mergedNotes });

  // 重新加载数据
  await loadStats();
  await loadRecentNotes();
}

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

async function saveWebdavConfig() {
  const url = document.getElementById("webdavUrl").value.trim();
  const username = document.getElementById("webdavUsername").value.trim();
  const password = document.getElementById("webdavPassword").value.trim();

  if (!url) {
    showErrorMessage(langData.messages.enterServerAddress, "error");
    return;
  }

  if (!username || !password) {
    showErrorMessage(langData.messages.enterCredentials, "error");
    return;
  }

  try {
    // 加密配置
    const encryptedConfig = await cryptoUtils.encryptWebDAVConfig({
      url,
      username,
      password,
    });
    console.log(encryptedConfig);
    await chrome.storage.local.set({ webdavConfig: encryptedConfig });

    // 清除之前的连接状态
    await chrome.storage.local.remove(["webdavConnectionStatus"]);

    showMessage(langData.messages.webdavConfigSaved, "success");
    await updateConfigurationStatusOnly(); // 只更新状态，不改变折叠状态
  } catch (error) {
    showErrorMessage(
      `langData.messages.webdavConfigSaveFailed + ${error.message}`,
      "error"
    );
  }
}

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
      showMessage(langData.messages.webdavTestSuccess, "success");
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
    showErrorMessage(
      `${langData.messages.webdavTestFailed} + ${error.message}`,
      "error"
    );
  } finally {
    button.disabled = false;
    button.innerHTML = originalText;
    await updateConfigurationStatus();
  }
}

async function exportNotes() {
  try {
    const result = await chrome.storage.local.get(["twitterNotes", "noteTags"]);
    const notes = result.twitterNotes || {};
    const tags = result.noteTags || {};

    const manifest = chrome.runtime.getManifest();
    const exportData = {
      version: manifest.version,
      exportTime: new Date().toISOString(),
      notes: notes,
      tags: tags,
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `XMark-${new Date().toISOString().split("T")[0]}.json`;
    a.click();

    URL.revokeObjectURL(url);
    showMessage(langData.exportSuccess, "success");
  } catch (error) {
    showErrorMessage(langData.exportFail, "error");
  }
}

async function importNotes(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const importData = JSON.parse(text);

    if (!importData.notes) {
      throw new Error(langData.invalidFormat);
    }

    // 获取现有备注
    const result = await chrome.storage.local.get(["twitterNotes", "noteTags"]);
    const existingNotes = result.twitterNotes || {};
    const existingTags = result.noteTags || {};

    // 处理导入的备注，确保格式正确
    const processedNotes = {};
    Object.entries(importData.notes).forEach(([userId, note]) => {
      processedNotes[userId] = note;
    });

    // 处理导入的标签
    const processedTags = {};
    if (importData.tags) {
      Object.entries(importData.tags).forEach(([tagId, tag]) => {
        processedTags[tagId] = tag;
      });
    }

    // 合并数据
    const mergedNotes = { ...existingNotes, ...processedNotes };
    const mergedTags = { ...existingTags, ...processedTags };

    await chrome.storage.local.set({
      twitterNotes: mergedNotes,
      noteTags: mergedTags,
    });

    // 重新加载数据
    await loadStats();
    await loadRecentNotes();
    await loadTags();

    const noteCount = Object.keys(processedNotes).length;
    const tagCount = Object.keys(processedTags).length;
    showMessage(
      `${langData.importSuccess} ${noteCount} ${langData.notes}${
        tagCount > 0 ? ` 和 ${tagCount} 个标签` : ""
      }`
    );
  } catch (error) {
    showErrorMessage(langData.importFail);
  }

  // 清空文件输入
  event.target.value = "";
}

// WebDAV 备份
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
    const result = await chrome.storage.local.get(["twitterNotes", "noteTags"]);
    const notes = result.twitterNotes || {};
    const tags = result.noteTags || {};

    const manifest = chrome.runtime.getManifest();
    const exportData = {
      version: manifest.version,
      exportTime: new Date().toISOString(),
      notes: notes,
      tags: tags,
    };

    const fileName = `XMark-backup-${
      new Date().toISOString().split("T")[0]
    }.json`;
    const fileContent = JSON.stringify(exportData, null, 2);

    // 构建 WebDAV URL
    const webdavUrl = config.url.endsWith("/")
      ? config.url + fileName
      : config.url + "/" + fileName;

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

    showMessage(langData.messages.webdavBackupSuccess, "success");
  } catch (error) {
    showErrorMessage(
      `${langData.messages.webdavBackupFailed} + ${error.message}`,
      "error"
    );
  } finally {
    button.disabled = false;
    button.innerHTML = `<span>🌐</span> ${langData.manualBackup}`;
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
      ? config.url + latestBackup.name
      : config.url + "/" + latestBackup.name;

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
        `WebDAV download failed: ${downloadResult.response.status} ${downloadResult.response.statusText}`
      );
    }

    const fileContent = downloadResult.response.text;
    const importData = JSON.parse(fileContent);

    if (!importData.notes) {
      throw new Error(langData.messages.missingNotesData);
    }

    await processImportedNotes(importData.notes);

    // 处理标签数据
    if (importData.tags) {
      const result = await chrome.storage.local.get(["noteTags"]);
      const existingTags = result.noteTags || {};
      const mergedTags = { ...existingTags, ...importData.tags };
      await chrome.storage.local.set({ noteTags: mergedTags });
      await loadTags();
    }

    showMessage(
      `${langData.messages.webdavRestoreSuccess} ${
        Object.keys(importData.notes).length
      } ${langData.messages.webdavRestoreNum}`,
      "success"
    );
  } catch (error) {
    showErrorMessage(
      `${langData.messages.webdavRestoreFailed} + ${error.message}`,
      "error"
    );
  } finally {
    button.disabled = false;
    button.innerHTML = `<span>📥</span> ${langData.restoreData}`;
  }
}

async function clearAllNotes() {
  if (!confirm(langData.confirmClear)) {
    return;
  }

  try {
    await exportNotes();
    await chrome.storage.local.remove(["twitterNotes", "noteTags"]);
    await loadStats();
    await loadRecentNotes();
    await loadTags();

    showMessage(
      '<span style="font-weight:bold; font-size:16px;color:#FFD700;">' +
        langData.allCleared +
        "</span>\n" +
        langData.exportReminder
    );
  } catch (error) {
    showErrorMessage(langData.clearFail);
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
    showErrorMessage(
      `${langData.messages.loadBackupListFailed} + ${error.message}`,
      "error"
    );
  } finally {
    button.disabled = false;
    button.innerHTML = originalText;
  }
}

// 获取 WebDAV 备份文件列表
async function getWebDAVBackupList(config) {
  console.log("开始获取 WebDAV 备份列表...");
  const headers = {};
  if (config.username && config.password) {
    headers["Authorization"] =
      "Basic " + btoa(config.username + ":" + config.password);
  }

  // 添加缓存控制头，确保获取最新数据
  headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
  headers["Pragma"] = "no-cache";
  headers["Expires"] = Expires;

  // 方法1: 尝试使用 PROPFIND
  try {
    console.log("尝试使用 PROPFIND 方法...");
    const propfindBody = `<?xml version="1.0" encoding="utf-8" ?>
    <D:propfind xmlns:D="DAV:">
      <D:prop>
        <D:displayname/>
        <D:getcontentlength/>
        <D:getlastmodified/>
        <D:resourcetype/>
      </D:prop>
    </D:propfind>`;

    const listResult = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          action: "webdavRequest",
          url: config.url + "?t=" + Date.now(), // 添加时间戳防止缓存
          method: "PROPFIND",
          headers: {
            ...headers,
            "Content-Type": "application/xml; charset=utf-8",
            Depth: "1",
          },
          body: propfindBody,
        },
        resolve
      );
    });

    console.log("PROPFIND 响应:", listResult);

    if (listResult.success && listResult.response.ok) {
      const backupFiles = parsePropfindResponse(listResult.response.text);
      if (backupFiles.length > 0) {
        console.log("PROPFIND 成功，找到文件:", backupFiles.length);
        return await enrichFileInfo(backupFiles, config, headers);
      }
    }
  } catch (error) {
    console.log("PROPFIND 方法失败:", error);
  }

  // 方法2: 尝试简单的 GET 请求（某些服务器支持目录列表）
  try {
    console.log("尝试使用 GET 方法获取目录列表...");
    const getResult = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          action: "webdavRequest",
          url: config.url + "?t=" + Date.now(), // 添加时间戳防止缓存
          method: "GET",
          headers: headers,
        },
        resolve
      );
    });

    console.log("GET 响应:", getResult);

    if (getResult.success && getResult.response.ok) {
      const backupFiles = parseHTMLDirectoryListing(getResult.response.text);
      if (backupFiles.length > 0) {
        console.log("GET 方法成功，找到文件:", backupFiles.length);
        return await enrichFileInfo(backupFiles, config, headers);
      }
    }
  } catch (error) {
    console.log("GET 方法失败:", error);
  }

  // 方法3: 尝试常见的备份文件名模式
  console.log("尝试使用文件名模式匹配...");
  const patternResults = await tryCommonFilePatterns(config, headers);
  console.log("模式匹配结果:", patternResults);
  return patternResults;
}

// 测试文件是否存在
async function testFileExists(config, headers, fileName) {
  try {
    const fileUrl = config.url.endsWith("/")
      ? config.url + fileName
      : config.url + "/" + fileName;

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

// 解析 PROPFIND XML 响应
function parsePropfindResponse(xmlText) {
  console.log("解析 PROPFIND XML 响应...");
  const backupFiles = [];

  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, "text/xml");

    // 尝试不同的命名空间
    const namespaces = ["D:", "d:", ""];
    let responses = [];

    for (const ns of namespaces) {
      responses = xmlDoc.getElementsByTagName(`${ns}response`);
      if (responses.length > 0) break;
    }

    console.log(`找到 ${responses.length} 个响应项`);

    for (let i = 0; i < responses.length; i++) {
      const response = responses[i];
      // 尝试获取文件信息
      const href = getElementText(response, ["D:href", "d:href", "href"]);
      const displayname = getElementText(response, [
        "D:displayname",
        "d:displayname",
        "displayname",
      ]);
      const contentlength = getElementText(response, [
        "D:getcontentlength",
        "d:getcontentlength",
        "getcontentlength",
      ]);
      const lastmodified = getElementText(response, [
        "D:getlastmodified",
        "d:getlastmodified",
        "getlastmodified",
      ]);

      // 检查是否是目录
      const resourcetype =
        response.getElementsByTagName("D:resourcetype")[0] ||
        response.getElementsByTagName("d:resourcetype")[0] ||
        response.getElementsByTagName("resourcetype")[0];

      const isCollection =
        resourcetype &&
        (resourcetype.getElementsByTagName("D:collection").length > 0 ||
          resourcetype.getElementsByTagName("d:collection").length > 0 ||
          resourcetype.getElementsByTagName("collection").length > 0);

      if (isCollection) continue; // 跳过目录

      // 从 href 或 displayname 中提取文件名
      const fileName =
        displayname || (href ? decodeURIComponent(href.split("/").pop()) : "");

      console.log(`检查文件: ${fileName}`);

      // 检查是否是备份文件
      if (fileName && isBackupFile(fileName)) {
        console.log(`找到备份文件: ${fileName}`);

        const fileInfo = {
          name: fileName,
          href: href,
          size: formatSize(Number.parseInt(contentlength)),
          lastModified: formatDate(lastmodified),
          rawSize: Number.parseInt(contentlength) || 0,
        };

        backupFiles.push(fileInfo);
      }
    }
  } catch (error) {
    console.error("解析 XML 失败:", error);
  }

  console.log(`解析完成，找到 ${backupFiles.length} 个备份文件`);
  return backupFiles;
}

// 辅助函数：获取元素文本内容
function getElementText(parent, tagNames) {
  for (const tagName of tagNames) {
    const element = parent.getElementsByTagName(tagName)[0];
    if (element) return element.textContent;
  }
  return null;
}

// 解析 HTML 目录列表
function parseHTMLDirectoryListing(htmlText) {
  console.log("解析 HTML 目录列表...");
  const backupFiles = [];

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, "text/html");

    // 查找链接
    const links = doc.getElementsByTagName("a");

    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      const href = link.getAttribute("href");
      const text = link.textContent.trim();

      if (href && isBackupFile(href)) {
        console.log(`找到备份文件链接: ${href}`);

        backupFiles.push({
          name: decodeURIComponent(href),
          href: href,
          size: "未知",
          lastModified: "未知",
          rawSize: 0,
        });
      } else if (text && isBackupFile(text)) {
        console.log(`找到备份文件文本: ${text}`);

        backupFiles.push({
          name: text,
          href: text,
          size: "未知",
          lastModified: "未知",
          rawSize: 0,
        });
      }
    }
  } catch (error) {
    console.error("解析 HTML 失败:", error);
  }

  console.log(`HTML 解析完成，找到 ${backupFiles.length} 个备份文件`);
  return backupFiles;
}

// 尝试常见的文件名模式
async function tryCommonFilePatterns(config, headers) {
  console.log("尝试常见的备份文件名模式...");
  const backupFiles = [];

  // 生成可能的文件名
  const patterns = [];
  const now = new Date();

  // 最近30天的日期
  for (let i = 0; i < 30; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split("T")[0];

    patterns.push(`XMark-backup-${dateStr}.json`);
    patterns.push(`XMark-auto-backup-${dateStr}.json`);
    patterns.push(`XMark-${dateStr}.json`);
  }

  // 添加一些其他可能的模式
  patterns.push("XMark.json");
  patterns.push("XMark-backup.json");
  patterns.push("notes.json");

  // 小时备份模式 - 扩展到最近7天，每天24小时
  for (let day = 0; day < 7; day++) {
    const date = new Date(now);
    date.setDate(date.getDate() - day);
    const dateStr = date.toISOString().split("T")[0];

    for (let hour = 0; hour < 24; hour++) {
      const hourStr = hour.toString().padStart(2, "0");
      patterns.push(`XMark-hourly-${dateStr}-${hourStr}.json`);
    }
  }

  console.log(`生成了 ${patterns.length} 个可能的文件名模式`);

  // 并发测试文件是否存在（限制并发数）
  const batchSize = 5;
  for (let i = 0; i < patterns.length; i += batchSize) {
    const batch = patterns.slice(i, i + batchSize);
    const promises = batch.map((fileName) =>
      testFileExists(config, headers, fileName)
    );
    const results = await Promise.all(promises);

    results.forEach((result, index) => {
      if (result) {
        console.log(`找到文件: ${batch[index]}`);
        backupFiles.push(result);
      }
    });

    // 如果找到了一些文件，可以提前返回
    if (backupFiles.length > 0 && i > 100) {
      console.log(`已找到 ${backupFiles.length} 个文件，停止搜索`);
      break;
    }
  }

  console.log(`模式匹配完成，找到 ${backupFiles.length} 个备份文件`);
  return backupFiles;
}

// 检查是否是备份文件
function isBackupFile(fileName) {
  if (!fileName) return false;

  const lowerName = fileName.toLowerCase();
  return (
    lowerName.includes("twitter-notes") &&
    lowerName.endsWith(".json") &&
    !lowerName.includes("..") // 安全检查
  );
}

// 丰富文件信息（获取备注数量等）
async function enrichFileInfo(backupFiles, config, headers) {
  console.log(`开始丰富 ${backupFiles.length} 个文件的信息...`);

  // 限制并发数，避免服务器压力过大
  const batchSize = 3;
  const enrichedFiles = [];

  for (let i = 0; i < backupFiles.length; i += batchSize) {
    const batch = backupFiles.slice(i, i + batchSize);
    const promises = batch.map((file) =>
      enrichSingleFile(file, config, headers)
    );
    const results = await Promise.all(promises);
    enrichedFiles.push(...results);
  }

  // 按修改时间排序（最新的在前）
  enrichedFiles.sort((a, b) => {
    const dateA = new Date(a.lastModified);
    const dateB = new Date(b.lastModified);
    return dateB - dateA;
  });

  console.log(`文件信息丰富完成，共 ${enrichedFiles.length} 个文件`);
  return enrichedFiles;
}

// 丰富单个文件信息
async function enrichSingleFile(file, config, headers) {
  try {
    const fileUrl = config.url.endsWith("/")
      ? config.url + file.name
      : config.url + "/" + file.name;

    const fileResult = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          action: "webdavRequest",
          url: fileUrl,
          method: "GET",
          headers: headers,
        },
        resolve
      );
    });

    if (fileResult.success && fileResult.response.ok) {
      try {
        const fileContent = JSON.parse(fileResult.response.text);
        if (fileContent.notes) {
          file.notesCount = Object.keys(fileContent.notes).length;
        }
      } catch (parseError) {
        console.log(`无法解析文件内容: ${file.name}`, parseError);
      }
    }
  } catch (error) {
    console.log(`获取文件详情失败: ${file.name}`, error);
  }

  return file;
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
      ? config.url + fileName
      : config.url + "/" + fileName;

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
        `下载备份失败: ${downloadResult.response.status} ${downloadResult.response.statusText}`
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
      showErrorMessage(langData.messages.restoreCancelled, "info");
      return;
    }

    await processImportedNotes(importData.notes);

    // 恢复标签数据
    if (importData.tags) {
      const result = await chrome.storage.local.get(["noteTags"]);
      const existingTags = result.noteTags || {};
      const mergedTags = { ...existingTags, ...importData.tags };
      await chrome.storage.local.set({ noteTags: mergedTags });
      await loadTags();
    }

    showMessage(
      `${langData.messages.restoreSuccess} ${
        Object.keys(importData.notes).length
      } ${langData.messages.webdavRestoreNum}`,
      "success"
    );
  } catch (error) {
    showErrorMessage(
      `${langData.messages.restoreFailed} + ${error.message}`,
      "error"
    );
  } finally {
    button.disabled = false;
    button.innerHTML = originalText;
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

    showMessage(`${langData.messages.backupDeleted} : ${fileName}`, "success");
  } catch (error) {
    showErrorMessage(
      `${langData.messages.deleteFailed} + ${error.message}`,
      "error"
    );
  }
}

function showMessage(messageHTML) {
  const messageDiv = document.createElement("div");

  // 创建临时消息提示

  messageDiv.innerHTML = messageHTML;
  messageDiv.style.cssText = `
    position: fixed;
    bottom: 10px;
    left: 50%;
    transform: translateX(-50%);
    background: mediumseagreen;
    color: white;
    padding: 8px 16px;
    border-radius: 4px;
    font-size: 12px;
    z-index: 1000;
    white-space: pre-wrap;
  `;

  // 创建关闭按钮元素
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "×";
  closeBtn.style.cssText = `
		position: absolute;
		top: 2px;
		right: 2px;
		background: transparent;
		border: none;
		color: rebeccapurple;
		font-size: 16px;
		font-weight: bold;
		cursor: pointer;
		line-height: 1;
	`;

  // 关闭按钮点击时隐藏或移除消息弹窗
  closeBtn.onclick = () => {
    messageDiv.style.display = "none";
  };
  messageDiv.appendChild(closeBtn);

  document.body.appendChild(messageDiv);

  setTimeout(() => {
    document.body.removeChild(messageDiv);
  }, 3000);
}

function showErrorMessage(messageHTML) {
  const messageDiv = document.createElement("div");

  // 创建临时消息提示

  messageDiv.innerHTML = messageHTML;
  messageDiv.style.cssText = `
    position: fixed;
    bottom: 10px;
    left: 50%;
    transform: translateX(-50%);
    background: red;
    color: white;
    padding: 8px 16px;
    border-radius: 4px;
    font-size: 12px;
		font-weight: bold;
    z-index: 1000;
    white-space: pre-wrap;
  `;

  // 创建关闭按钮元素
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "×";
  closeBtn.style.cssText = `
		position: absolute;
		top: 2px;
		right: 2px;
		background: transparent;
		border: none;
		color: darkblue;
		font-size: 16px;
		font-weight: bold;
		cursor: pointer;
		line-height: 1;
	`;

  // 关闭按钮点击时隐藏或移除消息弹窗
  closeBtn.onclick = () => {
    messageDiv.style.display = "none";
  };
  messageDiv.appendChild(closeBtn);

  document.body.appendChild(messageDiv);

  setTimeout(() => {
    document.body.removeChild(messageDiv);
  }, 3000);
}

function showAddTagDialog() {
  const existingDialog = document.querySelector(".tag-dialog");
  if (existingDialog) {
    existingDialog.remove();
  }

  getCurrentLangData()
    .then(() => {
      const dialog = document.createElement("div");
      dialog.className = "tag-dialog";

      const colors = [
        "#1d9bf0",
        "#00ba7c",
        "#ff6b35",
        "#f91880",
        "#7856ff",
        "#ffad1f",
        "#20bf6b",
        "#eb4d4b",
        "#6c5ce7",
        "#a29bfe",
        "#fd79a8",
        "#fdcb6e",
      ];

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
        const result = await chrome.storage.local.get(["noteTags"]);
        const existingTags = result.noteTags || {};

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

        existingTags[tagId] = newTag;
        await chrome.storage.local.set({ noteTags: existingTags });

        await loadTags();
        closeDialog();
        showMessage(`${tagName} ${langData.messages.tagCreated}`, "success");
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

// 在 showAddTagDialog 函数后添加编辑标签功能
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
        showErrorMessage("标签不存在", "error");
        return;
      }

      const dialog = document.createElement("div");
      dialog.className = "tag-dialog";

      const colors = [
        "#1d9bf0",
        "#00ba7c",
        "#ff6b35",
        "#f91880",
        "#7856ff",
        "#ffad1f",
        "#20bf6b",
        "#eb4d4b",
        "#6c5ce7",
        "#a29bfe",
        "#fd79a8",
        "#fdcb6e",
      ];

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
        closeDialog();
        showMessage(`${tagName} ${langData.messages.tagUpdated}`, "success");
      });

      // 删除标签
      deleteBtn.addEventListener("click", async () => {
        if (!confirm(langData.confirmDeleteTag)) {
          return;
        }

        try {
          const result = await chrome.storage.local.get(["noteTags"]);
          const tags = result.noteTags || {};

          const tagName = tags[tagId]?.name;
          delete tags[tagId];

          await chrome.storage.local.set({ noteTags: tags });
          await loadTags();
          closeDialog();

          showMessage(`${tagName} ${langData.messages.tagDeleted}`, "success");
        } catch (error) {
          showErrorMessage(`${langData.messages.tagDeletedFailed}`, "error");
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

// loadTags 函数，添加编辑功能
async function loadTags() {
  try {
    const result = await chrome.storage.local.get(["noteTags"]);
    const tags = result.noteTags || {};

    const tagList = document.getElementById("tagList");

    if (Object.keys(tags).length === 0) {
      tagList.innerHTML = `<div style="color: #536471; font-size: 12px; text-align: center; padding: 10px;">暂无标签</div>`;
      return;
    }

    tagList.innerHTML = Object.entries(tags)
      .map(
        ([tagId, tag]) => `
        <div class="tag-item" style="background-color: ${tag.color}">
          <span>${tag.name}</span>
          <button class="tag-edit" data-id="${tagId}">✏️</button>
        </div>
      `
      )
      .join("");
  } catch (error) {
    console.error("加载标签失败:", error);
  }
}

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
