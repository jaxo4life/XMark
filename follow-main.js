// follow-main.js — 关注变动采集（MAIN world 注入）
// 职责（v6.6.1 收窄重构）：只做**请求样板**截获——hook fetch/XHR 的请求侧，
// 命中 Following GraphQL 时把完整 URL+headers 经 postMessage 桥给 follow-collect，
// 由 background 存样板后用 SW fetch 重放翻页（不再依赖页面渲染/滚动，后台 tab 免疫）。
// 响应数据的解析已随滚动采集一起退役（SW 重放自产自解）。
(() => {
  "use strict";
  if (window.__xmarkFollowHook) return; // 防重入
  window.__xmarkFollowHook = true;

  const MATCH = /\/graphql\/[^/]+\/Following\?/;
  const emit = (url, headers) => {
    try {
      window.postMessage(
        { source: "xmark-follow-sample", url, headers: headers || {} },
        window.location.origin
      );
    } catch (_) {}
  };

  // ---- fetch 样板（init.headers 归一为扁平对象）----
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = typeof input === "string" ? input : input?.url || "";
      if (MATCH.test(url || "")) {
        const h = {};
        const ih = init?.headers || (typeof input === "object" ? input?.headers : null);
        if (ih) {
          if (typeof ih.forEach === "function") ih.forEach((v, k) => (h[k] = v));
          else if (Array.isArray(ih)) ih.forEach(([k, v]) => (h[k] = v));
          else Object.assign(h, ih);
        }
        emit(url, h);
      }
    } catch (_) { /* 截获失败不影响页面 */ }
    return origFetch.apply(this, arguments);
  };

  // ---- XHR 样板（open 记 URL、setRequestHeader 收集、send 时转发）----
  const origOpen = XMLHttpRequest.prototype.open;
  const origSet = XMLHttpRequest.prototype.setRequestHeader;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__xmUrl = url;
    this.__xmH = {};
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    if (this.__xmH) this.__xmH[k] = v;
    return origSet.call(this, k, v);
  };
  XMLHttpRequest.prototype.send = function (...rest) {
    try {
      const u = this.__xmUrl;
      if (typeof u === "string" && MATCH.test(u)) emit(u, this.__xmH || {});
    } catch (_) {}
    return origSend.apply(this, rest);
  };
})();
