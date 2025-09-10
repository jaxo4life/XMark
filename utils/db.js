// db.js
export function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("ScreenshotDB", 4);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      let store;
      if (!db.objectStoreNames.contains("screenshots")) {
        store = db.createObjectStore("screenshots", { keyPath: "id" });
      } else {
        store = e.target.transaction.objectStore("screenshots");
      }

      if (!store.indexNames.contains("userId")) {
        store.createIndex("userId", "userId", { unique: false });
      }
      if (!store.indexNames.contains("dateIdx")) {
        store.createIndex("dateIdx", "date", { unique: false });
      }
    };

    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

// 清空screenshots数据库
export async function clearscreenshots() {
  const db = await openDB(); // 你的 openDB 方法
  const tx = db.transaction("screenshots", "readwrite");
  const store = tx.objectStore("screenshots");

  store.clear(); // 清空所有记录

  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = (e) => reject(e.target.error);
  });

  console.log("screenshots 对象存储已清空");
}

// 保存截图 Blob 到 IndexedDB
export async function saveScreenshotToDB(
  blob,
  handle,
  userId,
  filename,
  tweetlink
) {
  const db = await openDB();
  const tx = db.transaction("screenshots", "readwrite");
  const store = tx.objectStore("screenshots");
  store.put({
    id: Date.now(),
    handle,
    userId,
    blob,
    filename,
    tweetlink,
    date: new Date().toISOString(),
  });
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = (e) => reject(e.target.error);
  });
}

// 手动添加截图
export async function addManualScreenshot({
  blob,
  handle,
  userId,
  filename,
  tweetlink,
}) {
  const db = await openDB();
  const tx = db.transaction("screenshots", "readwrite");
  const store = tx.objectStore("screenshots");
  store.put({
    id: Date.now(), // 唯一ID
    handle,
    userId,
    blob,
    filename,
    tweetlink,
    date: new Date().toISOString(),
  });

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = (e) => reject(e.target.error);
  });
}

// 获取数据库统计数据
export async function getDBStats() {
  const db = await openDB();
  const transaction = db.transaction("screenshots", "readonly");
  const store = transaction.objectStore("screenshots");

  // 获取总记录数
  const totalCount = await new Promise((resolve, reject) => {
    const req = store.count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e.target.error);
  });

  // 获取最早记录
  const earliest = await new Promise((resolve, reject) => {
    const index = store.index("dateIdx"); // 假设索引名是 dateIdx
    const req = index.openCursor(null, "next"); // 正序
    req.onsuccess = (e) =>
      resolve(e.target.result ? new Date(e.target.result.value.date) : null);
    req.onerror = (e) => reject(e.target.error);
  });

  // 获取最新记录
  const latest = await new Promise((resolve, reject) => {
    const index = store.index("dateIdx");
    const req = index.openCursor(null, "prev"); // 倒序
    req.onsuccess = (e) =>
      resolve(e.target.result ? new Date(e.target.result.value.date) : null);
    req.onerror = (e) => reject(e.target.error);
  });

  // 获取独立 userId
  const userIds = new Set();
  await new Promise((resolve, reject) => {
    const req = store.openCursor();
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        if (cursor.value.userId) userIds.add(cursor.value.userId);
        cursor.continue();
      } else {
        resolve();
      }
    };
    req.onerror = (e) => reject(e.target.error);
  });

  return {
    totalCount,
    uniqueUserCount: userIds.size,
    earliest,
    latest,
  };
}

// 辅助函数：Blob -> Base64
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result); // 返回 data URL
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(blob);
  });
}

// ---------- 导出全部截图 ----------
export async function exportScreenshots() {
  const db = await openDB();
  const tx = db.transaction("screenshots", "readonly");
  const store = tx.objectStore("screenshots");

  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = async () => {
      const data = request.result;
      // 转换每条记录的 blob
      const converted = await Promise.all(
        data.map(async (item) => ({
          ...item,
          blob: await blobToBase64(item.blob),
        }))
      );
      resolve(converted);
    };
    request.onerror = (e) => reject(e.target.error);
  });
}

// ---------- 导入截图数据，支持合并 ----------
function dataURLtoBlob(dataURL) {
  const [header, base64] = dataURL.split(",");
  const mime = header.match(/:(.*?);/)[1];
  const binary = atob(base64);
  const array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    array[i] = binary.charCodeAt(i);
  }
  return new Blob([array], { type: mime });
}

export async function importScreenshots(dataArray, options = { merge: true }) {
  const db = await openDB();
  const tx = db.transaction("screenshots", "readwrite");
  const store = tx.objectStore("screenshots");

  return new Promise((resolve, reject) => {
    let count = 0;

    dataArray.forEach((item) => {
      // 先把 blob 从 Data URL 转回 Blob
      if (typeof item.blob === "string") {
        item.blob = dataURLtoBlob(item.blob);
      }

      const request = store.get(item.id);
      request.onsuccess = (e) => {
        const existing = e.target.result;
        if (!existing) {
          store.put(item);
          count++;
        } else if (options.merge) {
          store.put({ ...existing, ...item });
          count++;
        }
      };
      request.onerror = (e) => reject(e.target.error);
    });

    tx.oncomplete = () => resolve(count);
    tx.onerror = (e) => reject(e.target.error);
  });
}

// 导出到json文件
export async function exportToJsonFile() {
  // 先获取全部数据
  const allScreenshots = await exportScreenshots();
  console.log(allScreenshots);
  // 转成 JSON 字符串
  const jsonStr = JSON.stringify(allScreenshots, null, 2);
  console.log(jsonStr);

  // 创建 Blob 并生成下载链接
  const blob = new Blob([jsonStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const now = new Date();
  const pad = (n) => n.toString().padStart(2, "0");
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate()
  )}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const filename = `XMark/Timeline/XMark-Timeline-export-${timestamp}.json`;

  chrome.downloads.download({
    url: url,
    filename: filename,
    saveAs: false,
  });

  // 释放对象 URL
  URL.revokeObjectURL(url);
}

// 从jason文件导入
export function importFromJsonFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target.result);
        // 导入数据库并合并
        const count = await importScreenshots(data, { merge: true });
        resolve(count);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsText(file);
  });
}

// 根据 userId 删除单条截图记录
export async function deleteScreenshotById(id) {
  const db = await openDB();
  const tx = db.transaction("screenshots", "readwrite");
  const store = tx.objectStore("screenshots");

  store.delete(id);

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = (e) => reject(e.target.error);
  });
}

// 根据 userId 删除 IndexedDB 里的截图记录
export async function deleteAllScreenshotsById(userId, deleteAll = false) {
  const db = await openDB();
  const tx = db.transaction("screenshots", "readwrite");
  const store = tx.objectStore("screenshots");
  const index = store.index("userId");

  return new Promise((resolve, reject) => {
    // 获取所有该 userId 的记录
    const request = index.getAllKeys(userId);

    request.onsuccess = () => {
      const keys = request.result;
      if (!keys.length) {
        resolve(0); // 没有找到
        return;
      }

      if (deleteAll) {
        // 删除所有匹配的记录
        keys.forEach((key) => store.delete(key));
      } else {
        // 只删除第一条
        store.delete(keys[0]);
      }

      tx.oncomplete = () => resolve(deleteAll ? keys.length : 1);
      tx.onerror = (e) => reject(e.target.error);
    };

    request.onerror = (e) => reject(e.target.error);
  });
}

// 获取所有截图
export async function getAllScreenshots() {
  const db = await openDB();
  const tx = db.transaction("screenshots", "readonly");
  const store = tx.objectStore("screenshots");
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

// 根据 userId 获取截图
export async function getScreenshotsByUserId(userId) {
  const db = await openDB();
  const tx = db.transaction("screenshots", "readonly");
  const store = tx.objectStore("screenshots");
  const index = store.index("userId");
  return new Promise((resolve, reject) => {
    const request = index.getAll(userId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

// 查询某个 userId 的截图数量
export async function getScreenshotCountByUserId(userId) {
  const screenshots = await getScreenshotsByUserId(userId);
  return screenshots.length;
}

// 高效获取所有 userId
export async function getAllUserIds() {
  const db = await openDB();
  const tx = db.transaction("screenshots", "readonly");
  const store = tx.objectStore("screenshots");
  const index = store.index("userId");

  return new Promise((resolve, reject) => {
    const request = index.getAllKeys(); // 直接获取索引所有 key
    request.onsuccess = () => {
      // 去重，因为可能同一个 userId 有多条截图
      const uniqueUserIds = Array.from(new Set(request.result));
      resolve(uniqueUserIds);
    };
    request.onerror = (e) => reject(e.target.error);
  });
}

// 获取userId的note
export async function getUserNote(userId) {
  const result = await chrome.storage.local.get(["twitterNotes"]);
  const notes = result.twitterNotes || {};
  return notes[userId] || null;
}

// 获取每日截图数 { date: count }
export async function getDailyActivity() {
  const db = await openDB();
  const tx = db.transaction("screenshots", "readonly");
  const store = tx.objectStore("screenshots");

  const counts = {};
  await new Promise((resolve, reject) => {
    const req = store.index("dateIdx").openCursor();
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        const d = new Date(cursor.value.date);
        const day = d.toISOString().slice(0, 10); // YYYY-MM-DD
        counts[day] = (counts[day] || 0) + 1;
        cursor.continue();
      } else {
        resolve();
      }
    };
    req.onerror = (e) => reject(e.target.error);
  });

  return counts;
}

// 只从db数据库查找userId
export async function getUserIdinDB(handle) {
  const db = await openDB();
  const tx = db.transaction("screenshots", "readonly");
  const store = tx.objectStore("screenshots");
  const index = store.index("userId"); 
  let userId = null;

  // 遍历所有记录，找到匹配 handle 的 userId
  await new Promise((resolve) => {
    const req = store.openCursor();
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        const record = cursor.value;
        if (record.handle === handle) {
          userId = record.userId;
          resolve(); // 找到就结束
          return;
        }
        cursor.continue();
      } else {
        resolve(); // 遍历完也没找到
      }
    };
    req.onerror = () => resolve();
  });

  if (userId) return userId;
}

// 根据 handle 获取 userId
export async function getUserId(handle) {
  // 1️⃣ 先查 IndexedDB screenshots 表
  const db = await openDB();
  const tx = db.transaction("screenshots", "readonly");
  const store = tx.objectStore("screenshots");
  const index = store.index("userId"); // 这里我们要用 handle 查询，假设截图条目里有 handle 字段
  let userId = null;

  // 遍历所有记录，找到匹配 handle 的 userId
  await new Promise((resolve) => {
    const req = store.openCursor();
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        const record = cursor.value;
        if (record.handle === handle) {
          userId = record.userId;
          resolve(); // 找到就结束
          return;
        }
        cursor.continue();
      } else {
        resolve(); // 遍历完也没找到
      }
    };
    req.onerror = () => resolve();
  });

  if (userId) return userId;

  // 2️⃣ 再查 twitterNotes
  const result = await chrome.storage.local.get(["twitterNotes"]);
  const notes = result.twitterNotes || {};
  const note = Object.values(notes).find((n) => n.username === handle);
  if (note) return note.userId;

  // 3️⃣ 都没找到就自动开 tab 提取
  return await fetchUserIdByOpeningTab(handle);
}

// 通过 tab 提取
async function fetchUserIdByOpeningTab(handle) {
  return new Promise((resolve) => {
    chrome.tabs.create({ url: `https://x.com/${handle}`, active: true }, (tab) => {
      const tabId = tab.id;
      let timedOut = false;

      const timeout = setTimeout(() => {
        timedOut = true;
        chrome.tabs.remove(tabId, () => resolve(null));
      }, 10000); // 10秒超时

      function listener(updatedTabId, changeInfo) {
        if (updatedTabId !== tabId) return;
        if (changeInfo.status === "complete") {
          // 页面 HTML 加载完成后，再等 1s 让 JS 执行
          setTimeout(() => {
            chrome.scripting.executeScript(
              {
                target: { tabId },
                func: (username) => {
                  const scripts = document.querySelectorAll("script");
                  for (const script of scripts) {
                    if (script.textContent.includes(`"additionalName":"${username}"`)) {
                      const match = script.textContent.match(/"identifier":"(\d+)"/);
                      if (match) return match[1];
                    }
                    const restMatch = script.textContent.match(/"rest_id":"(\d+)"/);
                    if (restMatch) return restMatch[1];
                  }
                  return null;
                },
                args: [handle],
              },
              (results) => {
                clearTimeout(timeout);
                chrome.tabs.onUpdated.removeListener(listener);
                chrome.tabs.remove(tabId, () => {
                  resolve(results[0]?.result || null);
                });
              }
            );
          }, 1500); // 等 1.5s
        }
      }

      chrome.tabs.onUpdated.addListener(listener);
    });
  });
}
