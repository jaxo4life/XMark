# 更新日志 / Changelog

## v6.5.1

| 中文 | English |
|------|----------|
| 修复：顶层路由切换导致右列 iframe 整帧重载——改双层架构（占位框挂 X 布局 + 列常驻 body fixed 同步对位），iframe 全程零移动零重载 | Fix: top-level navigation reloaded the right-column iframe — rebuilt as a dual-layer architecture (placeholder in X's layout + persistent fixed column on body synced by rect), iframe never moves or reloads |
| 路由白名单：右列仅主页与推文详情页显示，其余路由 visibility 保活隐藏 | Route whitelist: column shows only on Home and tweet detail pages; hidden (kept alive) elsewhere |
| 帧内完整导航 veil 平滑过渡；帧内链接点击尝试 SPA 化接管（失败自动禁用并回滚） | In-frame full navigations get a smooth veil transition; in-frame link clicks attempt SPA takeover (auto-disables and rolls back on failure) |
| 列表时间线页禁用返回按钮（iframe 以列表为首页，返回无处可去） | Back button disabled on the list timeline (the list is the iframe's home; nowhere to go back to) |

## v6.5.0

| 中文 | English |
|------|----------|
| 新增播客面板 XCast：左下播放卡（封面 / ±15s / 倍速 / 进度拖拽）+ idle 圆 dock，可拖动记忆位置 | New podcast panel XCast: bottom-left player card (cover / ±15s / speed / seekable progress) + idle round dock, draggable with position memory |
| 播放引擎跑在 offscreen 文档，页面切换不断播；暂停 10 分钟自动回收，播放键一键续播 | Playback engine runs in an offscreen document — audio survives navigation; auto-reaped after 10 min paused, one-click resume |
| 订阅 / 发现目录（内置 10 播客 + GitHub Pages 远程更新）、RSS 解析、历史统计与断点续播 | Subscriptions / discover catalog (10 built-in podcasts + remote updates via GitHub Pages), RSS parsing, history stats and resume-from-breakpoint |
| popup「高级→播客」子 tab：开关 / 统计总览 / 默认倍速 / 订阅管理与导入导出 / 清空收听记录 | Popup "Advanced → Podcast" sub-tab: toggle / stats overview / default speed / subscription management with import-export / clear listening history |
| 右列 Timeline XMark 化：iframe 内备注 / 标签徽标 / 广告过滤 / 截图 / members 用户卡全功能同构（帧内坐标换算 + 截图期间临时隐藏 sticky 顶栏） | Right column timeline XMark-ified: full in-frame notes / tag badges / ad filtering / screenshots / members user-cards (frame-coordinate translation + temporarily hiding sticky bars while shooting) |
| 右列加载圈换 X 官方同款双层 circle spinner；冻结自愈改假死探测（回前台 DOM 白屏判定，非定时盲重载） | Right column spinner switched to X official dual-circle; freeze self-healing switched to liveness probing (DOM blank detection on refocus, not blind timed reload) |

## v6.4.0

| 中文 | English |
|------|----------|
| 新增右列 Timeline：净化隐藏右栏后第三格常驻 X 原生 List 时间线，tab 条多 List 切换（点当前 tab 强制回列表），iframe 嵌原生页 + 帧内深度净化（frame-clean.js） | New right column timeline: after hiding the right rail, a native X List timeline lives in the freed third column; multi-List tab bar (click active tab to force-return), iframe-embedded native page with deep in-frame cleaning (frame-clean.js) |
| DNR 删 x.com / twitter.com 子帧嵌入头（仅 sub_frame、initiatorDomains 限自有域，主页面零影响） | DNR strips sub-frame embedding headers for x.com / twitter.com (sub_frame only, initiatorDomains limited to own domains, zero impact on top pages) |
| 加载遮罩走帧内就绪信号（非固定延时）；后台冻结 5 分钟自动重载自愈 | Loading veil driven by in-frame ready signal (not fixed delay); background-freeze auto-reload after 5 minutes |
| XFinder 面板改为 fixed 浮层，与右列 Timeline 共存（点圆钮弹出、Esc 关闭） | XFinder panel becomes a fixed floating layer coexisting with the right column timeline (toggle via fab, Esc to close) |
| popup 入口「设置」改名「高级」，模态内子 tab 分「界面净化」/「增强」 | Popup entry renamed to "Advanced", with "UI Clean" / "Enhance" sub-tabs inside the modal |

## v6.3.0

| 中文 | English |
|------|----------|
| 标签面板重构：X 风格贴边把手抽屉（左缘把手，箭头翻转，面板从左滑出） | Tags UI rebuilt: X-style edge-handle drawer (left-edge tab, flipping arrow, slides out from left) |
| 标签行新增用户数徽标 | Per-tag user count badge |
| 用户列表面板 X 化：右侧滑入卡片、垂直居中、暗色适配 | User list panel X-styled: right slide-in card, vertically centered, dark mode |

## v6.2.0

| 中文 | English |
|------|----------|
| 新增 XFinder 高阶搜索（整合自独立扩展，右栏替代形态） | Added XFinder advanced search (integrated from standalone extension, right-rail replacement form) |
| from / 关键词 / to 交互账户 / 日期范围组合查询，支持 X 原生操作符 | from / keyword / to-interaction / date-range combined queries, X native operators supported |
| 搜索历史（20 条指纹去重）与一键重复 | Search history (20, fingerprint-deduped) with one-click repeat |
| 面板 UI 逐项对齐 X 官方（毛玻璃圆钮 / 描边搜索框 / 暗色适配 / 滑入动效） | Panel UI aligned with X official item-by-item (glass fab / outlined inputs / dark mode / slide-in) |
| 界面净化·隐藏右栏开启时激活，嵌入原右栏 grid 格位 | Activates when right sidebar is hidden; embeds into the freed grid slot |
| 面板开关状态记忆；语言切换即时生效 | Panel open/close state remembered; language switch applies instantly |

## v6.1.2

| 中文 | English |
|------|----------|
| 界面净化入口移至 popup 顶部，点击弹出美化模态 | UI Clean entry moved to popup top; opens a polished modal |
| 语言切换按钮精简（EN / 中文） | Language button simplified (EN / 中文) |
| 修复：复选框标签切换语言后不刷新（未挂 data-key） | Fix: checkbox labels not refreshing on language switch (missing data-key) |

## v6.1.1

| 中文 | English |
|------|----------|
| 修复：菜单项 href 选择器因 CSS 逗号陷阱被无条件隐藏（开关关闭也生效） | Fix: CSS comma pitfall caused href selectors to hide nav items unconditionally (even when toggled off) |
| 新增「更多」菜单项隐藏（按钮型，文本兜底覆盖） | Added "More" nav item hiding (button type, text-fallback covered) |
| 新增「一键清爽左栏」：全选/全关，与单项复选框双向同步 | Added "Clean left nav" one-click toggle (all on/off, two-way synced with items) |

## v6.1.0

| 中文 | English |
|------|----------|
| 新增「界面净化」：自定义隐藏左侧菜单项（探索/Grok/Premium/Money/文章/关注/创作者工作室） | Added UI Clean: customizable left-nav hiding (Explore/Grok/Premium/Money/Articles/Following/Creator Studio) |
| 隐藏右侧边栏（搜索/趋势/推荐关注） | Hide right sidebar (Search/Trends/Who to follow) |
| 广告推文过滤改为面板开关（默认开，实时生效，关闭可还原） | Ad filtering becomes a panel toggle (default on, instant, restorable) |
| 选择器三重兜底（testid/href/文本），抗 X 改版 | Triple fallback selectors (testid/href/text) against X redesigns |
| 独立 ui-clean.js 模块，零耦合可整体移除 | Standalone ui-clean.js module, zero-coupled & removable |

## v6.0.0

| 中文 | English |
|------|----------|
| 安全加固：XSS 防护、WebDAV SSRF 收口、凭据加密强化 | Security: XSS protection, WebDAV SSRF closure, credential hardening |
| 性能优化：Blob 内存回收、Stats 聚合查询、日期统一 | Performance: Blob reclamation, Stats aggregation, date normalization |
| 修复多个 bug（标签筛选、互斥锁、截图保存等） | Multiple bug fixes (tag filter, mutex lock, screenshot save) |
| 工程改进：去广告统计、unlimitedStorage、死代码清理 | Engineering: ad-block stats, unlimitedStorage, dead code cleanup |

## v5.2.7

| 中文 | English |
|------|----------|
| 代码优化与性能提升 | Code optimization & performance improvements |

## v5.2.6

| 中文 | English |
|------|----------|
| 修复若干 bug | Bug fixes |

## v5.2.5

| 中文 | English |
|------|----------|
| 修复若干 bug | Bug fixes |

## v5.2.4

| 中文 | English |
|------|----------|
| 优化头像获取 | Avatar fetching optimized |
| 修复若干 bug | Bug fixes |

## v5.2.3

| 中文 | English |
|------|----------|
| 更新数据管理 | Update Data Management |
| 修复若干 bug | Bug fixes |

## v5.2.2

| 中文 | English |
|------|----------|
| 新增截图分类、备注 | Add screenshot category and note |
| 修复若干 bug | Bug fixes |

## v5.2.1

| 中文 | English |
|------|----------|
| 修复若干 bug | Bug fixes |

## v5.2.0

| 中文 | English |
|------|----------|
| 全新扩展界面 | Brand new popup UI |
| 时间线数据管理 | Timeline data management |
| 长截图修复和优化 | Long screenshot fixed and optimized |

## v5.1.0

| 中文 | English |
|------|----------|
| 时间流 | Time Flow |
| 长截图 | Long Screenshot |

## v5.0.0

| 中文 | English |
|------|----------|
| 引入 **XMark 时间线** | Introduced **XMark Timeline** |

## v4.2.0

| 中文 | English |
|------|----------|
| 新增推文截图 | Added tweet screenshot |
| 文件保存路径规范化 | Standardized file save paths |
| 推文截图支持保存至 WebDAV | Supports saving screenshots to WebDAV |
| 代码优化 | Optimized code |

## v4.1.x

| 中文 | English |
|------|----------|
| 增加标签排序与导入导出 | Added tag sorting + export/import |
| 标签内账户展示开关 | Added account list toggle in tags |

## v4.0.x

| 中文 | English |
|------|----------|
| 增加标签管理与备份恢复 | Added tag management & backup/restore |
| WebDAV 配置加密 | WebDAV encryption support |
| 优化 ID 获取逻辑和页面检测 | Optimized ID fetch & refresh detection |

## v3.0.x

| 中文 | English |
|------|----------|
| 增加 WebDAV & 自动备份 | Added WebDAV & autobackup (hourly/daily/weekly/monthly) |
| 新版本检测（需手动更新） | Added version check (manual update) |
| 多语言文件完善 | Improved language support |

## v2.0.x

| 中文 | English |
|------|----------|
| 简洁稳定版本 | Simple & stable version |
| 支持本地备份与恢复 | Local backup & restore only |
