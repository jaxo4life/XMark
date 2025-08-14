// Twitter Notes Background Script

// 简单的密码解码函数
function decodePassword(encodedPassword) {
  if (!encodedPassword) return "";
  try {
    return decodeURIComponent(escape(atob(encodedPassword)));
  } catch (error) {
    console.error("密码解码失败:", error);
    return "";
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("Twitter Notes 扩展已安装");

  // 初始化自动备份设置
  chrome.storage.local.get(["autoBackupSettings"]).then((result) => {
    if (!result.autoBackupSettings) {
      chrome.storage.local.set({
        autoBackupSettings: {
          enabled: false,
          frequency: "hourly",
          lastBackup: null,
        },
      });
    }
  });
});

// 监听存储变化，可以用于同步等功能
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "local" && changes.twitterNotes) {
    console.log("备注数据已更新");
  }

  // 监听自动备份设置变化
  if (namespace === "local" && changes.autoBackupSettings) {
    const newSettings = changes.autoBackupSettings.newValue;
    if (newSettings && newSettings.enabled) {
      setupAutoBackup(newSettings.frequency);
    } else {
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

  let delayInMinutes;
  switch (frequency) {
    case "hourly":
      delayInMinutes = 60; // 1小时
      break;
    case "daily":
      delayInMinutes = 24 * 60; // 24小时
      break;
    case "weekly":
      delayInMinutes = 7 * 24 * 60; // 7天
      break;
    case "monthly":
      delayInMinutes = 30 * 24 * 60; // 30天
      break;
    default:
      delayInMinutes = 24 * 60;
  }

  // 创建新的定时器
  chrome.alarms.create("autoBackup", {
    delayInMinutes: delayInMinutes,
    periodInMinutes: delayInMinutes,
  });

  console.log(
    `自动备份已设置，频率: ${frequency}，间隔: ${delayInMinutes} 分钟`
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
    const config = configResult.webdavConfig;

    if (!config || !config.url) {
      console.error("自动备份失败: WebDAV 未配置");
      return;
    }

    // 解码密码（如果需要）
    if (config.encoded && config.password) {
      config.password = decodePassword(config.password);
    }

    // 获取备注数据
    const notesResult = await chrome.storage.local.get(["twitterNotes"]);
    const notes = notesResult.twitterNotes || {};

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
