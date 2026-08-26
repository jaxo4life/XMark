<p align="center">
  <img src="public/logo.png" alt="XMark Logo" width="128">
</p>

<h1 align="center">XMark</h1>

<p align="center">A Chrome extension for X (formerly Twitter): Notes · Screenshots · Ad-filtering</p>

<p align="center">
  <a href="#"><img src="https://img.shields.io/badge/version-6.5.2-blue.svg" alt="Version"></a>
  <a href="https://developer.chrome.com/docs/extensions/mv3/intro/"><img src="https://img.shields.io/badge/Manifest-V3-green.svg" alt="Manifest"></a>
  <a href="#"><img src="https://img.shields.io/badge/Platform-Chrome%20Extension-orange.svg" alt="Platform"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-GPL_v3-blue.svg" alt="License"></a>
</p>

<p align="center">
  🌐 <a href="README.md">中文</a> · <a href="README.en.md">English</a>
</p>

---

## 🌟 Introduction

**XMark** is a browser extension built for **X (formerly Twitter)**, combining **user notes**, **tweet screenshots**, and **ad filtering**. Lightweight and nimble, it helps you remember every account, capture every great post, and silence noisy ads — building your personal X knowledge base.

## ✨ Features

- 📝 **User Notes** — Add personalized notes to any X user (e.g. "Key Account", "Potential Partner", "Suspicious"), shown prominently in the timeline and on profiles
- 📸 **Tweet Screenshots** — Capture long tweets in one click; save to local / WebDAV / built-in timeline database
- 🗂 **Timeline** — All screenshots auto-archived; search by user / date / category / keyword, with an activity heatmap
- 🏷 **Tag Management** — Tagging, drag-to-reorder, filter users by tag (edge-handle drawer + count badges), independent tag import/export
- 🚫 **Ad Filtering** — Auto-detects and hides promoted tweets in your feed; ad-block counts (today / total) at a glance
- 🧹 **UI Clean** — Customizable hiding of left-nav items (Explore / Grok / Premium / Money / Articles / Following / Creator Studio / More), the right sidebar, and ad tweets; one-click clean-left-nav — applied instantly
- 🔍 **XFinder Advanced Search** — a floating panel from the top-right fab after hiding the right rail: combine from / keyword / to-interaction / date range, with X native operators (detailed hints behind the ? icon) and one-click history repeat; UI fully aligned with X official
- 📋 **Right Column Timeline** — after hiding the right rail, a native X List timeline lives in the freed third column: TweetDeck-style tab bar for multi-List switching (click the active tab to force-return to the list), iframe-embedded native page with deep in-frame cleaning, loading veil and background-freeze self-healing; **full in-frame notes / tag badges / screenshots** (frame-coordinate translation + temporarily hiding sticky bars while shooting); shown on Home / tweet detail / profile pages, with **zero column reload across top-level navigation** (persistent fixed-layer architecture); clicking a username in-frame opens the profile top-level natively (column untouched); managed in popup "Advanced" → "Enhance"
- 🎙 **Podcast Panel XCast** — listen while scrolling X: bottom-left player card (±15s / speed / seekable progress) + idle round dock, draggable with position memory; subscriptions / discover catalog (auto remote updates), RSS parsing, history stats and resume-from-breakpoint; the playback engine runs in an offscreen document — **audio survives page navigation**, auto-reaped after 10 min paused
- ☁️ **WebDAV Cloud Backup** — Works with Nutstore, Nextcloud, ownCloud, etc.; hourly/daily/weekly/monthly auto-backup, credentials encrypted at rest
- 🔒 **Secure** — XSS protection, WebDAV SSRF closure, credential encryption, extension-reload tolerance (hardened in v6.0.0)
- 🌐 **Bilingual** — Full i18n, one-click switch between Chinese and English

## 🚀 Quick Start

```bash
git clone https://github.com/jaxo4life/XMark.git
```

Or [download ZIP](https://github.com/jaxo4life/XMark/archive/refs/heads/main.zip) and unzip. Then:

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (top-right)
3. Click **Load unpacked** and select the project folder
4. Open [x.com](https://x.com) and enjoy 🎉

## 🗣️ Special Reminder

When adding a note for a user for the first time, if you're not on their profile page, a small window pops up to open their profile and fetch their unique numeric ID (used as a persistent identifier so notes survive username changes). See `fetchUserIdFromProfile` in [content.js](content.js).

## 📋 Changelog

See [CHANGELOG.md](CHANGELOG.md).

## 🤝 Contributing

Issues and Pull Requests are welcome at the [GitHub repo](https://github.com/jaxo4life/XMark).

## 📄 License

[GPL v3](LICENSE)
