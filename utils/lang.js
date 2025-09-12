let langData = null;

export async function getCurrentLangData() {
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

export function getLang(key) {
  if (!langData) throw new Error("langData not loaded yet");
  return langData[key] || "";
}

export function resetLangData() {
  langData = null;
}

export async function updateTexts() {
  await getCurrentLangData();

  document.querySelectorAll("[data-key]").forEach((el) => {
    const key = el.getAttribute("data-key");
    if (langData[key]) {
      el.textContent = langData[key];
      el.placeholder = langData[key];
    }
  });
  document.querySelectorAll("[data-placeholder-key]").forEach((el) => {
    const key = el.getAttribute("data-placeholder-key");
    if (langData[key]) {
      el.placeholder = langData[key];
    }
  });
  document.querySelectorAll("[data-title-key]").forEach((el) => {
    const key = el.getAttribute("data-title-key");
    if (langData[key]) {
      el.title = langData[key];
    }
  });
}
