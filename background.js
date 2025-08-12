// Twitter Notes Background Script

chrome.runtime.onInstalled.addListener(() => {
  console.log("Twitter Notes 扩展已安装");
});

// 监听存储变化，可以用于同步等功能
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "local" && changes.twitterNotes) {
    console.log("备注数据已更新");
  }
});

// 处理来自content script的消息
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
});
