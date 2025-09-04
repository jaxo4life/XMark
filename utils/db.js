// db.js
export function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ScreenshotDB', 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('screenshots')) {
        db.createObjectStore('screenshots', { keyPath: 'id' });
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

// 保存截图 Blob 到 IndexedDB
export async function saveScreenshotToDB(blob, handle, userId, filename) {
  const db = await openDB();
  const tx = db.transaction('screenshots', 'readwrite');
  const store = tx.objectStore('screenshots');
  await store.put({
    id: Date.now(),
    handle,
    userId,
    blob,
    filename,
    date: new Date().toISOString()
  });
  await tx.done;
}

// 获取所有截图
export async function getAllScreenshots() {
  return new Promise(async (resolve, reject) => {
    const db = await openDB();
    const tx = db.transaction('screenshots', 'readonly');
    const store = tx.objectStore('screenshots');
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
}
