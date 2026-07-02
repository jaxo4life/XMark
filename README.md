<p align="center">
  <img src="public/logo.png" alt="XMark Logo" width="128">
</p>

<p align="center">
  <a href="#"><img src="https://img.shields.io/badge/version-5.2.7-blue.svg" alt="Version"></a>
  <a href="https://developer.chrome.com/docs/extensions/mv3/intro/"><img src="https://img.shields.io/badge/Manifest-V3-green.svg" alt="Manifest"></a>
  <a href="#"><img src="https://img.shields.io/badge/Platform-Chrome%20Extension-orange.svg" alt="Platform"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License"></a>
</p>

---

## 🕑 Changelog

<details open>
<summary><b>v5.x</b></summary>

### v5.2.7
| 中文 | English |
|------|----------|
| 代码优化与性能提升 | Code optimization & performance improvements |

### v5.2.6
| 中文 | English |
|------|----------|
| 修复若干 bug | Bug fixes |

### v5.2.5
| 中文 | English |
|------|----------|
| 修复若干 bug | Bug fixes |

### v5.2.4
| 中文 | English |
|------|----------|
| 优化头像获取 | Avatar fetching optimized |
| 修复若干 bug | Bug fixes |

### v5.2.3
| 中文 | English |
|------|----------|
| 更新数据管理 | Update Data Management |
| 修复若干 bug | Bug fixes |

### v5.2.2
| 中文 | English |
|------|----------|
| 新增截图分类、备注 | Add screenshot category and note |
| 修复若干 bug | Bug fixes |

### v5.2.1
| 中文 | English |
|------|----------|
| 修复若干 bug | Bug fixes |

### v5.2.0
| 中文 | English |
|------|----------|
| 全新扩展界面 | Brand new popup UI |
| 时间线数据管理 | Timeline data management |
| 长截图修复和优化 | Long screenshot fixed and optimized |

### v5.1.0
| 中文 | English |
|------|----------|
| 时间流 | Time Flow |
| 长截图 | Long Screenshot |

### v5.0.0
| 中文 | English |
|------|----------|
| 引入 **XMark 时间线** | Introduced **XMark Timeline** |

</details>

<details>
<summary><b>v4.x</b></summary>

### v4.2.0
| 中文 | English |
|------|----------|
| 新增推文截图 | Added tweet screenshot |
| 文件保存路径规范化 | Standardized file save paths |
| 推文截图支持保存至 WebDAV | Supports saving screenshots to WebDAV |
| 代码优化 | Optimized code |

### v4.1.x
| 中文 | English |
|------|----------|
| 增加标签排序与导入导出 | Added tag sorting + export/import |
| 标签内账户展示开关 | Added account list toggle in tags |

### v4.0.x
| 中文 | English |
|------|----------|
| 增加标签管理与备份恢复 | Added tag management & backup/restore |
| WebDAV 配置加密 | WebDAV encryption support |
| 优化 ID 获取逻辑和页面检测 | Optimized ID fetch & refresh detection |

</details>

<details>
<summary><b>v3.x</b></summary>

### v3.0.x
| 中文 | English |
|------|----------|
| 增加 WebDAV & 自动备份 | Added WebDAV & autobackup (hourly/daily/weekly/monthly) |
| 新版本检测（需手动更新） | Added version check (manual update) |
| 多语言文件完善 | Improved language support |

</details>

<details>
<summary><b>v2.x</b></summary>

### v2.0.x
| 中文 | English |
|------|----------|
| 简洁稳定版本 | Simple & stable version |
| 支持本地备份与恢复 | Local backup & restore only |

</details>

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
