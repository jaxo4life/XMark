// Twitter Notes Background Script

import { cryptoUtils } from './crypto-utils.js';

// 扩展启动时，恢复自动备份
chrome.runtime.onStartup.addListener(async () => {
  const result = await chrome.storage.local.get(["autoBackupSettings"]);
  const settings = result.autoBackupSettings;
  if (settings && settings.enabled) {
    setupAutoBackup(settings.frequency);
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  console.log("Twitter Notes 扩展已安装/更新");

  // 初始化默认设置
  const result = await chrome.storage.local.get(["autoBackupSettings"]);
  if (!result.autoBackupSettings) {
    await chrome.storage.local.set({
      autoBackupSettings: {
        enabled: false,
        frequency: "hourly",
        lastBackup: null,
      },
    });
  } else if (result.autoBackupSettings.enabled) {
    // 如果启用了自动备份，重新注册 alarm
    setupAutoBackup(result.autoBackupSettings.frequency);
  }
});

let lastFrequency;

// 监听存储变化，可以用于同步等功能
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "local" && changes.twitterNotes) {
    console.log("备注数据已更新");
  }

  if (namespace === "local" && changes.autoBackupSettings) {
    const newSettings = changes.autoBackupSettings.newValue;
    const oldSettings = changes.autoBackupSettings.oldValue;

    // 只有当频率或 enabled 状态真的变了，才重置定时器
    if (
      newSettings &&
      newSettings.enabled &&
      (!oldSettings ||
        newSettings.frequency !== oldSettings.frequency ||
        newSettings.enabled !== oldSettings.enabled)
    ) {
      setupAutoBackup(newSettings.frequency);
    } else if (!newSettings.enabled) {
      clearAutoBackup();
    }
  }
});

// 监听定时器
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "autoBackup") {
    performAutoBackup();
  }
});

// 设置自动备份
function setupAutoBackup(frequency) {
  // 清除现有的定时器
  chrome.alarms.clear("autoBackup");

  let periodInMinutes;
  switch (frequency) {
    case "hourly":
      periodInMinutes = 60; // 1小时
      break;
    case "daily":
      periodInMinutes = 24 * 60; // 24小时
      break;
    case "weekly":
      periodInMinutes = 7 * 24 * 60; // 7天
      break;
    case "monthly":
      periodInMinutes = 30 * 24 * 60; // 30天
      break;
    default:
      periodInMinutes = 24 * 60;
  }

  // 创建新的定时器
  chrome.alarms.create("autoBackup", {
    delayInMinutes: 0.1,
    periodInMinutes: periodInMinutes,
  });

  console.log(
    `自动备份已设置，频率: ${frequency}，间隔: ${periodInMinutes} 分钟`
  );
}

// 清除自动备份
function clearAutoBackup() {
  chrome.alarms.clear("autoBackup");
  console.log("自动备份已关闭");
}

// 执行自动备份
async function performAutoBackup() {
  try {
    console.log("开始执行自动备份...");

    // 获取 WebDAV 配置
    const configResult = await chrome.storage.local.get(["webdavConfig"]);
    let config = configResult.webdavConfig;

    if (!config || !config.url) {
      console.error("自动备份失败: WebDAV 未配置");
      return;
    }

    // 解密配置
    if (config.encrypted) {
      config = await cryptoUtils.decryptWebDAVConfig(config);
    }

    // 获取备注和标签数据
    const result = await chrome.storage.local.get(["twitterNotes", "noteTags"]);
    const notes = result.twitterNotes || {};
    const tags = result.noteTags || {};

    if (Object.keys(notes).length === 0) {
      console.log("没有备注数据，跳过自动备份");
      return;
    }

    // 获取备份频率以确定文件名
    const settingsResult = await chrome.storage.local.get([
      "autoBackupSettings",
    ]);
    const settings = settingsResult.autoBackupSettings || {};
    const frequency = settings.frequency || "daily";

    const manifest = chrome.runtime.getManifest();
    const exportData = {
      version: manifest.version,
      exportTime: new Date().toISOString(),
      notes: notes,
      tags: tags,
      autoBackup: true,
      frequency: frequency,
    };

    let fileName;
    if (frequency === "hourly") {
      // 小时备份包含小时信息
      const now = new Date();
      const dateHour = `${now.toISOString().split("T")[0]}-${now
        .getHours()
        .toString()
        .padStart(2, "0")}`;
      fileName = `XMark-hourly-${dateHour}.json`;
    } else {
      // 其他频率使用日期
      fileName = `XMark-auto-backup-${
        new Date().toISOString().split("T")[0]
      }.json`;
    }

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

    // 执行上传
    const response = await fetch(webdavUrl, {
      method: "PUT",
      headers: headers,
      body: fileContent,
    });

    if (response.ok) {
      // 更新最后备份时间
      const settingsResult = await chrome.storage.local.get([
        "autoBackupSettings",
      ]);
      const settings = settingsResult.autoBackupSettings || {};
      settings.lastBackup = new Date().toISOString();

      await chrome.storage.local.set({ autoBackupSettings: settings });

      console.log("自动备份成功:", fileName);

      // 发送通知给 popup（如果打开的话）
      chrome.runtime
        .sendMessage({
          action: "autoBackupComplete",
          success: true,
          fileName: fileName,
        })
        .catch(() => {
          // popup 可能没有打开，忽略错误
        });
    } else {
      throw new Error(
        `自动备份失败: ${response.status} ${response.statusText}`
      );
    }
  } catch (error) {
    console.error("自动备份失败:", error);

    // 发送错误通知
    chrome.runtime
      .sendMessage({
        action: "autoBackupComplete",
        success: false,
        error: error.message,
      })
      .catch(() => {
        // popup 可能没有打开，忽略错误
      });
  }
}

// 处理来自content script和popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getNotes") {
    chrome.storage.local.get(["twitterNotes"]).then((result) => {
      sendResponse({ notes: result.twitterNotes || {} });
    });
    return true; // 保持消息通道开放
  }

  if (request.action === "saveNote") {
    chrome.storage.local.get(["twitterNotes"]).then((result) => {
      const notes = result.twitterNotes || {};
      notes[request.username] = request.note;

      chrome.storage.local.set({ twitterNotes: notes }).then(() => {
        sendResponse({ success: true });
      });
    });
    return true;
  }

  if (request.action === "deleteNote") {
    chrome.storage.local.get(["twitterNotes"]).then((result) => {
      const notes = result.twitterNotes || {};
      delete notes[request.username];

      chrome.storage.local.set({ twitterNotes: notes }).then(() => {
        sendResponse({ success: true });
      });
    });
    return true;
  }

  // 处理 WebDAV 请求（绕过 CORS）
  if (request.action === "webdavRequest") {
    handleWebDAVRequest(request, sendResponse);
    return true;
  }

  // 处理手动触发自动备份
  if (request.action === "triggerAutoBackup") {
    performAutoBackup();
    sendResponse({ success: true });
    return true;
  }
});

// 处理 WebDAV 请求
async function handleWebDAVRequest(request, sendResponse) {
  try {
    const { url, method, headers, body } = request;

    const response = await fetch(url, {
      method: method,
      headers: headers,
      body: body,
    });

    const responseData = {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
    };

    if (method === "GET") {
      responseData.text = await response.text();
    }

    sendResponse({ success: true, response: responseData });
  } catch (error) {
    console.error("WebDAV 请求失败:", error);
    sendResponse({
      success: false,
      error: error.message || "WebDAV 请求失败",
    });
  }
}
