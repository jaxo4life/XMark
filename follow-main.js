// follow-main.js — 关注变动采集（MAIN world 注入）
// hook window.fetch，旁路截获 /Following /Followers GraphQL 响应，postMessage 转发给
// follow-collect.js（ISOLATED world）。不阻断请求、不修改响应，纯旁路 clone。
// 注意：与 content scripts 是隔离世界，通信只能走 window.postMessage（跨世界可见）。
(() => {
  "use strict";
  if (window.__xmarkFollowHook) return; // 防重入
  window.__xmarkFollowHook = true;

  const MATCH = /\/graphql\/[^/]+\/(Following|Followers)\?/;

  // 从 GraphQL 响应提取用户列表（只取 XMark 需要的紧凑字段）
  // 结构：data.user.result.timeline.timeline.instructions[].entries[].content.itemContent.user_results.result
  // 字段语义 =「事件时点快照」：delta 模型下随变动者写入，新粉/取关画像的精确数据源
  const extractUsers = (json) => {
    const out = [];
    try {
      const instructions =
        json?.data?.user?.result?.timeline?.timeline?.instructions || [];
      for (const ins of instructions) {
        const entries = ins?.entries || [];
        for (const entry of entries) {
          const r = entry?.content?.itemContent?.user_results?.result;
          if (r?.__typename !== "User") continue; // UserUnavailable 等跳过
          out.push({
            id: r.rest_id || "",           // 即 XMark 备注体系的 userId
            h: r?.core?.screen_name || "", // handle
            n: r?.core?.name || "",        // 显示名
            a: r?.avatar?.image_url || "", // 头像（_normal 规格）
            v: r?.is_blue_verified ? 1 : 0,
            fr: r?.relationship_counts?.followers || 0, // TA 的粉丝数（量级分层/大V）
            fg: r?.relationship_counts?.following || 0, // TA 的关注数（关注比异常检测）
            tw: r?.tweet_counts?.tweets || 0,           // 推文数（死号/活跃度）
            ca: Math.floor(Date.parse(r?.core?.created_at || 0) / 864e5) || 0, // 注册日 epoch 天（账龄）
            p: r?.privacy?.protected ? 1 : 0,           // 锁推
          });
        }
      }
    } catch (_) { /* 结构异常静默——非目标响应或 X 改版 */ }
    return out;
  };

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
      emit(url, res.clone().json().catch(() => null));
    } catch (_) { /* 截获失败不影响页面 */ }
    return res;
  };

  // XHR hook（prototype patch，不破坏 instanceof；X 的 GraphQL 可能走 XHR 而非 fetch）
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    try {
      if (typeof url === "string" && MATCH.test(url)) {
        this.addEventListener("load", () => {
          try {
            emit(
              this.responseURL || url,
              Promise.resolve(JSON.parse(this.responseText))
            );
          } catch (_) {}
        });
      }
    } catch (_) {}
    return origOpen.call(this, method, url, ...rest);
  };

  // URL 命中 → 解析 JSON → 提取用户 → postMessage 转发（fetch/XHR 共用出口）
  function emit(url, jsonPromise) {
    if (!jsonPromise) return;
    const m = (url || "").match(MATCH);
    if (!m) return;
    const kind = m[1] === "Following" ? "following" : "followers";
    jsonPromise
      .then((json) => {
        const users = extractUsers(json);
        if (users.length)
          window.postMessage(
            { source: "xmark-follow", kind, users },
            window.location.origin
          );
      })
      .catch(() => {});
  }
})();
