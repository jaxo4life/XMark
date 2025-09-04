// Twitter Notes Background Script

import { cryptoUtils } from "./crypto-utils.js";

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

  // 读取上次备份时间
  chrome.storage.local
    .get(["autoBackupSettings"])
    .then(({ autoBackupSettings }) => {
      const lastBackup = autoBackupSettings?.lastBackup
        ? new Date(autoBackupSettings.lastBackup)
        : null;

      const now = new Date();

      let delayInMinutes;
      if (!lastBackup) {
        // 从未备份过 → 马上执行
        delayInMinutes = 0.1;
      } else {
        // 距离上次备份的分钟数
        const diffMinutes = (now - lastBackup) / 1000 / 60;

        if (diffMinutes >= periodInMinutes) {
          // 已经超时 → 马上执行
          delayInMinutes = 0.1;
        } else {
          // 还没到间隔 → 等剩余时间
          delayInMinutes = periodInMinutes - diffMinutes;
        }
      }

      chrome.alarms.create("autoBackup", {
        delayInMinutes,
        periodInMinutes,
      });

      console.log(
        `自动备份已设置：首次延迟 ${delayInMinutes} 分钟，之后每 ${periodInMinutes} 分钟一次`
      );
    });
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
      ? config.url + "XMark/Backup/" + fileName
      : config.url + "/XMark/Backup/" + fileName;

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

// 推文截图上传
async function uploadToWebDAV(blob, filename, handle) {
  try {
    // 获取 WebDAV 配置
    const configResult = await chrome.storage.local.get(["webdavConfig"]);
    let config = configResult.webdavConfig;

    if (!config || !config.url) {
      throw new Error("WebDAV 未配置");
    }

    // 解密配置
    if (config.encrypted) {
      config = await cryptoUtils.decryptWebDAVConfig(config);
    }

    // 构建 WebDAV URL
    const baseUrl = config.url.endsWith("/") ? config.url : config.url + "/";

    // 准备认证头
    const headers = {};
    if (config.username && config.password) {
      headers["Authorization"] =
        "Basic " + btoa(config.username + ":" + config.password);
    }

    // 尝试创建用户文件夹（MKCOL）
    const folderUrl = await ensureThreeLevelDirExists(baseUrl, handle, headers);

    const fileUrl = folderUrl + encodeURIComponent(filename);

    // 上传文件
    const res = await fetch(fileUrl, {
      method: "PUT",
      headers: {
        ...headers,
        "Content-Type": blob.type || "image/png",
      },
      body: blob,
    });

    if (!res.ok) {
      throw new Error(`上传失败: ${res.status} ${res.statusText}`);
    }

    return res; // 返回 fetch Response
  } catch (error) {
    console.error("WebDAV 上传失败:", error);
    throw error;
  }
}

async function ensureThreeLevelDirExists(baseUrl, handle, headers) {
  // 处理 handle 中的非法字符
  const safeHandle = encodeURIComponent(handle);

  // 三级目录依次检查
  const dirs = ["XMark", "Screenshot", safeHandle];
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

  return currentUrl + "/";
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

  // 按标签显示
  if (request.action === "getGroups") {
    chrome.storage.local.get(
      ["twitterNotes", "noteTags", "noteTagsOrder"],
      (data) => {
        sendResponse(data || {});
      }
    );
    return true; // 异步响应
  }

  // 获取头像
  if (request.action === "fetchAvatar") {
    (async () => {
      const maxRetries = 3;
      let attempt = 0;
      let ttl = request.ttl; // 第一次传进来的 TTL
      let blob = null;

      try {
        while (attempt < maxRetries) {
          const url = `https://unavatar.io/x/${request.username}?ttl=${ttl}h`;
          const res = await fetch(url);
          blob = await res.blob();
          const contentType = res.headers.get("content-type") || "";

          // 判断是否是默认头像
          if (contentType.includes("image/png") && blob.size < 5000) {
            attempt++;
            ttl = Math.floor(Math.random() * 24) + 1; // 重新随机 TTL
            console.warn(
              `Fallback avatar detected, retrying with new TTL (${attempt}/${maxRetries})...`
            );
            // 通知 content script 更新 TTL
            chrome.tabs.sendMessage(sender.tab.id, {
              action: "updateTTL",
              username: request.username,
              ttl,
            });
          } else {
            break; // 正常头像，跳出循环
          }
        }

        // Blob 转 Base64
        const reader = new FileReader();
        reader.onloadend = () => {
          sendResponse({ src: reader.result });
        };
        reader.readAsDataURL(blob);
      } catch (err) {
        console.error("fetchAvatar error", err);
        sendResponse({ src: null });
      }
    })();
    return true; // 异步 sendResponse 必须返回 true
  }

  // 处理推文快照
  if (request.action === "saveTweet") {
    const windowId = sender.tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT;

    chrome.tabs.captureVisibleTab(
      windowId,
      { format: "png", quality: 100 },
      (dataUrl) => {
        if (chrome.runtime.lastError) {
          console.error(
            "Error capturing screenshot:",
            JSON.stringify(chrome.runtime.lastError, null, 2)
          );
          sendResponse({
            success: false,
            error:
              chrome.runtime.lastError.message ||
              JSON.stringify(chrome.runtime.lastError),
          });
          return;
        }

        fetch(dataUrl)
          .then((res) => res.blob())
          .then((blob) => createImageBitmap(blob))
          .then(async (imageBitmap) => {
            const devicePixelRatio = request.elementInfo.devicePixelRatio || 1;
            const cropX =
              (request.elementInfo.x - request.elementInfo.scrollX) *
              devicePixelRatio;
            const cropY =
              (request.elementInfo.y - request.elementInfo.scrollY) *
              devicePixelRatio;
            const cropWidth = request.elementInfo.width * devicePixelRatio;
            const cropHeight = request.elementInfo.height * devicePixelRatio;

            // 阴影扩展大小
            const shadowBlur = 16 * devicePixelRatio;
            const shadowOffset = 8 * devicePixelRatio;

            const canvas = new OffscreenCanvas(
              cropWidth + shadowBlur * 2,
              cropHeight + shadowBlur * 2
            );
            const ctx = canvas.getContext("2d");

            const xOffset = shadowBlur;
            const yOffset = shadowBlur;

            // 圆角半径
            const radius = 20 * devicePixelRatio;

            // 1. 绘制半透明阴影边框
            ctx.save();
            ctx.fillStyle = "white";
            ctx.shadowColor = "rgba(0, 0, 0, 0.25)"; // 阴影颜色
            ctx.shadowBlur = shadowBlur;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = shadowOffset;

            ctx.beginPath();
            ctx.moveTo(xOffset + radius, yOffset);
            ctx.lineTo(xOffset + cropWidth - radius, yOffset);
            ctx.quadraticCurveTo(
              xOffset + cropWidth,
              yOffset,
              xOffset + cropWidth,
              yOffset + radius
            );
            ctx.lineTo(xOffset + cropWidth, yOffset + cropHeight - radius);
            ctx.quadraticCurveTo(
              xOffset + cropWidth,
              yOffset + cropHeight,
              xOffset + cropWidth - radius,
              yOffset + cropHeight
            );
            ctx.lineTo(xOffset + radius, yOffset + cropHeight);
            ctx.quadraticCurveTo(
              xOffset,
              yOffset + cropHeight,
              xOffset,
              yOffset + cropHeight - radius
            );
            ctx.lineTo(xOffset, yOffset + radius);
            ctx.quadraticCurveTo(xOffset, yOffset, xOffset + radius, yOffset);
            ctx.closePath();
            ctx.fill();
            ctx.restore();

            // 2. 裁剪路径（圆角矩形）
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(xOffset + radius, yOffset);
            ctx.lineTo(xOffset + cropWidth - radius, yOffset);
            ctx.quadraticCurveTo(
              xOffset + cropWidth,
              yOffset,
              xOffset + cropWidth,
              yOffset + radius
            );
            ctx.lineTo(xOffset + cropWidth, yOffset + cropHeight - radius);
            ctx.quadraticCurveTo(
              xOffset + cropWidth,
              yOffset + cropHeight,
              xOffset + cropWidth - radius,
              yOffset + cropHeight
            );
            ctx.lineTo(xOffset + radius, yOffset + cropHeight);
            ctx.quadraticCurveTo(
              xOffset,
              yOffset + cropHeight,
              xOffset,
              yOffset + cropHeight - radius
            );
            ctx.lineTo(xOffset, yOffset + radius);
            ctx.quadraticCurveTo(xOffset, yOffset, xOffset + radius, yOffset);
            ctx.closePath();
            ctx.clip();

            // 3. 绘制截图
            ctx.drawImage(
              imageBitmap,
              cropX,
              cropY,
              cropWidth,
              cropHeight,
              xOffset,
              yOffset,
              cropWidth,
              cropHeight
            );

            // 4. 绘制右上角 X logo
            const logoSize = 20 * devicePixelRatio;
            const logoMargin = 10 * devicePixelRatio;
            const logoUrl = chrome.runtime.getURL("public/X_logo.png");

            try {
              const res = await fetch(logoUrl);
              const blob = await res.blob();
              const logoBitmap = await createImageBitmap(blob);
              ctx.drawImage(
                logoBitmap,
                xOffset + cropWidth - logoSize - logoMargin,
                yOffset + logoMargin,
                logoSize,
                logoSize
              );
              ctx.restore();
              return await canvas.convertToBlob({
                type: "image/png",
                quality: 1.0,
              });
            } catch (err) {
              console.warn(
                "Failed to load X logo, proceeding without it:",
                err
              );
              ctx.restore();
              return await canvas.convertToBlob({
                type: "image/png",
                quality: 1.0,
              });
            }
          })
          .then((blob) => {
            const reader = new FileReader();
            reader.onload = () => {
              if (request.choice) {
                uploadToWebDAV(blob, request.filename, request.handle)
                  .then((res) => {
                    if (res.ok) {
                      console.log("图片上传到 WebDAV 成功！");
                      sendResponse({ success: true });
                    } else {
                      console.error("上传失败", res.statusText);
                      sendResponse({ success: false, error: res.statusText });
                    }
                  })
                  .catch((err) => {
                    console.error("上传错误", err);
                    sendResponse({ success: false, error: err.message });
                  });
              } else {
                chrome.downloads.download(
                  {
                    url: reader.result,
                    filename: `XMark/Screenshot/${request.handle}/${request.filename}`,
                    saveAs: false,
                  },
                  (downloadId) => {
                    if (chrome.runtime.lastError) {
                      console.error(
                        "Error downloading cropped screenshot:",
                        chrome.runtime.lastError
                      );
                      sendResponse({
                        success: false,
                        error: chrome.runtime.lastError.message,
                      });
                    } else {
                      sendResponse({ success: true, downloadId });
                    }
                  }
                );
              }
            };
            reader.readAsDataURL(blob);
          })
          .catch((error) => {
            console.error("Error processing screenshot:", error);
            sendResponse({
              success: false,
              error: "Failed to process screenshot: " + error.message,
            });
          });
      }
    );

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
