/**
 * XMark · 播客 offscreen 引擎（隐藏文档：audio 播放 + RSS fetch/解析 + 进度心跳）
 *
 * 生命周期：background 惰性创建（首次 play）；暂停 10min 由 bg alarm 回收
 *   （chrome.offscreen.closeDocument 仅 background 可调，本页不能自杀）。
 * 状态广播：事件驱动（offscreen 无 chrome.tabs），经 background 中转到 X 标签页；
 *   秒级进度不广播（避免每秒唤醒 SW）——content 侧本地时钟推算、事件时校准。
 * 进度持久化：offscreen 无 chrome.storage（只有 runtime+DOM），心跳经消息由 bg 代写
 *   （30s 节流；pause/ended/换集前即时落盘）。
 */
"use strict";

const audio = document.getElementById("pod-audio");
const FEED_TTL = 5 * 60 * 1000; // RSS 内存缓存 5 分钟
const HEARTBEAT_MS = 30000; // 进度心跳节流（经消息走 bg，降频减少 SW 唤醒）
const MAX_EPISODES = 50; // feed 截断（大 feed 只留最近 50 集，解析后即释放 DOM）

const feedCache = new Map(); // url -> {data, fetchedAt}
let cur = null; // {key, feedTitle, epTitle, cover, audioUrl, dur(feed 时长，直通 UI 防 duration 推断滞后)}
let lastHeartbeat = 0;

// ---------- 进度落盘（offscreen 无 chrome.storage：经消息由 bg 代写） ----------
let lastPos = -1; // 上次心跳的 currentTime（算收听增量；换集/seek 防污染）
function saveProgress(final = false) {
  if (!cur) return;
  const posNow = Math.floor(audio.currentTime);
  // 收听时长增量：同集内 currentTime 前进量；0<delta<120 才计（防 seek 跳变/换集污染）
  const delta =
    lastPos >= 0 && posNow > lastPos && posNow - lastPos < 120 ? posNow - lastPos : 0;
  lastPos = final ? -1 : posNow;
  chrome.runtime
    .sendMessage({
      action: "podSave",
      key: cur.key,
      pos: final ? 0 : posNow,
      dur: Math.floor(audio.duration || 0),
      done: final,
      rate: audio.playbackRate,
      volume: audio.volume,
      delta,
      // 元数据随进度落盘（历史视图「继续听」直接可用，不依赖 feedData 缓存）
      feedTitle: cur.feedTitle,
      epTitle: cur.epTitle,
      cover: cur.cover,
      audioUrl: cur.audioUrl,
    })
    .catch(() => {});
}

// ---------- 状态广播（事件驱动：offscreen 无 chrome.tabs，经 background 中转到 X 标签页） ----------
// 秒级进度不广播（避免每秒唤醒 SW）——content 侧本地时钟推算，事件时校准。
function broadcast(extra = {}) {
  chrome.runtime
    .sendMessage({
      action: "podStateFromEngine",
      playing: !audio.paused,
      key: cur?.key || "",
      epTitle: cur?.epTitle || "",
      feedTitle: cur?.feedTitle || "",
      cover: cur?.cover || "",
      pos: Math.floor(audio.currentTime),
      // duration 滞后对策：audio.duration 未就绪/推断中（流式 VBR mp3 无 X-Content-Duration 头时
      // Chrome 边播边修正）先用 feed 的 itunes:duration 直通，元数据到了自然覆盖
      dur: Math.floor(audio.duration) || cur?.dur || 0,
      rate: audio.playbackRate,
      ...extra,
    })
    .catch(() => {});
}

audio.addEventListener("timeupdate", () => {
  const now = Date.now();
  if (now - lastHeartbeat >= HEARTBEAT_MS) {
    lastHeartbeat = now;
    saveProgress();
  }
});
audio.addEventListener("play", () => {
  chrome.runtime.sendMessage({ action: "podActive" }).catch(() => {});
  broadcast();
});
audio.addEventListener("pause", () => {
  chrome.runtime.sendMessage({ action: "podIdle" }).catch(() => {});
  saveProgress();
  broadcast();
});
audio.addEventListener("ended", () => {
  // 播完：cur 保留（元数据在，toggle 重播有据——ended 态 audio.play() 规范上从头播）；
  // saveProgress(final) 落 done:true + currentKey:""（重启恢复锚点清空）
  saveProgress(true);
  broadcast();
});
audio.addEventListener("error", () => {
  // 广播带 error 标记（面板据此 toast + content 渲染 idle 态）；随后复位引擎态
  broadcast({ error: "audio", playing: false });
  cur = null;
});

// ---------- RSS fetch + 解析（SW 无 DOMParser，必须在本文档做） ----------
function fetchWithTimeout(url, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  return fetch(url, { signal: ctl.signal }).finally(() => clearTimeout(t));
}

async function fetchFeed(url) {
  const hit = feedCache.get(url);
  if (hit && Date.now() - hit.fetchedAt < FEED_TTL) return hit.data;
  const res = await fetchWithTimeout(url, 15000);
  const text = await res.text();
  const data = parseFeed(text);
  // 顺手淘汰过期项（Map 只增不减会在长命文档里缓积累积）
  for (const [k, v] of feedCache) {
    if (Date.now() - v.fetchedAt >= FEED_TTL) feedCache.delete(k);
  }
  feedCache.set(url, { data, fetchedAt: Date.now() });
  return data;
}

function parseDuration(s) {
  // itunes:duration 可能是纯秒数或 H:MM:SS
  if (!s) return 0;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const parts = s.split(":").map(Number);
  return parts.reduce((acc, p) => acc * 60 + (p || 0), 0);
}

function parseFeed(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  if (doc.querySelector("parsererror")) throw new Error("feed parse error");
  const ch = doc.querySelector("channel");
  if (!ch) throw new Error("no channel");
  const pick = (el, sel) => el.querySelector(sel)?.textContent?.trim() || "";
  const cover =
    ch.querySelector("image > url")?.textContent?.trim() ||
    ch.getElementsByTagName("itunes:image")[0]?.getAttribute("href") ||
    "";
  const episodes = [...doc.querySelectorAll("item")]
    .slice(0, MAX_EPISODES)
    .map((it) => ({
      guid: pick(it, "guid") || pick(it, "link"),
      title: pick(it, "title"),
      pubDate: pick(it, "pubDate"),
      // XML 模式下命名空间元素带前缀标签名，querySelector("duration") 取不到
      dur: parseDuration(it.getElementsByTagName("itunes:duration")[0]?.textContent),
      url: it.querySelector("enclosure")?.getAttribute("url") || "",
    }))
    .filter((e) => e.url && e.guid);
  return { title: pick(ch, "title"), cover, link: pick(ch, "link"), episodes };
}

async function discoverRss(pageUrl) {
  // Spotify：封闭平台无公开 RSS（页面无 feed 声明），明确报错引导换源
  if (/open\.spotify\.com\//.test(pageUrl)) return { ok: false, reason: "spotify" };
  // Apple Podcasts：官方公开 lookup 接口直接返回 feedUrl
  const am = pageUrl.match(/podcasts\.apple\.com\/[^/]*\/podcast\/(?:[^/]*\/)?id(\d+)/);
  if (am) {
    const r = await fetchWithTimeout(`https://itunes.apple.com/lookup?id=${am[1]}`, 15000);
    const j = await r.json();
    const feedUrl = j?.results?.[0]?.feedUrl;
    if (feedUrl) return { ok: true, url: feedUrl, title: j.results[0].trackName || "" };
    return { ok: false };
  }
  const res = await fetchWithTimeout(pageUrl, 15000);
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const link = doc.querySelector(
    'link[rel="alternate"][type*="rss+xml"], link[rel="alternate"][type*="atom+xml"]'
  );
  if (!link) return { ok: false };
  const href = link.getAttribute("href") || "";
  return { ok: true, url: new URL(href, pageUrl).href, title: doc.querySelector("title")?.textContent?.trim() || "" };
}

// ---------- 控制命令（background 转发，target:'offscreen'） ----------
async function doPlay(p) {
  saveProgress(); // 换集前先落旧集进度（此刻 cur/audio 仍是旧的，src 切换不触发 pause）
  lastPos = -1; // 新集增量基准重置
  cur = {
    key: p.key,
    feedTitle: p.feedTitle,
    epTitle: p.epTitle,
    cover: p.cover || "",
    audioUrl: p.audioUrl,
    dur: p.dur || 0,
  };
  audio.src = p.audioUrl;
  audio.playbackRate = p.rate || 1;
  // 续播位：先 seek 再播（metadata 就绪后设 currentTime）——若 play 之后再 seek，
  // play 事件的广播带的是 0 时刻且修正不再广播，UI 时间会卡错（历史续播踩过）
  if (p.pos > 0) {
    await new Promise((res) => {
      const apply = () => {
        try {
          audio.currentTime = p.pos;
        } catch (e) { /* readyState 不足时忽略，兜底超时 */
        }
        res();
      };
      if (audio.readyState >= 1) apply();
      else {
        audio.addEventListener("loadedmetadata", apply, { once: true });
        setTimeout(res, 3000); // 慢网络兜底：3s 后照常起播（从头）
      }
    });
  }
  await audio.play().catch(() => {}); // offscreen 无手势限制，catch 兜底自动播放策略异常
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== "offscreen") return false; // 只处理 bg 转发的命令
  if (msg.action === "podControl") {
    const { cmd } = msg;
    if (cmd === "play") {
      doPlay(msg).then(() => sendResponse({ ok: true }));
    } else if (cmd === "toggle") {
      if (!audio.src) {
        sendResponse({ ok: false }); // 无源（stop 后/异常态）：静默应答，UI 走 idle
      } else {
        if (audio.paused) audio.play().catch(() => {});
        else audio.pause();
        sendResponse({ ok: true });
      }
    } else if (cmd === "pause") {
      audio.pause();
      sendResponse({ ok: true });
    } else if (cmd === "stop") {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      cur = null;
      broadcast();
      sendResponse({ ok: true });
    } else if (cmd === "seek") {
      audio.currentTime = msg.value;
      broadcast();
      sendResponse({ ok: true });
    } else if (cmd === "skip") {
      audio.currentTime = Math.max(0, audio.currentTime + msg.value);
      broadcast();
      sendResponse({ ok: true });
    } else if (cmd === "rate") {
      audio.playbackRate = msg.value;
      broadcast();
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false });
    }
    return true;
  }
  if (msg.action === "podGetState") {
    sendResponse({
      playing: !audio.paused,
      key: cur?.key || "",
      epTitle: cur?.epTitle || "",
      feedTitle: cur?.feedTitle || "",
      cover: cur?.cover || "",
      pos: Math.floor(audio.currentTime),
      dur: Math.floor(audio.duration) || cur?.dur || 0,
      rate: audio.playbackRate,
    });
    return true;
  }
  if (msg.action === "podFetchFeed") {
    fetchFeed(msg.url)
      .then((data) => sendResponse({ ok: true, ...data }))
      .catch(() => sendResponse({ ok: false, error: "feed" }));
    return true;
  }
  if (msg.action === "podDiscoverRss") {
    discoverRss(msg.pageUrl)
      .then((r) => sendResponse(r))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  return false;
});
