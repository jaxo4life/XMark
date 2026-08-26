/**
 * XMark · 播客面板（独立模块，自包含，与 content.js 零耦合）
 *
 * 形态：左下角方形播放器卡 190×150（上：封面+标题/时间+进度条；下：−15/播放/+15/倍速）
 *   → 点击卡片空白处展开 350px 推入式面板（订阅/发现/添加订阅 → 单集列表）。
 *   播放引擎在 offscreen（跨导航不断播）。
 * 开关：popup「高级→增强」→ podcastSettings.enabled（默认开，独立于净化族）。
 * 零 MutationObserver：fixed 挂 body，SPA 路由不重挂。
 *
 * 移除本功能：删此文件 + manifest content_scripts js 数组一项 + offscreen.{html,js}
 *             + background.js pod 段 + podcasts.json + popup/lang 条目。
 *
 * ⚠️ 必须保持 IIFE：同 entry 多 content script 共享全局作用域，撞名 = SyntaxError 静默失败。
 */
(() => {
  "use strict";

  // 内置目录远程源（GitHub Pages 自定义域，仓库根 podcasts.json 同一份文件双源）
  const POD_DIR_URL = "https://xmark.jaxoo.xyz/podcasts.json";
  const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];

  let langData = {};
  let barEl = null; // 迷你条
  let panelEl = null; // 展开面板
  let state = { playing: false, key: "", epTitle: "", feedTitle: "", cover: "", pos: 0, dur: 0, rate: 1 };
  let barCoverUrl = null; // 迷你条当前封面 url（幂等装载防 tick 重设闪烁）
  let podDefaultRate = 1; // 「高级→播客」设置的默认倍速（点新单集时生效；播放中临时改的不延续）
  let subs = []; // podcastSubs 快照
  let view = { name: "subs", feed: null }; // 面板视图栈（subs | episodes）
  const feedData = new Map(); // feedUrl -> 解析结果（会话内存存）

  const t = (k, f) => langData[k] || f;
  const send = (m) => chrome.runtime.sendMessage(m);

  // ---------- i18n ----------
  async function loadLang() {
    try {
      const { lang = "zh" } = await chrome.storage.local.get(["lang"]);
      const res = await fetch(chrome.runtime.getURL(`lang/${lang}.json`));
      langData = await res.json();
    } catch (e) {
      langData = {};
    }
  }

  // 暗色三信号（与 xfinder/标签抽屉同款，挂 html[data-xmark-theme] 幂等共享）
  function applyTheme() {
    let dark = false;
    const cs = document.documentElement.style.getPropertyValue("color-scheme");
    if (cs) dark = cs.includes("dark");
    if (!dark) {
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) dark = ["#000000", "#17191c", "#1a1a1a", "black"].includes((meta.content || "").toLowerCase());
    }
    if (!dark) {
      const bg = getComputedStyle(document.body).backgroundColor;
      const m = bg.match(/\d+/g);
      if (m) dark = (+m[0] + +m[1] + +m[2]) / 3 < 80;
    }
    document.documentElement.setAttribute("data-xmark-theme", dark ? "dark" : "light");
  }

  // ---------- 样式 ----------
  function injectStyle() {
    if (document.getElementById("xmark-podcast-style")) return;
    const css = `
#xmark-pod-bar{position:fixed;left:12px;bottom:80px;z-index:1;width:190px;height:150px;display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:16px;background:rgba(255,255,255,.85);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border:1px solid rgb(159,181,195);box-shadow:0 0 15px rgba(101,119,134,.2),0 0 3px 1px rgba(101,119,134,.15);cursor:pointer;user-select:none;box-sizing:border-box;animation:pod-in .25s ease}
#xmark-pod-bar:hover{background:rgba(255,255,255,.95)}
#xmark-pod-bar .pod-top{display:flex;align-items:center;gap:8px;flex:1;min-height:0}
#xmark-pod-bar .pod-cover{width:44px;height:44px;border-radius:8px;flex-shrink:0;background:#1d9bf0;color:#fff;display:flex;align-items:center;justify-content:center;font-size:16px;overflow:hidden}
#xmark-pod-bar .pod-cover img{width:100%;height:100%;object-fit:cover}
#xmark-pod-bar .pod-meta{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
#xmark-pod-bar .pod-ep{font-size:13px;font-weight:700;color:#0f1419;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#xmark-pod-bar .pod-sub{font-size:11px;color:#536471;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* 进度条：可视轨道 3px，命中区扩到 14px（伪元素承载视觉，i 只管填充） */
#xmark-pod-bar .pod-prog{position:relative;height:14px;display:flex;align-items:center;background:transparent;cursor:pointer;flex-shrink:0}
#xmark-pod-bar .pod-prog::before{content:"";position:absolute;left:0;right:0;height:3px;border-radius:2px;background:#cfd9de}
#xmark-pod-bar .pod-prog i{position:relative;display:block;height:3px;width:0;background:#1d9bf0;border-radius:2px}
/* 控制排：−15 播放 +15 倍速 */
#xmark-pod-bar .pod-ctr{display:flex;align-items:center;justify-content:space-evenly;flex-shrink:0}
#xmark-pod-bar .pod-bar-btn{width:32px;height:32px;border-radius:50%;border:none;background:#0f1419;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;padding:0}
#xmark-pod-bar .pod-bar-btn:hover{background:#272c30}
#xmark-pod-bar .pod-bar-btn svg{width:16px;height:16px}
#xmark-pod-bar .pod-bar-btn.pod-ghost{background:transparent;color:#0f1419;width:28px;height:28px}
#xmark-pod-bar .pod-bar-btn.pod-ghost:hover{background:rgba(0,0,0,.06)}
#xmark-pod-bar .pod-rate-tag{font-size:12px;font-weight:700;color:#1d9bf0;cursor:pointer;min-width:30px;text-align:center;font-variant-numeric:tabular-nums}
#xmark-pod-bar .pod-rate-tag:empty{display:none}
#xmark-pod-bar .pod-bar-btn.pod-stop{color:#f4212e}
#xmark-pod-bar .pod-bar-btn.pod-stop:hover{background:rgba(244,33,46,.1)}
html[data-xmark-theme="dark"] #xmark-pod-bar .pod-bar-btn.pod-stop{color:#f4212e}
html[data-xmark-theme="dark"] #xmark-pod-bar .pod-bar-btn.pod-stop:hover{background:rgba(244,33,46,.15)}
/* dock 态（无播放）：圆形 XCast 图标，点击开面板；拖动定位两态通用 */
#xmark-pod-bar.pod-dock{width:52px;height:52px;padding:5px;border-radius:50%;gap:0}
#xmark-pod-bar.pod-dock .pod-top{flex:none}
#xmark-pod-bar.pod-dock .pod-meta{display:none}
#xmark-pod-bar.pod-dock .pod-cover{width:100%;height:100%;border-radius:50%}
#xmark-pod-bar.pod-dock .pod-prog{display:none}
#xmark-pod-bar.pod-dock .pod-ctr{display:none}
@keyframes pod-in{from{transform:translateY(12px);opacity:0}to{transform:none;opacity:1}}
html[data-xmark-theme="dark"] #xmark-pod-bar{background:rgba(0,0,0,.65);border-color:rgb(75,78,82);box-shadow:rgba(255,255,255,.2) 0 0 18px,rgba(255,255,255,.15) 0 0 4px 2px}
html[data-xmark-theme="dark"] #xmark-pod-bar:hover{background:rgba(0,0,0,.75)}
html[data-xmark-theme="dark"] #xmark-pod-bar .pod-ep{color:#e7e9ea}
html[data-xmark-theme="dark"] #xmark-pod-bar .pod-sub{color:#71767b}
html[data-xmark-theme="dark"] #xmark-pod-bar .pod-bar-btn{background:#eff3f9;color:#0f1419}
html[data-xmark-theme="dark"] #xmark-pod-bar .pod-bar-btn:hover{background:#d7dbdc}
html[data-xmark-theme="dark"] #xmark-pod-bar .pod-bar-btn.pod-ghost{background:transparent;color:#e7e9ea}
html[data-xmark-theme="dark"] #xmark-pod-bar .pod-bar-btn.pod-ghost:hover{background:rgba(255,255,255,.08)}
html[data-xmark-theme="dark"] #xmark-pod-bar .pod-prog::before{background:#2f3336}
/* 面板（推入式视图栈：subs → episodes） */
#xmark-pod-panel{position:fixed;left:12px;bottom:240px;width:350px;max-width:calc(100vw - 24px);max-height:min(560px,calc(100vh - 174px));z-index:3;background:#fff;border:1px solid #eff3f4;border-radius:16px;box-shadow:0 8px 28px rgba(101,119,134,.25);overflow:hidden;animation:pod-in .2s ease;font-family:inherit;color:#0f1419;box-sizing:border-box;display:none;flex-direction:column}
#xmark-pod-panel.pod-open{display:flex}
#xmark-pod-panel .podp-head{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #eff3f4;font-weight:800;font-size:15px;flex-shrink:0}
#xmark-pod-panel .podp-back{width:32px;height:32px;border-radius:50%;border:none;background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#0f1419;padding:0;flex-shrink:0}
#xmark-pod-panel .podp-back:hover{background:#f7f9f9}
#xmark-pod-panel .podp-head span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#xmark-pod-panel .podp-scroll{overflow-y:auto;flex:1;overscroll-behavior:contain}
#xmark-pod-panel .podp-row{display:flex;align-items:center;gap:10px;padding:8px 16px;cursor:pointer}
#xmark-pod-panel .podp-row:hover{background:#f7f9f9}
#xmark-pod-panel .podp-row .podp-cover{width:44px;height:44px;border-radius:8px;flex-shrink:0;background:#1d9bf0;color:#fff;display:flex;align-items:center;justify-content:center;font-size:15px;overflow:hidden}
#xmark-pod-panel .podp-row .podp-cover img{width:100%;height:100%;object-fit:cover}
#xmark-pod-panel .podp-row .podp-info{flex:1;min-width:0}
#xmark-pod-panel .podp-row .podp-title{font-size:15px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#xmark-pod-panel .podp-row .podp-title.podp-cur{color:#1d9bf0}
#xmark-pod-panel .podp-row .podp-sub{font-size:12px;color:#536471;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#xmark-pod-panel .podp-row .podp-del{width:28px;height:28px;border-radius:50%;border:none;background:transparent;color:#536471;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;padding:0}
#xmark-pod-panel .podp-row .podp-del:hover{background:#eff3f4;color:#f4212e}
html[data-xmark-theme="dark"] #xmark-pod-panel .podp-row .podp-del{color:#71767b}
html[data-xmark-theme="dark"] #xmark-pod-panel .podp-row .podp-del:hover{background:rgba(244,33,46,.1)}
#xmark-pod-panel .podp-sec{padding:12px 16px 4px;font-size:12px;font-weight:800;color:#536471}
#xmark-pod-panel .podp-add{display:flex;gap:8px;padding:12px 16px;border-top:1px solid #eff3f4;flex-shrink:0}
#xmark-pod-panel .podp-add input{flex:1;height:36px;border-radius:18px;border:1px solid #cfd9de;background:#eff3f4;padding:0 14px;font-size:13px;color:#0f1419;outline:none;min-width:0;font-family:inherit}
#xmark-pod-panel .podp-add input:focus{border-color:#1d9bf0;background:#fff}
#xmark-pod-panel .podp-add button{height:36px;border-radius:18px;border:none;background:#0f1419;color:#fff;font-size:13px;font-weight:700;padding:0 16px;cursor:pointer;flex-shrink:0;font-family:inherit;display:flex;align-items:center;justify-content:center}
#xmark-pod-panel .podp-add button:hover{background:#272c30}
#xmark-pod-panel .podp-prog{font-size:12px;color:#1d9bf0;font-weight:700;flex-shrink:0}
#xmark-pod-panel .podp-done{font-size:12px;color:#536471;flex-shrink:0}
#xmark-pod-panel .podp-empty{padding:32px 16px;text-align:center;color:#536471;font-size:13px}
#xmark-pod-panel .podp-err{color:#f4212e;font-size:12px;padding:4px 16px 8px;flex-shrink:0}
html[data-xmark-theme="dark"] #xmark-pod-panel{background:#16181c;border-color:#2f3336;color:#e7e9ea}
html[data-xmark-theme="dark"] #xmark-pod-panel .podp-head{border-color:#2f3336}
html[data-xmark-theme="dark"] #xmark-pod-panel .podp-row:hover{background:#202327}
html[data-xmark-theme="dark"] #xmark-pod-panel .podp-back{color:#e7e9ea}
html[data-xmark-theme="dark"] #xmark-pod-panel .podp-back:hover{background:#202327}
html[data-xmark-theme="dark"] #xmark-pod-panel .podp-row .podp-sub,
html[data-xmark-theme="dark"] #xmark-pod-panel .podp-sec,
html[data-xmark-theme="dark"] #xmark-pod-panel .podp-done,
html[data-xmark-theme="dark"] #xmark-pod-panel .podp-empty{color:#71767b}
html[data-xmark-theme="dark"] #xmark-pod-panel .podp-add{border-color:#2f3336}
html[data-xmark-theme="dark"] #xmark-pod-panel .podp-add input{background:#202327;border-color:#2f3336;color:#e7e9ea}
html[data-xmark-theme="dark"] #xmark-pod-panel .podp-add input:focus{background:#000;border-color:#1d9bf0}
html[data-xmark-theme="dark"] #xmark-pod-panel .podp-add button{background:#eff3f9;color:#0f1419}
html[data-xmark-theme="dark"] #xmark-pod-panel .podp-add button:hover{background:#d7dbdc}
/* toast（蓝底对齐 xfinder .xf-toast；z-index 高于面板防遮挡） */
#xmark-pod-toast{position:fixed;left:12px;bottom:240px;z-index:4;background:#1d9bf0;color:#fff;font-size:13px;padding:10px 16px;border-radius:10px;opacity:0;transform:translateY(8px);transition:all .2s;pointer-events:none}
#xmark-pod-toast.pod-show{opacity:1;transform:none}
`;
    const style = document.createElement("style");
    style.id = "xmark-podcast-style";
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ---------- SVG（XML 模式必须显式 xmlns；单根独立解析） ----------
  const svgPlay = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v13.72c0 .8.87 1.3 1.56.9l11-6.86a1.05 1.05 0 0 0 0-1.8l-11-6.86A1.05 1.05 0 0 0 8 5.14z"/></svg>`;
  const svgPause = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>`;
  const svgBack = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20z"/></svg>`;
  const svgDel = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M9.5 7h5l-.5-1h-4zM8 7V6a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v1h3a.75.75 0 0 1 0 1.5h-.4l-1.1 9.1A2.25 2.25 0 0 1 15.3 20H8.7a2.25 2.25 0 0 1-2.2-2.4L5.4 8.5H5a.75.75 0 0 1 0-1.5zm2 3.5v6h1.5v-6zm3 0v6h1.5v-6z"/></svg>`;
  const svgPod = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3z"/></svg>`;
  const svgClock = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8zm.5-13h-1.5v6l4.7 2.8.75-1.23-3.95-2.35z"/></svg>`;
  const svgStop = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h12v12H6z"/></svg>`;
  const svgSkip = (dir) =>
    dir < 0
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/><text x="13" y="20" font-size="8" font-weight="bold" text-anchor="middle" fill="currentColor">15</text></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 5V1l5 5-5 5V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z"/><text x="11" y="20" font-size="8" font-weight="bold" text-anchor="middle" fill="currentColor">15</text></svg>`;

  function svgNode(str) {
    const doc = new DOMParser().parseFromString(str, "image/svg+xml");
    return document.importNode(doc.documentElement, true);
  }

  function fmt(sec) {
    if (!sec || !isFinite(sec)) return "--:--";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m >= 60
      ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${m}:${String(s).padStart(2, "0")}`;
  }

  // 封面装载：XCast 占位先行，真图 onload 才替换（防「先破损图、片刻后才正确」）；
  // 真图失败保持占位；XCast 资源自身缺失回落蓝底白 SVG 图标。
  // coverOk：已验证可用的 URL 直接上真图——面板重开行重建时不再「闪占位→换图」。
  const coverOk = new Set();
  function setCover(el, url) {
    if (url && coverOk.has(url)) {
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      el.replaceChildren(img);
      return;
    }
    const ph = document.createElement("img");
    ph.src = chrome.runtime.getURL("public/XCast.png");
    ph.alt = "";
    ph.onerror = () => el.replaceChildren(svgNode(svgPod));
    el.replaceChildren(ph);
    if (!url) return;
    const img = document.createElement("img");
    img.src = url;
    img.alt = "";
    img.onload = () => {
      coverOk.add(url);
      el.replaceChildren(img); // 加载成功才上，失败保持占位
    };
  }

  // ---------- 迷你条 ----------
  function buildBar() {
    if (barEl) return;
    barEl = document.createElement("div");
    barEl.id = "xmark-pod-bar";

    const top = document.createElement("div");
    top.className = "pod-top";
    const cover = document.createElement("div");
    cover.className = "pod-cover";
    cover.appendChild(svgNode(svgPod));

    const meta = document.createElement("div");
    meta.className = "pod-meta";
    const ep = document.createElement("div");
    ep.className = "pod-ep";
    ep.textContent = t("pod_idle_title", "听点播客");
    const sub = document.createElement("div");
    sub.className = "pod-sub";
    sub.textContent = t("pod_idle_sub", "点击挑选节目");
    meta.append(ep, sub);
    top.append(cover, meta);

    const back15 = document.createElement("button");
    back15.className = "pod-bar-btn pod-ghost";
    back15.title = "-15s";
    back15.appendChild(svgNode(svgSkip(-1)));
    back15.onclick = (e) => {
      e.stopPropagation();
      send({ action: "podControl", cmd: "skip", value: -15 });
    };

    const playBtn = document.createElement("button");
    playBtn.className = "pod-bar-btn pod-play";
    playBtn.appendChild(svgNode(svgPlay));
    playBtn.onclick = (e) => {
      e.stopPropagation();
      // idle 态（无当前单集）播放键即「去选节目」
      if (state.key) send({ action: "podControl", cmd: "toggle" });
      else togglePanel();
    };

    const fwd15 = document.createElement("button");
    fwd15.className = "pod-bar-btn pod-ghost";
    fwd15.title = "+15s";
    fwd15.appendChild(svgNode(svgSkip(1)));
    fwd15.onclick = (e) => {
      e.stopPropagation();
      send({ action: "podControl", cmd: "skip", value: 15 });
    };

    const rateTag = document.createElement("span");
    rateTag.className = "pod-rate-tag";
    rateTag.textContent = "";
    rateTag.onclick = (e) => {
      e.stopPropagation();
      const i = RATES.indexOf(state.rate);
      send({ action: "podControl", cmd: "rate", value: RATES[(i + 1 + RATES.length) % RATES.length] });
    };

    const prog = document.createElement("div");
    prog.className = "pod-prog";
    const progI = document.createElement("i");
    prog.appendChild(progI);
    prog.onclick = (e) => {
      // 点击进度条 seek（点哪跳哪）
      e.stopPropagation();
      if (!state.dur) return;
      const rect = prog.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      send({ action: "podControl", cmd: "seek", value: Math.floor(ratio * state.dur) });
    };

    const stopBtn = document.createElement("button");
    stopBtn.className = "pod-bar-btn pod-ghost pod-stop";
    stopBtn.title = t("podBtnStop", "停止");
    stopBtn.appendChild(svgNode(svgStop));
    stopBtn.onclick = (e) => {
      e.stopPropagation();
      send({ action: "podControl", cmd: "stop" });
    };

    const ctr = document.createElement("div");
    ctr.className = "pod-ctr";
    ctr.append(back15, playBtn, fwd15, rateTag, stopBtn);

    barEl.append(top, prog, ctr);
    barEl.onclick = () => {
      if (barMoved) return; // 拖动落点不触发开面板
      togglePanel();
    };

    // 拖动 + 位置记忆（dock/卡两态通用；按钮与进度条区域不作为拖拽把手）
    barEl.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if (e.target.closest("button, .pod-prog")) return;
      const r = barEl.getBoundingClientRect();
      const ox = e.clientX - r.left;
      const oy = e.clientY - r.top;
      const sx = e.clientX;
      const sy = e.clientY;
      let dragging = false;
      const onMove = (ev) => {
        if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return;
        dragging = true;
        barMoved = true;
        const L = Math.max(8, Math.min(window.innerWidth - r.width - 8, ev.clientX - ox));
        const T = Math.max(8, Math.min(window.innerHeight - r.height - 8, ev.clientY - oy));
        barEl.style.left = L + "px";
        barEl.style.top = T + "px";
        barEl.style.bottom = "auto";
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        if (dragging) {
          chrome.storage.local.get(["podcastSettings"]).then(({ podcastSettings = {} }) => {
            chrome.storage.local.set({
              podcastSettings: {
                ...podcastSettings,
                barPos: { left: barEl.style.left, top: barEl.style.top },
              },
            });
          });
          setTimeout(() => (barMoved = false), 80); // 吞掉拖动后的 click
        }
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    document.body.appendChild(barEl);
    restoreBarPos();
    applyBarState();
  }

  let barMoved = false; // 拖动标志（click 兜底吞拖动落点）
  function restoreBarPos() {
    chrome.storage.local.get(["podcastSettings"]).then(({ podcastSettings }) => {
      const pos = podcastSettings?.barPos;
      if (!pos?.left || !pos?.top || !barEl) return;
      const w = barEl.offsetWidth;
      const h = barEl.offsetHeight;
      const L = Math.max(8, Math.min(window.innerWidth - w - 8, parseFloat(pos.left)));
      const T = Math.max(8, Math.min(window.innerHeight - h - 8, parseFloat(pos.top)));
      if (!isFinite(L) || !isFinite(T)) return;
      barEl.style.left = L + "px";
      barEl.style.top = T + "px";
      barEl.style.bottom = "auto";
    });
  }

  function applyBarState() {
    if (!barEl) return;
    const cover = barEl.querySelector(".pod-cover");
    const ep = barEl.querySelector(".pod-ep");
    const sub = barEl.querySelector(".pod-sub");
    const playBtn = barEl.querySelector(".pod-play");
    const rateTag = barEl.querySelector(".pod-rate-tag");
    // 空态契约：无 key 一律渲染 idle 态（播完 error 复位/stop/引擎回收后校准），
    // 不允许 early-return——否则 UI 冻结成旧标题+旧进度的幽灵态。
    // idle 形态 = 圆形 dock（XCast logo，点击开面板）
    if (!state.key) {
      barEl.classList.add("pod-dock");
      barEl.title = t("pod_idle_title", "听点播客");
      if (barCoverUrl !== "") {
        barCoverUrl = "";
        setCover(cover, "");
      }
      ep.textContent = t("pod_idle_title", "听点播客");
      sub.textContent = t("pod_idle_sub", "点击挑选节目");
      playBtn.replaceChildren(svgNode(svgPlay));
      rateTag.textContent = "";
      barEl.querySelector(".pod-prog i").style.width = "0%";
      return;
    }
    barEl.classList.remove("pod-dock");
    barEl.title = "";
    // 封面幂等装载（applyBarState 每秒被本地 tick 调，url 没变不重设防闪烁/重复请求）
    if (barCoverUrl !== state.cover) {
      barCoverUrl = state.cover;
      setCover(cover, state.cover);
    }
    ep.textContent = state.epTitle || "";
    sub.textContent = `${fmt(state.pos)} / ${fmt(state.dur)} · ${state.feedTitle || ""}`;
    playBtn.replaceChildren(svgNode(state.playing ? svgPause : svgPlay));
    rateTag.textContent = state.rate !== 1 ? `${state.rate}x` : "1x";
    const p = state.dur ? Math.min(100, (state.pos / state.dur) * 100) : 0;
    barEl.querySelector(".pod-prog i").style.width = p + "%";
  }

  // ---------- 面板 ----------
  function togglePanel() {
    if (!panelEl) buildPanel();
    const open = panelEl.classList.toggle("pod-open");
    if (open) {
      renderPanel();
      send({ action: "podGetState" })
        .then((s) => {
          if (s) {
            Object.assign(state, s);
            applyBarState();
            if (state.playing && state.key) startLocalTick();
          }
        })
        .catch(() => {});
    }
  }

  function buildPanel() {
    panelEl = document.createElement("div");
    panelEl.id = "xmark-pod-panel";

    const head = document.createElement("div");
    head.className = "podp-head";
    const backBtn = document.createElement("button");
    backBtn.className = "podp-back";
    backBtn.style.display = "none";
    backBtn.appendChild(svgNode(svgBack));
    backBtn.onclick = () => {
      view = { name: "subs", feed: null };
      renderPanel();
    };
    const headTitle = document.createElement("span");
    head.append(backBtn, headTitle);
    const histBtn = document.createElement("button");
    histBtn.className = "podp-back"; // 复用头部按钮规格
    histBtn.style.marginLeft = "auto";
    histBtn.title = t("pod_history", "历史");
    histBtn.appendChild(svgNode(svgClock));
    histBtn.onclick = () => {
      view = { name: "history", feed: null };
      renderPanel();
    };
    head.appendChild(histBtn);

    const scroll = document.createElement("div");
    scroll.className = "podp-scroll";

    const err = document.createElement("div");
    err.className = "podp-err";
    err.style.display = "none";

    const add = document.createElement("div");
    add.className = "podp-add";
    const input = document.createElement("input");
    input.placeholder = t("pod_add_ph", "粘贴 RSS 或播客主页链接");
    input.type = "url";
    const addBtn = document.createElement("button");
    addBtn.textContent = t("pod_add", "添加");
    const doAdd = () => addSubscription(input, err);
    addBtn.onclick = doAdd;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doAdd();
    });
    add.append(input, addBtn);

    panelEl.append(head, scroll, err, add);
    document.body.appendChild(panelEl);

    // 点面板/迷你条外关闭；Esc 关闭。
    // isConnected 兜底：点击订阅行等场景下 onclick 同步 replaceChildren 会先摘除
    // 被点行，冒泡到这里时 target 已 detach，contains 判 false 会误关面板（曾致
    // 「点订阅行面板被关」）——detached 视为面板内交互，不关。
    document.addEventListener("click", (e) => {
      if (
        panelEl?.classList.contains("pod-open") &&
        e.target.isConnected &&
        !panelEl.contains(e.target) &&
        !barEl?.contains(e.target)
      ) {
        panelEl.classList.remove("pod-open");
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        // 输入框聚焦且有内容：先护输入（blur 不关面板，防丢粘贴的长 URL）
        const inp = panelEl?.querySelector(".podp-add input");
        if (document.activeElement === inp && inp.value.trim()) {
          inp.blur();
          return;
        }
        panelEl?.classList.remove("pod-open");
      }
    });
  }

  let adding = false; // 添加中锁（discover+fetch 串行最长 30s，防连点并发）

  async function addSubscription(input, err) {
    if (adding) return;
    const v = input.value.trim();
    if (!/^https?:\/\//.test(v)) {
      err.style.display = "block";
      err.textContent = t("pod_err_url", "链接无效");
      return;
    }
    err.style.display = "none";
    const addBtn = input.nextElementSibling;
    adding = true;
    input.disabled = true;
    if (addBtn) addBtn.textContent = t("pod_adding", "添加中…");
    try {
      let rssUrl = v;
      // 非 .xml/.rss/feeds. 直链 → 尝试按播客主页自动发现
      if (!/\.(xml|rss)(\/|$)/i.test(v) && !/feeds?\./i.test(v)) {
        const disc = await send({ action: "podDiscoverRss", pageUrl: v }).catch(() => null);
        if (disc?.ok) rssUrl = disc.url;
        else {
          err.style.display = "block";
          err.textContent =
            disc?.reason === "spotify"
              ? t("pod_err_spotify", "Spotify 不提供 RSS，请用播客官网或 Apple Podcasts 链接")
              : t("pod_err_norss", "未发现 RSS");
          return;
        }
      }
      const feed = await send({ action: "podFetchFeed", url: rssUrl }).catch(() => null);
      if (!feed?.ok) {
        err.style.display = "block";
        err.textContent = t("pod_err_feed", "RSS 拉取失败");
        return;
      }
      const res = await send({
        action: "podSubAdd",
        url: rssUrl,
        title: feed.title,
        cover: feed.cover,
        link: feed.link,
      });
      if (res?.dup) {
        err.style.display = "block";
        err.textContent = t("pod_err_dup", "已订阅过");
        return;
      }
      input.value = "";
      toast(t("pod_added", "已添加"));
    } finally {
      adding = false;
      input.disabled = false;
      if (addBtn) addBtn.textContent = t("pod_add", "添加");
    }
  }

  let discoverOpen = false; // 发现区折叠态（会话内存，默认收起）

  async function renderPanel() {
    if (!panelEl) return;
    const head = panelEl.querySelector(".podp-head");
    const backBtn = head.querySelector(".podp-back");
    const headTitle = head.querySelector("span");
    const histBtn = head.querySelectorAll(".podp-back")[1];
    const scroll = panelEl.querySelector(".podp-scroll");
    const add = panelEl.querySelector(".podp-add");
    scroll.replaceChildren();

    if (view.name === "subs") {
      backBtn.style.display = "none";
      add.style.display = "flex";
      if (histBtn) histBtn.style.display = "flex";
      headTitle.textContent = t("pod_title", "播客");

      if (!subs.length && !discoverOpen) {
        const empty = document.createElement("div");
        empty.className = "podp-empty";
        empty.textContent = t("pod_empty", "还没有订阅，展开发现区挑一个");
        scroll.appendChild(empty);
      }
      for (const s of subs) {
        scroll.appendChild(buildSubRow(s));
      }

      // 发现区：默认折叠，点击标题行展开/收起
      const sec = document.createElement("div");
      sec.className = "podp-sec";
      sec.style.cssText = "cursor:pointer;user-select:none;display:flex;align-items:center;gap:4px";
      sec.textContent = (discoverOpen ? "▾ " : "▸ ") + t("pod_discover", "发现");
      sec.onclick = () => {
        discoverOpen = !discoverOpen;
        renderPanel();
      };
      scroll.appendChild(sec);
      if (discoverOpen) {
        const builtin = await getBuiltinDir();
        if (!builtin.length) {
          const e3 = document.createElement("div");
          e3.className = "podp-empty";
          e3.textContent = t("pod_err_dir", "目录加载失败");
          scroll.appendChild(e3);
        }
        for (const b of builtin) {
          if (subs.some((s) => s.url === b.url)) continue; // 已订阅不重复展示
          scroll.appendChild(buildDirRow(b));
        }
      }
    } else if (view.name === "episodes" && view.feed) {
      backBtn.style.display = "flex";
      add.style.display = "none";
      if (histBtn) histBtn.style.display = "none";
      headTitle.textContent = view.feed.title;
      renderEpisodes(scroll);
    } else if (view.name === "history") {
      backBtn.style.display = "flex";
      add.style.display = "none";
      if (histBtn) histBtn.style.display = "none";
      headTitle.textContent = t("pod_history", "历史");
      renderHistory(scroll);
    }
  }

  function buildSubRow(s) {
    const row = document.createElement("div");
    row.className = "podp-row";
    const cov = document.createElement("div");
    cov.className = "podp-cover";
    setCover(cov, s.cover);
    const info = document.createElement("div");
    info.className = "podp-info";
    const ti = document.createElement("div");
    ti.className = "podp-title";
    ti.textContent = s.title;
    const su = document.createElement("div");
    su.className = "podp-sub";
    su.textContent = s.link || s.url;
    info.append(ti, su);
    const del = document.createElement("button");
    del.className = "podp-del";
    del.title = t("pod_unsub", "删除订阅");
    del.appendChild(svgNode(svgDel));
    del.onclick = async (e) => {
      e.stopPropagation();
      await send({ action: "podSubRemove", id: s.id });
    };
    row.append(cov, info, del);
    row.onclick = () => openFeed(s);
    return row;
  }

  function buildDirRow(b) {
    const row = document.createElement("div");
    row.className = "podp-row";
    const cov = document.createElement("div");
    cov.className = "podp-cover";
    setCover(cov, b.cover);
    const info = document.createElement("div");
    info.className = "podp-info";
    const ti = document.createElement("div");
    ti.className = "podp-title";
    ti.textContent = b.title;
    const su = document.createElement("div");
    su.className = "podp-sub";
    su.textContent = `${b.lang === "zh" ? "中文" : "English"} · ${b.category || ""}`;
    info.append(ti, su);
    const addTag = document.createElement("span");
    addTag.className = "podp-prog";
    addTag.textContent = "+";
    row.append(cov, info, addTag);
    row.onclick = async () => {
      toast(t("pod_adding", "添加中…"));
      // 目录快照 cover 空：订阅前拉一次 feed 补全封面/标题（itunes:image 在 feed 里）
      let cover = b.cover;
      let title = b.title;
      let link = "";
      const feed = await send({ action: "podFetchFeed", url: b.url }).catch(() => null);
      if (feed?.ok) {
        cover = feed.cover || cover;
        title = feed.title || title;
        link = feed.link || "";
      }
      const r = await send({ action: "podSubAdd", url: b.url, title, cover, link });
      if (r?.ok) toast(t("pod_added", "已添加"));
      else if (r?.dup) toast(t("pod_err_dup", "已订阅过"));
    };
    return row;
  }

  async function openFeed(s) {
    view = { name: "episodes", feed: s };
    const scroll = panelEl.querySelector(".podp-scroll");
    scroll.replaceChildren();
    const loading = document.createElement("div");
    loading.className = "podp-empty";
    loading.textContent = t("pod_loading", "加载中…");
    scroll.appendChild(loading);
    const feed = await send({ action: "podFetchFeed", url: s.url }).catch(() => null);
    if (feed?.ok) {
      feedData.set(s.url, feed);
      renderPanel();
    } else {
      // 失败不进死胡同：保持 episodes 视图（返回键可用），错误文案 + 重试
      panelEl.querySelector(".podp-head .podp-back").style.display = "flex";
      panelEl.querySelector(".podp-head span").textContent = s.title;
      panelEl.querySelector(".podp-add").style.display = "none";
      scroll.replaceChildren();
      const e2 = document.createElement("div");
      e2.className = "podp-empty";
      e2.textContent = t("pod_err_feed", "RSS 拉取失败");
      const retry = document.createElement("div");
      retry.className = "podp-empty";
      retry.style.color = "#1d9bf0";
      retry.style.cursor = "pointer";
      retry.textContent = "↻ " + t("pod_retry", "重试");
      retry.onclick = () => openFeed(s);
      scroll.append(e2, retry);
    }
  }

  // 内置目录：快照优先，Pages 远程异步覆盖（同一份文件双源，session 缓存）
  async function getBuiltinDir() {
    let list = [];
    try {
      const res = await fetch(chrome.runtime.getURL("podcasts.json"));
      list = await res.json();
    } catch (e) {
      /* 快照缺失返回空 */
    }
    try {
      const remote = await fetchWithTimeoutWeb(POD_DIR_URL, 6000);
      if (Array.isArray(remote) && remote.length) return remote.length >= list.length ? remote : list;
    } catch (e) {
      /* 远程失败回落快照 */
    }
    return list;
  }

  async function fetchWithTimeoutWeb(url, ms) {
    const ctl = new AbortController();
    const t0 = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      return await r.json();
    } finally {
      clearTimeout(t0);
    }
  }

  // ---------- 历史视图（收听记录 + 每播客统计 + 继续听） ----------
  function fmtDur(sec) {
    if (!sec || sec < 60) return "";
    const h = Math.floor(sec / 3600);
    const m = Math.round((sec % 3600) / 60);
    return h >= 1 ? `${h}h${m ? " " + m + "m" : ""}` : `${m}m`;
  }

  function renderHistory(scroll) {
    scroll.replaceChildren();
    chrome.storage.local.get(["podcastProgress", "podcastStats"]).then(({ podcastProgress = {}, podcastStats = {} }) => {
      const entries = Object.entries(podcastProgress)
        .filter(([k, p]) => p.feedTitle || p.epTitle)
        .sort((a, b) => b[1].updatedAt - a[1].updatedAt);
      if (!entries.length) {
        const empty = document.createElement("div");
        empty.className = "podp-empty";
        empty.textContent = t("pod_hist_empty", "还没有收听记录");
        scroll.appendChild(empty);
        return;
      }
      // 顶部：按播客聚合（收听次数 / 累计时长）
      const byFeed = new Map(); // feedTitle -> {plays, listened}
      for (const [k, p] of entries) {
        const st = podcastStats[k] || { plays: 0, listened: 0 };
        const cur2 = byFeed.get(p.feedTitle) || { plays: 0, listened: 0 };
        cur2.plays += st.plays;
        cur2.listened += st.listened;
        byFeed.set(p.feedTitle, cur2);
      }
      for (const [feedTitle, agg] of byFeed) {
        const row = document.createElement("div");
        row.className = "podp-row";
        row.style.cursor = "default";
        const info = document.createElement("div");
        info.className = "podp-info";
        const ti = document.createElement("div");
        ti.className = "podp-title";
        ti.textContent = feedTitle;
        const su = document.createElement("div");
        su.className = "podp-sub";
        const parts = [];
        if (agg.plays) parts.push(`${agg.plays} ${t("pod_plays", "次")}`);
        const d = fmtDur(agg.listened);
        if (d) parts.push(`${t("pod_listened", "共听")} ${d}`);
        su.textContent = parts.join(" · ");
        info.append(ti, su);
        row.append(info);
        scroll.appendChild(row);
      }
      const sec = document.createElement("div");
      sec.className = "podp-sec";
      sec.textContent = t("pod_hist_recent", "最近收听");
      scroll.appendChild(sec);
      // 单集行：进度/已听完，可继续听（有 audioUrl 才可点）
      for (const [key, p] of entries) {
        const row = document.createElement("div");
        row.className = "podp-row";
        row.dataset.podKey = key;
        const info = document.createElement("div");
        info.className = "podp-info";
        const ti = document.createElement("div");
        ti.className = "podp-title" + (key === state.key ? " podp-cur" : "");
        ti.textContent = p.epTitle || key.split("|").pop();
        const su = document.createElement("div");
        su.className = "podp-sub";
        const d2 = new Date(p.updatedAt).toLocaleDateString();
        const dListen = fmtDur(podcastStats[key]?.listened);
        su.textContent = `${p.feedTitle || ""} · ${d2}${dListen ? " · " + dListen : ""}`;
        info.append(ti, su);
        row.append(info);
        const tag = document.createElement("span");
        if (p.done) {
          tag.className = "podp-done";
          tag.textContent = "✓";
        } else {
          tag.className = "podp-prog";
          const pct = p.dur ? Math.round((p.pos / p.dur) * 100) : 0;
          tag.textContent = pct + "%";
        }
        row.append(tag);
        if (p.audioUrl) {
          row.onclick = (e) => {
            e.stopPropagation();
            scroll.querySelectorAll(".podp-row").forEach((r) => {
              r.querySelector(".podp-title")?.classList.remove("podp-cur");
            });
            ti.classList.add("podp-cur");
            const feedUrl = key.split("|")[0];
            playEpisode(
              { title: p.feedTitle, cover: p.cover || "", url: feedUrl },
              { url: p.audioUrl, title: p.epTitle, dur: p.dur, _pos: p.done ? 0 : p.pos },
              key
            );
          };
        } else {
          row.style.opacity = "0.55"; // 老数据无音频直链：仅展示不可续播
        }
        scroll.appendChild(row);
      }
    });
  }

  // ---------- 单集列表 ----------
  function renderEpisodes(scroll) {
    scroll = scroll || panelEl.querySelector(".podp-scroll");
    const feed = feedData.get(view.feed?.url);
    if (!feed) return;
    scroll.replaceChildren();
    chrome.storage.local.get(["podcastProgress"]).then(({ podcastProgress = {} }) => {
      for (const ep of feed.episodes) {
        const key = `${view.feed.url}|${ep.guid}`;
        const p = podcastProgress[key];
        const row = document.createElement("div");
        row.className = "podp-row";
        row.dataset.podKey = key; // renderEpisodesLive 高亮依赖
        const info = document.createElement("div");
        info.className = "podp-info";
        const ti = document.createElement("div");
        ti.className = "podp-title" + (key === state.key ? " podp-cur" : "");
        ti.textContent = ep.title;
        const su = document.createElement("div");
        su.className = "podp-sub";
        const d = ep.pubDate ? new Date(ep.pubDate).toLocaleDateString() : "";
        su.textContent = `${d}${ep.dur ? " · " + fmt(ep.dur) : ""}`;
        info.append(ti, su);
        row.append(info);
        if (p && !p.done && p.pos > 10) {
          const pr = document.createElement("span");
          pr.className = "podp-prog";
          pr.textContent = Math.round((p.pos / (p.dur || ep.dur || p.pos)) * 100) + "%";
          row.append(pr);
          ep._pos = p.pos; // 续播回填（playEpisode 消费）
        } else if (p?.done) {
          const done = document.createElement("span");
          done.className = "podp-done";
          done.textContent = "✓";
          row.append(done);
          ep._pos = 0; // 已听完：重听从头播（_pos 若残留旧续播位会跳进度）
        } else {
          ep._pos = 0;
        }
        row.onclick = () => {
          // 即时反馈：先高亮自己（引擎 play 事件回来后 renderEpisodesLive 校准）
          scroll.querySelectorAll(".podp-row").forEach((r) => {
            r.querySelector(".podp-title")?.classList.remove("podp-cur");
          });
          ti.classList.add("podp-cur");
          playEpisode(view.feed, ep, key);
        };
        scroll.appendChild(row);
      }
    });
  }

  function playEpisode(feed, ep, key) {
    send({
      action: "podControl",
      cmd: "play",
      audioUrl: ep.url,
      key,
      feedTitle: feed.title,
      epTitle: ep.title,
      cover: feed.cover || "",
      pos: ep._pos || 0,
      dur: ep.dur || 0, // feed 的 itunes:duration 直通引擎（防 audio.duration 推断滞后）
      rate: podDefaultRate || state.rate || 1, // 默认倍速（设置驱动）
    });
  }

  // 播放中轻量刷新：仅切高亮行，不重建列表（保滚动位置）
  function renderEpisodesLive() {
    if ((view.name !== "episodes" && view.name !== "history") || !panelEl) return;
    panelEl.querySelectorAll(".podp-row").forEach((row) => {
      row.querySelector(".podp-title")?.classList.toggle("podp-cur", row.dataset.podKey === state.key);
    });
  }

  // ---------- toast ----------
  let toastTimer = 0;
  function toast(text) {
    let el = document.getElementById("xmark-pod-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "xmark-pod-toast";
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add("pod-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("pod-show"), 2400);
  }

  function teardownUI() {
    clearInterval(tickTimer); // 本地时钟停止（防 UI 删净后空转 + podState 重启它）
    send({ action: "podControl", cmd: "stop" }).catch(() => {}); // 关开关=停播（否则引擎出声且无 UI 入口可停）
    barEl?.remove();
    barEl = null;
    barCoverUrl = null; // 重置幂等锚点：重开时旧播放态若未清（stop 广播竞态），封面仍会重新装载
    panelEl?.remove();
    panelEl = null;
    view = { name: "subs", feed: null };
  }

  // ---------- 入口 ----------
  async function init() {
    await loadLang();
    const { podcastSettings } = await chrome.storage.local.get(["podcastSettings"]);
    if (podcastSettings?.enabled === false) return;
    podDefaultRate = podcastSettings?.defaultRate || 1;
    const ready = () => {
      injectStyle();
      buildBar();
      applyTheme();
    };
    if (document.body) ready();
    else document.addEventListener("DOMContentLoaded", ready, { once: true });
    chrome.storage.local.get(["podcastSubs"]).then(({ podcastSubs = [] }) => {
      subs = podcastSubs;
    });
    send({ action: "podGetState" })
      .then((s) => {
        if (s) {
          Object.assign(state, s);
          applyBarState();
          if (state.playing && state.key) startLocalTick();
        }
      })
      .catch(() => {});
  }

  // 引擎事件态（经 bg 中转）：校准本地时钟；播放中本地每秒推算进度（引擎不广播秒级进度）
  let tickTimer = 0;
  function startLocalTick() {
    clearInterval(tickTimer);
    tickTimer = setInterval(() => {
      if (!state.playing || !state.key) return;
      if (state.dur && state.pos < state.dur) {
        // 推进量乘倍速（2x 播放时 pos 每秒 +2；seek/skip/rate 事件时引擎校准）
        state.pos = Math.min(state.dur, state.pos + (state.rate || 1));
        applyBarState();
      } else {
        clearInterval(tickTimer);
      }
    }, 1000);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "podState") {
      const hadError = msg.error;
      Object.assign(state, msg);
      applyBarState();
      if (state.playing && state.key) startLocalTick();
      else clearInterval(tickTimer);
      if (panelEl?.classList.contains("pod-open")) renderEpisodesLive();
      if (hadError) toast(t("pod_err_audio", "音频加载失败"));
    }
    return false;
  });

  chrome.storage.onChanged.addListener((changes, ns) => {
    if (ns !== "local") return;
    if (changes.podcastSettings) {
      podDefaultRate = changes.podcastSettings.newValue?.defaultRate || 1; // 默认倍速实时更新
      if (changes.podcastSettings.newValue?.enabled === false) teardownUI();
      else if (!barEl) init();
    }
    if (changes.podcastSubs) {
      subs = changes.podcastSubs.newValue || [];
      if (panelEl?.classList.contains("pod-open") && view.name === "subs") renderPanel();
    }
  });

  init();
})();
