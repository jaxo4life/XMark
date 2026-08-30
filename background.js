// Twitter Notes Background Script

import { cryptoUtils } from "./utils/crypto-utils.js";
import {
  saveScreenshotToDB,
  getScreenshotsByUserId,
  getScreenshotCountByUserId,
  getUserIdinDB,
  getAvatar,
  saveFollowSnapshot,
  getFollowSnapshots,
  rebuildFollow,
  dayKey,
} from "./utils/db.js";

// UTF-8 安全的 base64（btoa 对非 ASCII 字符会抛 InvalidCharacterError）
function btoaUtf8(s) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)));
}

// 带超时的 fetch，避免 WebDAV 请求挂死
function fetchWithTimeout(url, opts = {}, ms = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...opts, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

// WebDAV 允许的 HTTP 方法白名单
const WEBDAV_METHODS = new Set([
  "GET",
  "HEAD",
  "OPTIONS",
  "PUT",
  "DELETE",
  "PROPFIND",
  "MKCOL",
  "MOVE",
  "COPY",
]);

// ===== 右列 Timeline：放行同源子帧嵌入（正式规则，勿删）=====
// X 响应头禁止 iframe 嵌入（X-Frame-Options/CSP frame-ancestors），右列需嵌 /i/lists/*。
// urlFilter 全域而非仅 /i/lists：帧内点用户/推文跳转后的后续文档也是 sub_frame，收窄会导航后被拒。
// 已知放宽面：任何 x.com 页面可被 x.com/twitter.com 页面嵌入（含用户控制台手贴），自有浏览器可接受。
// 附带影响：被嵌子帧的官方 CSP 同时被删（同源自有内容，见项目 CLAUDE.md 备案）。
const unframeRule = (id, urlFilter) => ({
  id,
  priority: 1,
  action: {
    type: "modifyHeaders",
    responseHeaders: [
      { header: "x-frame-options", operation: "remove" },
      { header: "content-security-policy", operation: "remove" },
      { header: "content-security-policy-report-only", operation: "remove" },
    ],
  },
  condition: {
    urlFilter,
    resourceTypes: ["sub_frame"],
    initiatorDomains: ["x.com", "twitter.com"],
  },
});
chrome.declarativeNetRequest.updateDynamicRules({
  removeRuleIds: [9001, 9002],
  addRules: [unframeRule(9001, "||x.com/"), unframeRule(9002, "||twitter.com/")],
}).catch((e) => console.error("[XMark] DNR unframe rules failed:", e));

// 扩展启动时，恢复自动备份
chrome.runtime.onStartup.addListener(async () => {
  const result = await chrome.storage.local.get(["autoBackupSettings"]);
  const settings = result.autoBackupSettings;
  if (settings && settings.enabled) {
    setupAutoBackup(settings.frequency);
  }
  // 关注变动：启动后 1min 便捷采集（今日未采才跑）；巡逻兜底跨天场景
  chrome.alarms.create("followKick", { delayInMinutes: 1 });
  chrome.alarms.create("followPatrol", { periodInMinutes: 360 });
});

// 生成或获取 UUID
async function getOrCreateUUID() {
  return new Promise((resolve) => {
    chrome.storage.local.get("uuid", (data) => {
      if (data.uuid) {
        resolve(data.uuid);
      } else {
        const uuid = crypto.randomUUID();
        chrome.storage.local.set({ uuid }, () => resolve(uuid));
      }
    });
  });
}

// 封装上报函数
async function reportInstall(uuid) {
  const installTime = new Date().toISOString();

  // 获取地区信息（语言+时区）
  const language = navigator.language;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  try {
    await fetch("https://xmark.jaxo.workers.dev/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uuid,
        installedAt: installTime,
        extensionId: chrome.runtime.id,
        language,
        timezone,
      }),
    });
  } catch (err) {}
}

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log("Twitter Notes 扩展已安装/更新");

  // 关注变动：更新/安装后 alarm 就位（onStartup 也会建，双保险幂等）
  chrome.alarms.create("followKick", { delayInMinutes: 1 });
  chrome.alarms.create("followPatrol", { periodInMinutes: 360 });

  // 确保用户有 UUID
  const uuid = await getOrCreateUUID();

  // 尝试用 storage 标记是否已上报过
  const data = await chrome.storage.local.get("reported");
  if (!data.reported) {
    await reportInstall(uuid);
    await chrome.storage.local.set({ reported: true });
  }

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
  // 播客 offscreen 空闲回收：到点直接关（期间恢复播放则 podActive 已清 alarm，无竞态）
  if (alarm.name === "podcast-offscreen-reap") {
    chrome.runtime
      .getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })
      .then((ctx) => {
        if (ctx.length) chrome.offscreen.closeDocument();
      })
      .catch(() => {});
  }
  // 关注变动：便捷采集 / 跨天巡逻 / 采集中 30s 踢活（后台 tab 节流兜底）
  if (alarm.name === "followKick" || alarm.name === "followPatrol") {
    followKickCheck();
  }
  if (alarm.name === "followTick") {
    followTickKick();
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

    // 获取备注和标签数据（v6.5.0 起播客订阅一并备份）
    const result = await chrome.storage.local.get(["twitterNotes", "noteTags", "podcastSubs"]);
    const notes = result.twitterNotes || {};
    const tags = result.noteTags || {};
    const podcastSubs = result.podcastSubs || [];

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
      podcastSubs: podcastSubs,
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
        "Basic " + btoaUtf8(config.username + ":" + config.password);
    }

    // 执行上传（最多重试 3 次，指数退避，提升备份可靠性）
    let uploaded = false;
    let lastError = null;
    for (let attempt = 0; attempt < 3 && !uploaded; attempt++) {
      try {
        const response = await fetchWithTimeout(
          webdavUrl,
          { method: "PUT", headers: headers, body: fileContent },
          20000
        );
        if (response.ok) {
          uploaded = true;
        } else {
          lastError = new Error(
            `自动备份失败: ${response.status} ${response.statusText}`
          );
        }
      } catch (err) {
        lastError = err;
      }
      if (!uploaded && attempt < 2) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }

    if (uploaded) {
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
      throw lastError || new Error("自动备份失败");
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
        "Basic " + btoaUtf8(config.username + ":" + config.password);
    }

    // 尝试创建用户文件夹（MKCOL）
    const folderUrl = await ensureThreeLevelDirExists(baseUrl, handle, headers);

    const fileUrl = folderUrl + encodeURIComponent(filename);

    // 上传文件
    const res = await fetchWithTimeout(fileUrl, {
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
    const res = await fetchWithTimeout(currentUrl, { method: "PROPFIND", headers });
    if (!res.ok) {
      // 如果不存在，就创建
      try {
        await fetchWithTimeout(currentUrl, {
          method: "MKCOL",
          headers,
        });
        console.log("MKCOL 创建成功:", currentUrl);
      } catch (err) {
        console.log("MKCOL 创建失败（可能已存在）:", currentUrl, err);
      }
    } else {
      console.log("目录已存在:", currentUrl);
    }
  }

  return currentUrl + "/";
}

// 处理来自content script和popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // ===== 播客面板（podcast.js / offscreen.js 消费，见文件尾部 pod 段） =====
  // 排除内部信号（podIdle/podActive/podStateFromEngine 由尾部专用 listener 处理，
  // 混进本分支会 fall-through 到 {ok:false} 的脏应答）
  if (
    typeof request.action === "string" &&
    request.action.startsWith("pod") &&
    request.action !== "podIdle" &&
    request.action !== "podActive" &&
    request.action !== "podStateFromEngine"
  ) {
    handlePodcastMessage(request, sender, sendResponse);
    return true; // 异步应答
  }

  // ===== 关注变动追踪（follow-collect.js 上报 / popup 查询与手动触发）=====
  if (
    typeof request.action === "string" &&
    request.action.startsWith("follow")
  ) {
    handleFollowMessage(request, sender, sendResponse);
    return true; // 异步应答
  }

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
      try {
        // 直接调用 getAvatar 获取 base64
        const base64 = await getAvatar(request.username);
        sendResponse({ src: base64 });
      } catch (err) {
        console.error("fetchAvatar error:", err);
        sendResponse({ src: null });
      }
    })();

    return true;
  }

  if (request.action === "partialShot") {
    const windowId = sender.tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT;

    chrome.tabs.captureVisibleTab(
      windowId,
      { format: "png" },
      async (dataUrl) => {
        if (!dataUrl) {
          console.error("partialShot failed", chrome.runtime.lastError);
          sendResponse(null);
          return;
        }

        try {
          const res = await fetch(dataUrl);
          const blob = await res.blob();
          const bitmap = await createImageBitmap(blob);

          const info = request.elementInfo || {};
          const scale = info.scale || 1;
          const dpr = info.devicePixelRatio || 1;
          const elemLeft = info.x; // 元素在页面中的绝对 left (CSS px)
          const elemTop = info.y; // 元素在页面中的绝对 top (CSS px)
          const elemWidth = info.width; // CSS px
          const elemTotalHeight = info.height; // CSS px (整条推文高度)
          const captureTop = info.scrollY; // 这次 capture 的 viewport top（content 带来，CSS px）
          const captureLeft = info.scrollX || 0;
          const viewportHeight = info.viewportHeight || window.innerHeight || 0;
          const headerHeight = info.headerHeight || 0;
          const step = info.step || 0;

          // 计算元素在当前 viewport 中的可见范围（CSS px，相对 viewport top）
          let visibleTop = Math.max(0, elemTop - captureTop);
          const visibleBottom = Math.min(
            viewportHeight,
            elemTop + elemTotalHeight - captureTop
          );
          let visibleHeight = Math.max(0, visibleBottom - visibleTop);

          // 如果是后续段（step > 0）并且有 headerHeight，裁掉 header 部分（避免重复顶栏）
          if (step > 0 && headerHeight) {
            const cropStart = Math.max(visibleTop, headerHeight);
            visibleHeight = Math.max(0, visibleBottom - cropStart);
            visibleTop = cropStart;
          }

          if (visibleHeight <= 0) {
            // 这张截图没有包含推文区域（可能越界），报告为失败（content 可选择跳过）
            sendResponse({
              success: false,
              error: "no visible area in this capture",
              step,
            });
            return;
          }

          // 源图上的像素坐标（device pixels）
          const srcX = Math.round((elemLeft - captureLeft) * dpr);
          const srcY = Math.round(visibleTop * dpr);
          const srcW = Math.round(elemWidth * dpr);
          const srcH = Math.round(visibleHeight * dpr);

          // 边界保护（防止越界）
          const safeSrcX = Math.max(0, Math.min(bitmap.width, srcX));
          const safeSrcY = Math.max(0, Math.min(bitmap.height, srcY));
          const safeSrcW = Math.max(0, Math.min(bitmap.width - safeSrcX, srcW));
          const safeSrcH = Math.max(
            0,
            Math.min(bitmap.height - safeSrcY, srcH)
          );

          if (safeSrcW <= 0 || safeSrcH <= 0) {
            sendResponse({
              success: false,
              error: "safe crop dims invalid",
              step,
            });
            return;
          }

          // 裁切到一个新的 canvas（已是 element width x visibleHeight）
          // —— 关键：输出 canvas 按 scale 放大（而不是改变 src） ——
          const outputWidth = Math.round(safeSrcW * scale);
          const outputHeight = Math.round(safeSrcH * scale);

          const cropCanvas = new OffscreenCanvas(outputWidth, outputHeight);
          const cctx = cropCanvas.getContext("2d");

          // 提高缩放质量
          cctx.imageSmoothingEnabled = true;
          cctx.imageSmoothingQuality = "high";

          cctx.drawImage(
            bitmap,
            safeSrcX,
            safeSrcY,
            safeSrcW,
            safeSrcH,
            0,
            0,
            outputWidth,
            outputHeight
          );

          // 导出为 dataUrl 并返回（同时返回像素高度用于 merge）
          const croppedBlob = await cropCanvas.convertToBlob({
            type: "image/png",
          });
          const reader = new FileReader();
          reader.onloadend = () => {
            // 保存调试
            /*             chrome.downloads.download({
              url: dataUrl,
              filename: `partialShot_step${request.elementInfo?.step || 0}.png`,
              saveAs: false,
            }); */
            sendResponse({ success: true, dataUrl: reader.result });
          };
          reader.readAsDataURL(croppedBlob);
        } catch (err) {
          console.error("partialShot crop error:", err);
          sendResponse(null);
        }
      }
    );

    return true; // 异步
  }

  if (request.action === "mergeShot") {
    const {
      captures,
      elementInfo,
      totalHeight,
      handle,
      tweetlink,
      userId,
      filename,
      save2Files,
      choice,
    } = request;
    const dpr = elementInfo.devicePixelRatio || 1;
    const cropWidth = elementInfo.width * dpr;
    const totalHeightPx = totalHeight * dpr;

    // 阴影设置
    const shadowBlur = 16 * dpr;
    const shadowOffset = 8 * dpr;
    const radius = 20 * dpr;
    const xOffset = shadowBlur;
    const yOffset = shadowBlur;

    const canvas = new OffscreenCanvas(
      cropWidth + shadowBlur * 2,
      totalHeightPx + shadowBlur * 2
    );
    const ctx = canvas.getContext("2d");

    Promise.all(
      captures.map((c) =>
        fetch(c.dataUrl)
          .then((r) => r.blob())
          .then((b) => createImageBitmap(b))
      )
    )
      .then((bitmaps) => {
        // 使用每段位图的像素尺寸来决定最终画布
        const cropWidthPx = Math.max(...bitmaps.map((b) => b.width));
        const totalHeightPx = bitmaps.reduce((sum, b) => sum + b.height, 0);

        const baseDpr = elementInfo.devicePixelRatio || 1;
        const scale = elementInfo.scale || 1;
        const scaledFactor = baseDpr * scale; // 用于决定阴影/圆角/Logo 等的像素级尺寸

        const shadowBlur = Math.round(16 * scaledFactor);
        const shadowOffset = Math.round(8 * scaledFactor);
        const radius = Math.round(20 * scaledFactor);
        const xOffset = shadowBlur;
        const yOffset = shadowBlur;

        const canvas = new OffscreenCanvas(
          cropWidthPx + shadowBlur * 2,
          totalHeightPx + shadowBlur * 2
        );
        const ctx = canvas.getContext("2d");

        // 1. 绘制白色带阴影的圆角背景（使用 cropWidthPx & totalHeightPx）
        ctx.save();
        ctx.fillStyle = "white";
        ctx.shadowColor = "rgba(0,0,0,0.25)";
        ctx.shadowBlur = shadowBlur;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = shadowOffset;

        ctx.beginPath();
        ctx.moveTo(xOffset + radius, yOffset);
        ctx.lineTo(xOffset + cropWidthPx - radius, yOffset);
        ctx.quadraticCurveTo(
          xOffset + cropWidthPx,
          yOffset,
          xOffset + cropWidthPx,
          yOffset + radius
        );
        ctx.lineTo(xOffset + cropWidthPx, yOffset + totalHeightPx - radius);
        ctx.quadraticCurveTo(
          xOffset + cropWidthPx,
          yOffset + totalHeightPx,
          xOffset + cropWidthPx - radius,
          yOffset + totalHeightPx
        );
        ctx.lineTo(xOffset + radius, yOffset + totalHeightPx);
        ctx.quadraticCurveTo(
          xOffset,
          yOffset + totalHeightPx,
          xOffset,
          yOffset + totalHeightPx - radius
        );
        ctx.lineTo(xOffset, yOffset + radius);
        ctx.quadraticCurveTo(xOffset, yOffset, xOffset + radius, yOffset);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        // 2. 剪切成圆角矩形路径（和上面一样）
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(xOffset + radius, yOffset);
        ctx.lineTo(xOffset + cropWidthPx - radius, yOffset);
        ctx.quadraticCurveTo(
          xOffset + cropWidthPx,
          yOffset,
          xOffset + cropWidthPx,
          yOffset + radius
        );
        ctx.lineTo(xOffset + cropWidthPx, yOffset + totalHeightPx - radius);
        ctx.quadraticCurveTo(
          xOffset + cropWidthPx,
          yOffset + totalHeightPx,
          xOffset + cropWidthPx - radius,
          yOffset + totalHeightPx
        );
        ctx.lineTo(xOffset + radius, yOffset + totalHeightPx);
        ctx.quadraticCurveTo(
          xOffset,
          yOffset + totalHeightPx,
          xOffset,
          yOffset + totalHeightPx - radius
        );
        ctx.lineTo(xOffset, yOffset + radius);
        ctx.quadraticCurveTo(xOffset, yOffset, xOffset + radius, yOffset);
        ctx.closePath();
        ctx.clip();

        // 3. 逐段按位图实际像素 1:1 绘制（**不要**再按 cropWidth 拉伸）
        let currentY = 0;
        for (const bmp of bitmaps) {
          ctx.drawImage(
            bmp,
            0,
            0,
            bmp.width,
            bmp.height,
            xOffset,
            yOffset + currentY,
            bmp.width,
            bmp.height
          );
          currentY += bmp.height;
        }

        // 4. 绘制右上角 Logo（按 scaledFactor 缩放）
        const logoSize = Math.round(35 * scaledFactor);
        const logoMargin = Math.round(5 * scaledFactor);
        const logoUrl = chrome.runtime.getURL("public/128.png");

        fetch(logoUrl)
          .then((res) => res.blob())
          .then((blob) => createImageBitmap(blob))
          .then((logoBitmap) => {
            ctx.drawImage(
              logoBitmap,
              xOffset + cropWidthPx - logoSize - logoMargin,
              yOffset + logoMargin,
              logoSize,
              logoSize
            );
          })
          .then(async () => {
            ctx.restore(); // 裁剪结束

            // 释放 bitmap 资源
            bitmaps.forEach(b => b.close?.());

            // 5. 导出并下载
            const mergedBlob = await canvas.convertToBlob({
              type: "image/png",
              quality: 1,
            });

            // 保存 Blob 到 IndexedDB
            await saveScreenshotToDB(
              mergedBlob,
              handle,
              userId,
              filename,
              tweetlink
            );

            if (!save2Files) {
              // 仅保存到内置数据库：直接响应（原代码此处漏响应，调用方会挂起直到端口超时）
              sendResponse({ success: true, savedToDB: true });
              return canvas;
            }

            if (save2Files) {
              const reader = new FileReader();
              reader.onload = () => {
                if (choice) {
                  uploadToWebDAV(mergedBlob, filename, handle)
                    .then((res) => {
                      if (res.ok) {
                        console.log("图片上传到 WebDAV 成功！");
                        sendResponse({
                          success: true,
                          text: "上传到 WebDAV 成功！",
                        });
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
                      filename: `XMark/Screenshot/${handle}/${filename}`,
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
                        sendResponse({
                          success: true,
                          text: "成功保存到本地！",
                        });
                      }
                    }
                  );
                }
              };
              reader.readAsDataURL(mergedBlob);
            }
          });

        return canvas;
      })
      .catch((err) => {
        console.error("mergeShot error:", err);
        sendResponse({ success: false, error: err?.message || String(err) });
      });

    return true; // 异步响应
  }

  if (request.action === "getScreenshotCountByUserId") {
    getScreenshotCountByUserId(request.userId)
      .then((res) => {
        sendResponse({ success: true, data: res });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    return true; // 表示异步 sendResponse
  }

  if (request.action === "getUserIdinDB") {
    getUserIdinDB(request.username)
      .then((res) => {
        sendResponse({ success: true, data: res });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    return true; // 表示异步 sendResponse
  }

  if (request.action === "openTimelineWithUserId") {
    chrome.storage.local.set({ filterUserId: request.finalId }, () => {
      chrome.tabs.create({ url: "timeline.html" });
    });
  }
});

// 处理 WebDAV 请求（带安全校验：方法白名单 + URL 必须落在用户配置的 WebDAV 服务器下）
async function handleWebDAVRequest(request, sendResponse) {
  try {
    const { url, method, headers, body } = request;

    // 安全校验：方法白名单
    if (!WEBDAV_METHODS.has((method || "").toUpperCase())) {
      sendResponse({ success: false, error: "方法不被允许" });
      return;
    }

    // 安全校验：URL 必须落在用户配置的 WebDAV 服务器下（防止 SSRF）
    const { webdavConfig } = await chrome.storage.local.get(["webdavConfig"]);
    const norm = (u) => (typeof u === "string" ? u.replace(/\/+$/, "") : "");
    const cfgBase = norm(webdavConfig && webdavConfig.url);
    const reqBase = norm(url);
    if (
      !cfgBase ||
      (reqBase !== cfgBase && !reqBase.startsWith(cfgBase + "/"))
    ) {
      sendResponse({
        success: false,
        error: "URL 不在 WebDAV 服务器范围内",
      });
      return;
    }

    const response = await fetchWithTimeout(url, {
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

// ========== 播客面板：offscreen 生命周期 + 消息路由（podcast.js / offscreen.js 消费） ==========
const POD_OFFSCREEN_URL = "offscreen.html";

async function hasPodOffscreen() {
  const ctx = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(POD_OFFSCREEN_URL)],
  });
  return ctx.length > 0;
}

async function ensurePodOffscreen() {
  if (await hasPodOffscreen()) return;
  try {
    await chrome.offscreen.createDocument({
      url: POD_OFFSCREEN_URL,
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Podcast audio playback decoupled from page lifecycle",
    });
  } catch (e) {
    // 并发创建竞态：已存在即视为成功
    if (!/single offscreen|existing offscreen/i.test(String(e?.message || e))) throw e;
  }
}

async function toPodOffscreen(payload) {
  const existed = await hasPodOffscreen();
  await ensurePodOffscreen();
  // 非 play 用途（RSS 解析等）新建的文档无 audio 事件 → 无 pause → 永不触发回收 alarm。
  // 僵尸防护：本次是新建且命令不是 play，就挂短 alarm 兜底回收；play 后由 pause 事件
  // 设的 10min alarm 自然接管（同名 alarm 重设）
  if (!existed && payload.cmd !== "play") {
    chrome.alarms.create("podcast-offscreen-reap", { delayInMinutes: 2 });
  }
  return chrome.runtime.sendMessage({ ...payload, target: "offscreen" });
}

async function handlePodcastMessage(req, _sender, sendResponse) {
  try {
    if (req.action === "podControl") {
      if (req.cmd === "play") {
        await ensurePodOffscreen(); // play 前必须先建（消息要有人接）
        // 持久化 lastPlay payload：暂停 10min 引擎回收后，迷你条 toggle 用它重放续播
        const pp = (await chrome.storage.local.get(["podcastPlayer"])).podcastPlayer || {};
        await chrome.storage.local.set({
          podcastPlayer: {
            ...pp,
            lastPlay: {
              audioUrl: req.audioUrl,
              key: req.key,
              feedTitle: req.feedTitle,
              epTitle: req.epTitle,
              cover: req.cover,
              rate: req.rate,
            },
          },
        });
        // 播放计数（历史视图统计）：play 一次 +1
        const stats0 = (await chrome.storage.local.get(["podcastStats"])).podcastStats || {};
        const st0 = stats0[req.key] || { plays: 0, listened: 0 };
        st0.plays += 1;
        stats0[req.key] = st0;
        await chrome.storage.local.set({ podcastStats: stats0 });
        sendResponse(await toPodOffscreen(req));
        return;
      }
      if (!(await hasPodOffscreen())) {
        // 引擎已回收（暂停超 10min）：toggle 用 lastPlay + 已存进度重放；其他命令静默应答。
        // （不凭空建空 offscreen——否则 play() 无源被静默吞、还因无 pause 事件失去回收 alarm）
        if (req.cmd === "toggle") {
          const { podcastPlayer = {}, podcastProgress = {} } = await chrome.storage.local.get([
            "podcastPlayer",
            "podcastProgress",
          ]);
          const lp = podcastPlayer.lastPlay;
          if (lp?.audioUrl) {
            await ensurePodOffscreen();
            sendResponse(
              await toPodOffscreen({
                action: "podControl",
                cmd: "play",
                ...lp,
                pos: podcastProgress[lp.key]?.pos || 0,
                rate: podcastPlayer.rate || lp.rate || 1,
              })
            );
            return;
          }
        }
        sendResponse({ ok: false });
        return;
      }
      sendResponse(await toPodOffscreen(req));
      return;
    }
    if (req.action === "podGetState") {
      if (!(await hasPodOffscreen())) {
        sendResponse({ playing: false, key: "", epTitle: "", feedTitle: "", cover: "", pos: 0, dur: 0, rate: 1 });
      } else {
        sendResponse(await toPodOffscreen({ action: "podGetState" }));
      }
      return;
    }
    if (req.action === "podFetchFeed" || req.action === "podDiscoverRss") {
      await ensurePodOffscreen(); // RSS 解析器在 offscreen（SW 无 DOMParser）
      sendResponse(await toPodOffscreen(req));
      return;
    }
    if (req.action === "podSubAdd") {
      const { podcastSubs = [] } = await chrome.storage.local.get(["podcastSubs"]);
      if (podcastSubs.some((s) => s.url === req.url)) {
        sendResponse({ ok: false, dup: true });
        return;
      }
      podcastSubs.push({
        id: Date.now().toString(),
        url: req.url,
        title: req.title || req.url,
        cover: req.cover || "",
        link: req.link || "",
        addedAt: Date.now(),
      });
      await chrome.storage.local.set({ podcastSubs });
      sendResponse({ ok: true });
      return;
    }
    if (req.action === "podSave") {
      // 引擎进度代写（offscreen 无 chrome.storage）
      const { podcastProgress = {} } = await chrome.storage.local.get(["podcastProgress"]);
      if (req.key) {
        const prev = podcastProgress[req.key] || {};
        podcastProgress[req.key] = {
          ...prev, // 保留已落元数据（老条目嗅探兼容：缺 audioUrl 的历史条目不可续播）
          pos: req.pos,
          dur: req.dur,
          updatedAt: Date.now(),
          done: req.done,
          feedTitle: req.feedTitle || prev.feedTitle || "",
          epTitle: req.epTitle || prev.epTitle || "",
          cover: req.cover || prev.cover || "",
          audioUrl: req.audioUrl || prev.audioUrl || "",
        };
        const keys = Object.keys(podcastProgress).sort(
          (a, b) => podcastProgress[a].updatedAt - podcastProgress[b].updatedAt
        );
        while (keys.length > 200) delete podcastProgress[keys.shift()]; // LRU ≤200
      }
      const pp = (await chrome.storage.local.get(["podcastPlayer"])).podcastPlayer || {};
      await chrome.storage.local.set({
        podcastProgress,
        podcastPlayer: {
          ...pp, // 保留 lastPlay（play 时写入，toggle 兜底重放消费）
          currentKey: req.done ? "" : req.key,
          rate: req.rate,
          volume: req.volume,
        },
      });
      // 收听时长累计（历史视图统计）
      if (req.delta > 0) {
        const stats = (await chrome.storage.local.get(["podcastStats"])).podcastStats || {};
        const st = stats[req.key] || { plays: 0, listened: 0 };
        st.listened += req.delta;
        stats[req.key] = st;
        await chrome.storage.local.set({ podcastStats: stats });
      }
      sendResponse({ ok: true });
      return;
    }
    if (req.action === "podSubRemove") {
      const { podcastSubs = [] } = await chrome.storage.local.get(["podcastSubs"]);
      await chrome.storage.local.set({ podcastSubs: podcastSubs.filter((s) => s.id !== req.id) });
      sendResponse({ ok: true });
      return;
    }
    sendResponse({ ok: false });
  } catch (e) {
    // 所有分支必应答（项目已知坑：分支漏 sendResponse 会挂起调用方 Promise）
    sendResponse({ ok: false, error: String(e?.message || e) });
  }
}

// offscreen 空闲信号：podIdle 设 10min 回收 alarm；podActive 清（恢复播放即取消回收）
// podStateFromEngine：引擎事件态中转到各 X 标签页（offscreen 无 chrome.tabs，广播必经 SW；
//   仅事件级频率——play/pause/seek/skip/rate/ended/error，秒级进度由 content 本地时钟推算）
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "podIdle") chrome.alarms.create("podcast-offscreen-reap", { delayInMinutes: 10 });
  if (msg.action === "podActive") chrome.alarms.clear("podcast-offscreen-reap");
  if (msg.action === "podStateFromEngine") {
    const { action, ...state } = msg;
    chrome.tabs.query(
      { url: ["https://x.com/*", "https://twitter.com/*", "https://pro.x.com/*"] },
      (tabs) => {
        for (const tab of tabs) {
          chrome.tabs.sendMessage(tab.id, { action: "podState", ...state }).catch(() => {});
        }
      }
    );
  }
  return false; // 不占 sendResponse 通道
});

// ===== 关注变动追踪（v6.6.0，follow-main.js / follow-collect.js / popup 消费）=====
// 编排：启动 10min 后便捷采集（今日未采才跑）+ 6h 巡逻兜底跨天；采集 = 后台 tab 开自己
// following/followers 页自动滚到底（fetch hook 截响应）；phase 为原子单位——中断后已完成
// 的 phase 保留、未完成的整个重跑（翻页 cursor 在页面内存，tab 关即失效）；每批即时落
// storage（SW 休眠安全）。落库走增量：首日 base，之后每日 delta（见 utils/db.js）。

const todayKey = () => dayKey(Date.now());

async function ftGet() {
  return (await chrome.storage.local.get("followTrack")).followTrack || {
    state: "idle",
    phasesDone: [],
    following: [],
    followers: [],
  };
}
async function ftSet(patch) {
  const next = { ...(await ftGet()), ...patch };
  await chrome.storage.local.set({ followTrack: next });
  return next;
}
async function ftSummary(patch) {
  const cur =
    (await chrome.storage.local.get("followSummary")).followSummary || {};
  const next = { ...cur, ...patch };
  await chrome.storage.local.set({ followSummary: next });
  return next;
}

function followNotify(id, message) {
  // 通知文案写死中文（仅用户本人可见，不引入 lang 依赖）
  chrome.notifications
    .create(id, {
      type: "basic",
      iconUrl: "/public/128.png",
      title: "XMark 关注变动",
      message,
    })
    .catch(() => {});
}

// 通知点击 → 打开详情页
chrome.notifications.onClicked.addListener((id) => {
  if (id === "ftStart" || id === "ftDone" || id === "ftFail") {
    chrome.tabs
      .create({ url: chrome.runtime.getURL("follows.html") })
      .catch(() => {});
  }
});

async function startFollowCollection(force = false) {
  const track = await ftGet();
  const today = todayKey();
  // 已在采集：tab 活着则跳过（挂了则转中断续跑）
  if (track.state === "collecting" && track.tabId) {
    try {
      await chrome.tabs.get(track.tabId);
      return; // 采集中，勿重复开 tab
    } catch (_) {
      await ftSet({ state: "interrupted" });
    }
  }
  if (!force && track.state === "done" && track.day === today) return;
  // 断点续跑：同日中断保留已完成 phase；跨天残数据作废重来
  const resume = track.state === "interrupted" && track.day === today;
  const phasesDone = resume ? track.phasesDone || [] : [];
  const following =
    resume && phasesDone.includes("following") ? track.following : [];
  const handle = track.handle || "";
  const startPhase =
    phasesDone.includes("following") && following.length ? "followers" : "following";
  await ftSet({
    state: "collecting",
    day: today,
    phasesDone,
    following,
    followers: [], // followers 永远从头采（完成即 finish，不存在"followers 已完成未 finish"态）
    handle,
    phase: null,
    err: "",
    tabId: null,
    startedAt: Date.now(),
  });
  await ftSummary({
    day: today,
    state: "collecting",
    phase: "",
    cur: 0,
    total: 0,
  });
  chrome.alarms.create("followTick", { periodInMinutes: 0.5 });
  followNotify("ftStart", "正在后台采集关注数据，期间请保持浏览器运行");
  // xmark-ft 标记：listcol/xfinder 识别后不激活（采集 tab 纯净，iframe 请求不掺采集链路）
  const url = handle
    ? `https://x.com/${handle}/${startPhase}?xmark-ft=1`
    : "https://x.com/home?xmark-ft=1"; // 无 handle：先开 home 由 content 扒自己 handle
  const tab = await chrome.tabs.create({ url, active: false });
  await ftSet({ tabId: tab.id });
}

async function failFollow(reason) {
  const track = await ftGet();
  await ftSet({ state: "failed", err: reason, phase: null, tabId: null });
  await ftSummary({ state: "failed", err: reason });
  chrome.alarms.clear("followTick");
  if (track.tabId) chrome.tabs.remove(track.tabId).catch(() => {});
  const MSG = {
    login: "未登录 X",
    timeout: "超时截断，稍后自动重试",
    nodata: "未捕获到数据（X 接口可能变动）",
  };
  followNotify("ftFail", `采集失败（${MSG[reason] || reason}），可从扩展弹窗手动重试`);
}

// 当前态聚合直方图（finish 时内存全量现算，嵌进快照 rec.agg）
// c=三计数；vg/vf=蓝标数；pf=锁推数；zf=零推文数；rf=关注比异常数(fg>2000 且 fg/fr>10)；
// tf=粉丝量级 6 桶（<10/<100/<1K/<1万/<10万/≥10万）；af=账龄 5 桶（<90天/<1年/<3年/<6年/≥6年）
function buildFollowAgg(following, followers) {
  const TIER_EDGES = [10, 100, 1e3, 1e4, 1e5, Infinity];
  const AGE_EDGES = [90, 365, 1095, 2190, Infinity];
  const tf = new Array(TIER_EDGES.length).fill(0);
  const af = new Array(AGE_EDGES.length).fill(0);
  let mutual = 0;
  let vg = 0;
  const fIds = new Set(followers.map((u) => u.id));
  for (const u of following) {
    if (u.v) vg++;
    if (fIds.has(u.id)) mutual++;
  }
  let vf = 0,
    pf = 0,
    zf = 0,
    rf = 0;
  const today = Math.floor(Date.now() / 864e5);
  for (const u of followers) {
    if (u.v) vf++;
    if (u.p) pf++;
    if (!u.tw) zf++;
    if (u.fg > 2000 && u.fg / (u.fr || 1) > 10) rf++;
    tf[TIER_EDGES.findIndex((e) => (u.fr || 0) < e)]++;
    af[AGE_EDGES.findIndex((e) => today - (u.ca || today) < e)]++;
  }
  return { c: { g: following.length, f: followers.length, m: mutual }, vg, vf, pf, zf, rf, tf, af };
}

async function finishFollowCollection() {
  const track = await ftGet();
  const today = todayKey();
  const snaps = await getFollowSnapshots();
  // 与上一次采集对比（跨日/同日均然）：本次结果尚未入库，重放到此刻即上次态；
  // incomplete 记录在重放中自动跳过（基准自动落到更早的有效记录）
  const now = new Date().toISOString();
  const prev = rebuildFollow(snaps, now);
  let counts = null;
  const rec = { id: now, complete: true };
  if (!prev) {
    // 首日基底
    rec.kind = "base";
    rec.following = track.following;
    rec.followers = track.followers;
  } else {
    const fIds = new Set(track.followers.map((u) => u.id));
    const gIds = new Set(track.following.map((u) => u.id));
    const addedF = track.followers.filter((u) => !prev.followers.has(u.id));
    const removedF = [...prev.followers.values()].filter((u) => !fIds.has(u.id));
    const addedG = track.following.filter((u) => !prev.following.has(u.id));
    const removedG = [...prev.following.values()].filter((u) => !gIds.has(u.id));
    rec.kind = "delta";
    rec.added = { following: addedG, followers: addedF };
    rec.removed = { following: removedG, followers: removedF };
    // 互关变动数量（事件明细由详情页从 delta 派生，不落库）
    const mPrev = new Set(
      [...prev.following.keys()].filter((id) => prev.followers.has(id))
    );
    const mToday = new Set([...gIds].filter((id) => fIds.has(id)));
    counts = {
      nf: addedF.length,
      uf: removedF.length,
      nfg: addedG.length,
      nm: [...mToday].filter((id) => !mPrev.has(id)).length,
      lm: [...mPrev].filter((id) => !mToday.has(id)).length,
    };

    // 改名追踪（零体积成本；XMark 备注回落匹配靠 username，改名即断链——预警价值）
    const rnSeen = new Set();
    const renamed = [];
    for (const [list, prevMap] of [
      [track.following, prev.following],
      [track.followers, prev.followers],
    ]) {
      for (const u of list) {
        const old = prevMap.get(u.id);
        if (old && !rnSeen.has(u.id) && (old.h !== u.h || old.n !== u.n)) {
          rnSeen.add(u.id);
          renamed.push({ id: u.id, oh: old.h, nh: u.h, on: old.n, nn: u.n });
        }
      }
    }
    if (renamed.length) rec.renamed = renamed;

    // 升级回填：老 base 用户对象无扩字段（fr/fg/tw/ca），用本次全量新鲜属性一次性补齐
    // （重放链自动带上；幂等——首人已有 fr 字段即跳过。base 里本次已离开的人保留旧值）
    const baseRec = snaps.find((s) => s.kind === "base" && s.complete);
    if (
      baseRec &&
      baseRec.following?.length &&
      baseRec.following[0].fr === undefined
    ) {
      const fmap = new Map(track.followers.map((u) => [u.id, u]));
      const gmap = new Map(track.following.map((u) => [u.id, u]));
      baseRec.following = baseRec.following.map((u) => gmap.get(u.id) || u);
      baseRec.followers = baseRec.followers.map((u) => fmap.get(u.id) || u);
      await saveFollowSnapshot(baseRec);
    }
  }
  // 当前态聚合直方图（嵌本条快照，~500B/次；base 也算，曲线自首日起）。
  // 语义红线：面板「当前态分布」只读 agg（重放态旧属性会随时间失真）；「事件画像」
  // 只用 delta 用户属性（事件时点快照），两者不得混用
  rec.agg = buildFollowAgg(track.following, track.followers);
  await saveFollowSnapshot(rec); // 同日重跑 = put 覆盖（幂等）；增量方案 <1MB/年，不清理
  await ftSet({ state: "done", phase: null, tabId: null });
  await ftSummary({ day: today, state: "done", counts, lastDone: today });
  chrome.alarms.clear("followTick");
  if (track.tabId) chrome.tabs.remove(track.tabId).catch(() => {});
  followNotify(
    "ftDone",
    counts
      ? `采集完成：新粉丝 ${counts.nf} · 取关我 ${counts.uf} · 新关注 ${counts.nfg} · 互关变动 ${counts.nm + counts.lm}`
      : "采集完成：首日基底已建立，明日起开始对比变动"
  );
}

async function onFollowHandle(req, sender) {
  const track = await ftGet();
  if (track.state !== "collecting" || sender.tab?.id !== track.tabId) return;
  if (req.error) return failFollow("login");
  await ftSet({ handle: req.handle });
  await chrome.tabs.update(track.tabId, {
    url: `https://x.com/${req.handle}/following?xmark-ft=1`,
  });
}

async function onFollowPhaseStart(req, sender) {
  const track = await ftGet();
  if (track.state !== "collecting" || sender.tab?.id !== track.tabId) return;
  await ftSummary({ phase: req.kind, total: req.total || 0 });
}

async function onFollowBatch(req, sender) {
  const track = await ftGet();
  if (track.state !== "collecting" || sender.tab?.id !== track.tabId) return;
  const key = req.kind === "following" ? "following" : "followers";
  const seen = new Set((track[key] || []).map((u) => u.id));
  const fresh = (req.users || []).filter((u) => u.id && !seen.has(u.id));
  if (!fresh.length) return;
  await ftSet({ [key]: [...(track[key] || []), ...fresh] }); // 即时落盘（SW 休眠安全）
  await ftSummary({
    day: track.day,
    state: "collecting",
    phase: key,
    cur: req.cur,
    total: req.total || 0,
  });
}

async function onFollowPhaseDone(req, sender) {
  const track = await ftGet();
  if (track.state !== "collecting" || sender.tab?.id !== track.tabId) return;
  if (!req.complete) return failFollow(req.reason || "timeout");
  const phasesDone = [...new Set([...(track.phasesDone || []), req.kind])];
  await ftSet({ phasesDone });
  if (req.kind === "following") {
    await chrome.tabs.update(track.tabId, {
      url: `https://x.com/${track.handle}/followers?xmark-ft=1`,
    });
  } else {
    await finishFollowCollection();
  }
}

async function handleFollowMessage(req, sender, sendResponse) {
  let resp = { ok: true };
  try {
    if (req.action === "followStart") await startFollowCollection(true);
    else if (req.action === "followStatus")
      resp =
        (await chrome.storage.local.get("followSummary")).followSummary || {};
    else if (req.action === "followHandle") await onFollowHandle(req, sender);
    else if (req.action === "followPhaseStart")
      await onFollowPhaseStart(req, sender);
    else if (req.action === "followBatch") await onFollowBatch(req, sender);
    else if (req.action === "followPhaseDone")
      await onFollowPhaseDone(req, sender);
    else resp = { ok: false };
  } catch (e) {
    console.error("[XMark] follow:", e);
    resp = { ok: false, error: String(e?.message || e) };
  }
  sendResponse(resp); // 所有分支必应答（项目已知坑）
}

// tab 导航完成 → 激活采集（页面每次导航文档重建，collect 状态自然清零）
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status !== "complete") return;
  ftGet().then((t) => {
    if (t.state === "collecting" && t.tabId === tabId)
      chrome.tabs.sendMessage(tabId, { cmd: "followActivate" }).catch(() => {});
  });
});

// 采集 tab 被关 → 用户主动取消（浏览器整体关闭不触发 onRemoved，那是 interrupted 链路）。
// cancelled：当日不再自动跑（patrol/kick 跳过），手动「立即采集」随时可重启
chrome.tabs.onRemoved.addListener((tabId) => {
  ftGet().then(async (t) => {
    if (t.state === "collecting" && t.tabId === tabId) {
      await ftSet({ state: "cancelled" });
      await ftSummary({ state: "cancelled" });
      chrome.alarms.clear("followTick");
    }
  });
});

// 便捷采集检查（onStartup 10min 延迟 alarm + 6h 巡逻共用）
async function followKickCheck() {
  const track = await ftGet();
  const today = todayKey();
  if (track.state === "collecting") {
    // SW 重启后 tab 可能还在采：重建踢活 alarm 继续
    if (track.tabId) {
      try {
        await chrome.tabs.get(track.tabId);
        chrome.alarms.create("followTick", { periodInMinutes: 0.5 });
        return;
      } catch (_) {
        await ftSet({ state: "interrupted" });
      }
    }
  }
  if (track.state === "done" && track.day === today) return; // 今日已完成
  if (track.state === "cancelled" && track.day === today) return; // 用户取消：今日不再自动跑
  await startFollowCollection();
}

// 30s 踢活：后台 tab timer 节流兜底（消息执行不受页面 timer 节流）
async function followTickKick() {
  const t = await ftGet();
  if (t.state !== "collecting" || !t.tabId) {
    chrome.alarms.clear("followTick");
    return;
  }
  // 导航间隙 content script 未就绪会 reject——静默（tab 还在，等 onUpdated 再激活）
  chrome.tabs.sendMessage(t.tabId, { cmd: "followTick" }).catch(() => {});
}
