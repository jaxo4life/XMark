<p align="center">
  <img src="public/logo.png" alt="XMark Logo" width="128">
</p>

<p align="center">
  <a href="#"><img src="https://img.shields.io/badge/version-5.0.0-blue.svg" alt="Version"></a>
  <a href="https://developer.chrome.com/docs/extensions/mv3/intro/"><img src="https://img.shields.io/badge/Manifest-V3-green.svg" alt="Manifest"></a>
  <a href="#"><img src="https://img.shields.io/badge/Platform-Chrome%20Extension-orange.svg" alt="Platform"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License"></a>
</p>

---

<summary>🕑 Changelog</summary>

## v5.0.0

- XMark Timeline

## v4.2.0

- 增加推文截图功能
- 规范了文件保存路径
- 推文截图支持保存到WebDAV
- 优化了代码
- Added tweet screenshot
- Standardized file save paths
- Supports saving tweet screenshots to WebDAV
- Optimized code

## v4.1.3

- 代码优化
- 修复了一些bug
- Optimized code
- Fixed bugs

## v4.1.2

- 增加标签排序
- 增加标签排序导出、导入（之前的备份文件导入会自动生成排序）
- Added tag sorting
- Added tag sorting export and import (importing previous backup files will automatically generate sorting)

## v4.1.1

- 增加标签内账户列表展示开关
- Add switch of account list display in tags

## v4.1.0

- 增加标签内账户列表展示
- Add account list display in tags

## v4.0.3

- 增加关注/粉丝页面的支持
- 优化了页面刷新检测
- 优化了ID获取逻辑，减少重复获取
- Add display on following/followers page
- Optimized page refresh detection
- Optimized ID fetch

## v4.0.2

- 增加选定标签的导出和备份功能
- 增加更多的标签颜色
- Add export and backup by selected tags
- Add more tag color

## v4.0.1

- 增加WebDAV配置的加密
- 修复了一些bug
- Add WebDAV encrytion
- Fix some bugs

## v4.0.0

- 增加标签管理
- 增加标签备份和恢复
- Add Tags Management
- Add Tags backup and restore

## v3.0.2

- 修复了一些bug
- 这是v3.x.x系列的稳定版
- Fix some bugs
- It's now a stable one of v3.x.x

## v3.0.1

- 多语言文件已完善
- Lang files done

## v3.0.0

- 增加WebDAV备份
- 增加自动备份
- 增加新版本检查（需要手动下载更新）
- 多语言文件完善中
- Add WebDAV backup
- Add autobackup by hourly/daily/weekly/monthly
- Add new version check (manually update needed)
- Lang files preparing...

## v2.0.2

- 简洁稳定版
- 只支持本地备份和恢复
- Simple & Stable
- Local and hand backup&restore only

---

<details>
<summary>🇨🇳 中文说明</summary>

## 🌟 项目简介

**XMark** 是一款专为 **X（前推特）** 打造的用户备注管理工具。  
它轻巧灵动，让你轻松为任意用户添加个性化备注，帮你记住每一个精彩瞬间——无论是日常关注的好友，还是灵感迸发的创作者，**XMark** 都能妥帖保存那些重要的注脚。

除此之外，**XMark** 还支持 **数据备份与导入**，让你的心血永不丢失，随时随地恢复，伴你探索社交的无尽星辰。

---

## ✨ 项目特点

- ⚡ **轻量简洁** — 无冗余代码，极速响应
- 🖱 **零学习成本** — 简单易用，开箱即用
- 🔒 **数据安全** — 支持备份与导入，安心无忧
- 🔮 **拥抱未来** — 适配平台变化，持久可用

---

## 🚀 快速开始

你可以选择以下两种方式使用 **XMark**：

### 方式一：克隆项目

```bash
git clone https://github.com/jaxo4life/XMark.git
```

### 方式二：下载 ZIP

直接下载 ZIP，解压到本地文件夹。

然后打开 Chrome 浏览器：

1. 访问 `chrome://extensions/`
2. 打开 **开发者模式**
3. 点击 **加载已解压的扩展程序**，选择项目文件夹
4. 尽情享用你的 **XMark**！ 🎉

---

## 🗣️ 特别提醒

第一次为用户添加备注的时候，如果不是在用户主页，会弹出一个小窗用来自动打开用户主页获取用户的唯一数字 ID，详细逻辑可以在 [content.js](content.js) 中查看 fetchUserIdFromProfile(username)

---

## 🤝 贡献 & 反馈

欢迎提出建议与贡献代码，让 **XMark** 更加出色！

</details>

---

<details>
<summary>🇬🇧 English Instructions</summary>

## 🌟 Introduction

**XMark** is a note-taking tool designed specifically for **X (formerly Twitter)**.
Lightweight and nimble, it allows you to easily add personalized notes to any user, helping you remember every special moment — whether it’s a friend you follow daily or a creator who inspires you, **XMark** will preserve those important annotations.

Additionally, **XMark** supports **exporting and importing** note data, ensuring your valuable notes are never lost and can be restored anytime, anywhere.

---

## ✨ Features

- ⚡ **Lightweight** — Fast and responsive
- 🖱 **Zero learning curve** — Easy to use, no setup required
- 🔒 **Secure data** — Backup and import support for peace of mind
- 🔮 **Future-proof** — Adaptable to platform changes

---

## 🚀 Quick Start

You can use **XMark** in two ways:

### Method 1: Clone the repository

```bash
git clone https://github.com/jaxo4life/XMark.git
```

### Method 2: Download ZIP

Download the ZIP and unzip it to a local folder.

Then open Chrome:

1. Go to `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the project folder
4. Enjoy **XMark**! 🎉

---

## 🗣️ Special Reminder

When adding a note for a user for the first time, if you are not on the user’s profile page, a small popup will appear to automatically open their profile and retrieve the user’s unique numeric ID.
For detailed logic, see `fetchUserIdFromProfile(username)` in [content.js](content.js).

---

## 🤝 Contributing & Feedback

All suggestions and contributions are welcome to make **XMark** even better!

</details>
