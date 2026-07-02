import {
  getAllScreenshots,
  getUserNote,
  deleteScreenshotById,
  deleteAllScreenshotsById,
  exportToJsonFile,
  importFromJsonFile,
  clearAllStores,
  getDailyActivity,
  addManualScreenshot,
  getUserId,
  addCategory,
  deleteCategory,
  clearAllCategories,
  getAllCategories,
  getCategoryForScreenshot,
  bindCategoryToScreenshot,
  updateScreenshotNote,
  getScreenshotsByCategory,
  getAvatar,
} from "../utils/db.js";
import { updateTexts, getLang, resetLangData } from "../utils/lang.js";

let realGetAll = null;

try {
  if (getAllScreenshots) {
    realGetAll = getAllScreenshots;
  }
} catch (err) {
  // ignore: use mock
}

// ---------- Mock data (only used if no db) ----------
function mockBlob(color) {
  const canvas = document.createElement("canvas");
  canvas.width = 600;
  canvas.height = 340;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 32px system-ui";
  ctx.fillText("Mock Screenshot", 20, 60);
  return new Promise((res) => canvas.toBlob((b) => res(b), "image/png", 0.92));
}

async function generateMock(n = 60) {
  const handles = ["@alice", "@bob", "@charlie", "@dora", "@eve", "@frank"];
  const userIds = ["1001", "1002", "1003", "1004", "1005", "1006"];
  const colors = [
    "#60a5fa",
    "#f97316",
    "#10b981",
    "#f43f5e",
    "#a78bfa",
    "#22d3ee",
  ];
  const list = [];
  for (let i = 0; i < n; i++) {
    const idx = i % userIds.length;
    const blob = await mockBlob(colors[idx]);
    list.push({
      id: crypto.randomUUID(),
      date: new Date(
        Date.now() - Math.random() * 1000 * 60 * 60 * 24 * 14
      ).toISOString(),
      userId: userIds[idx],
      handle: handles[idx],
      blob,
    });
  }
  return list;
}

// Unified getter with cache
let _cache = null;
async function getScreenshots() {
  if (_cache) return _cache;
  if (realGetAll) {
    _cache = await realGetAll();
  } else {
    _cache = await generateMock(120);
  }
  // normalize + sort desc
  _cache.sort((a, b) => new Date(b.date) - new Date(a.date));
  return _cache;
}

// ---------- DOM helpers ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleString();
}

function createObjURL(blob) {
  const url = URL.createObjectURL(blob);
  _urls.add(url);
  return url;
}
const _urls = new Set();
function revokeAllURLs() {
  for (const u of _urls) URL.revokeObjectURL(u);
  _urls.clear();
}

function setActiveTab(name) {
  $$(".tab-button").forEach((t) =>
    t.classList.toggle("active", t.dataset.tab === name)
  );
  $$(".tab-content").forEach((c) =>
    c.classList.toggle("hidden", c.id !== name)
  );
}

// ---------- Filters ----------
let filterUserId = null;
let kw = "";
let startDate = null;
let endDate = null;

function applyFilters(items) {
  return items.filter((i) => {
    if (filterUserId && i.userId !== filterUserId) return false;
    if (kw) {
      const text = (i.userId + " " + i.handle).toLowerCase();
      if (!text.includes(kw.toLowerCase())) return false;
    }
    if (startDate) {
      const t = new Date(i.date).setHours(0, 0, 0, 0);
      if (t < startDate) return false;
    }
    if (endDate) {
      const t = new Date(i.date).setHours(0, 0, 0, 0);
      if (t > endDate) return false;
    }
    return true;
  });
}

function showFilterBar() {
  const bar = $("#filterBar");
  if (filterUserId) {
    bar.classList.remove("hidden");
    $("#filterText").textContent = `userId = ${filterUserId}`;
  } else {
    bar.classList.add("hidden");
  }
}

// ---------- Ranking ----------
let avatarTTLMap = {};
chrome.storage.local.get("avatarTTLMap").then((result) => {
  avatarTTLMap = result.avatarTTLMap || {};
});

async function renderRanking(items) {
  if (filterUserId) {
    items = items.filter((it) => it.userId === filterUserId);
  }

  const map = new Map();
  for (const it of items) {
    if (!map.has(it.userId))
      map.set(it.userId, { count: 1, handle: it.handle });
    else {
      const obj = map.get(it.userId);
      obj.count += 1;
      obj.handle = it.handle;
      map.set(it.userId, obj);
    }
  }

  const arr = Array.from(map.entries())
    .map(([userId, obj]) => ({ userId, count: obj.count, handle: obj.handle }))
    .sort((a, b) => b.count - a.count);

  const root = document.getElementById("ranking-cards");
  root.innerHTML = "";

  const list = document.createElement("div");
  list.className = "flex flex-wrap gap-4 justify-center";

  // 先同步创建并 append 占位卡片（保证顺序）
  arr.forEach(({ userId, count, handle }, idx) => {
    const card = document.createElement("div");
    card.className =
      "flex flex-col justify-between p-4 w-64 h-40 rounded-xl shadow-lg transform hover:scale-105 transition-transform duration-300 relative";

    if (idx === 0) card.classList.add("bg-yellow-400");
    else if (idx === 1) card.classList.add("bg-gray-400");
    else if (idx === 2) card.classList.add("bg-yellow-200");
    else
      card.className +=
        " bg-gradient-to-r from-indigo-50 via-purple-50 to-pink-50";

    card.innerHTML = `
      <div class="absolute top-2 left-2 text-xl font-extrabold drop-shadow-md">#${
        idx + 1
      }</div>
      <div class="absolute top-2 right-2">
        <button class="px-3 py-1 bg-gradient-to-r from-blue-400 to-cyan-400 text-black font-semibold rounded-full shadow-md hover:scale-110 transition-all duration-300"
          data-userid="${userId}">
          ${userId}
        </button>
      </div>
      <div class="flex mt-6 h-28">
        <div class="flex-shrink-0 w-16 h-16">
          <img class="w-16 h-16 rounded-full object-cover border-2 border-white shadow-md avatar-img"
               src="" alt="${handle}">
        </div>
        <div class="flex-1 flex flex-col ml-3">
          <div class="flex-1 flex flex-col items-center justify-center text-left truncate">
            <span class="text-sm font-semibold truncate name-text"></span>
            <a href="https://x.com/${handle}" target="_blank" rel="noopener noreferrer"
               class="text-sm text-blue-500 truncate hover:underline hover:text-blue-600">@${handle}</a>
          </div>
          <div class="flex items-center justify-start text-sm space-x-1 mt-2">
            <span class="badge">📸 ${count} <span data-key="screenshotCount"></span></span>
          </div>
        </div>
      </div>
    `;

    // 保存 handle/userId 以便后续更新
    card.dataset.userid = userId;
    card.dataset.handle = handle;

    list.appendChild(card);
  });

  root.appendChild(list);

  // 并发更新每张卡片（不会改变已 append 的顺序）
  const updatePromises = arr.map(async ({ userId, handle }, idx) => {
    const card = list.children[idx];
    try {
      // 更新用户备注名
      const noteObj = await getUserNote(userId);
      const nameText = noteObj?.name || "";
      const nameSpan = card.querySelector(".name-text");
      if (nameSpan) nameSpan.textContent = nameText;

      // 加载头像
      const img = card.querySelector(".avatar-img");
      if (img) {
        try {
          const base64 = await getAvatar(handle); // ✅ 从 IndexedDB 或网络获取
          img.src = base64;
        } catch (err) {
          console.warn("头像获取失败:", handle, err);
          img.src = "default-avatar.png"; // fallback
        }
      }
    } catch (err) {
      console.error("更新排名卡片失败：", err);
    }
  });

  await Promise.all(updatePromises);

  // 只绑定一次点击事件（防止重复绑定）
  if (!root.dataset.listenerAttached) {
    root.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-userid]");
      if (!btn) return;
      filterUserId = btn.dataset.userid;
      setActiveTab("timeline");
      showFilterBar();
      await rebuildTimeline();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    root.dataset.listenerAttached = "1";
  }

  updateTexts();
}

// ---------- Timeline (infinite scroll) ----------
const PAGE_SIZE = 30;
let _all = [];
let _filtered = [];
let _page = 0;
let _observer = null;
let _scrollObserver = null;
let _allCats = [];
let _categoryId = null;

function clearTimeline() {
  $("#timeline-grid").innerHTML = "";
  _page = 0;
  revokeAllURLs();
}

async function renderCard(item) {
  const wrap = document.createElement("article");
  wrap.className = "timeline-card glass rounded-2xl p-3 space-y-2";
  wrap.style.position = "relative";

  // 给卡片打上 data-date 属性，用来和时间轴对应
  const d = new Date(item.date); // 自动转换到本地时区
  wrap.dataset.date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(d.getDate()).padStart(2, "0")}`;

  wrap.innerHTML = `
    <div class="text-sm text-slate-700">
      ${
        item.tweetlink
          ? `<a href="${item.tweetlink}" 
                target="_blank" 
                data-title-key="opentweetlink"
                class="font-medium text-yellow-500 hover:text-blue-500 hover:underline">
                @${item.handle}
            </a>`
          : `<span class="font-medium text-yellow-500">@${item.handle}</span>`
      }
    </div>
    <div class="flex items-center justify-between text-xs text-slate-500">
      <time>${formatTime(item.date)}</time>
      <button class="timeline-user text-blue-700 hover:text-green-600 font-medium" data-userid="${
        item.userId
      }">
        userId: ${item.userId}
      </button>
    </div>
  `;

  // 插入图片 (加 wrapper 来控制高度)
  const imgWrapper = document.createElement("div");
  imgWrapper.className = "overflow-hidden rounded-xl"; // 超出部分裁掉
  imgWrapper.style.maxHeight = "60vh";

  // 插入图片
  const img = document.createElement("img");
  img.className = "thumb w-full object-cover";
  img.loading = "lazy";
  img.decoding = "async";
  img.src = createObjURL(item.blob);
  img.alt = `screenshot of ${item.handle}`;

  imgWrapper.appendChild(img);
  wrap.appendChild(imgWrapper);

  // 分类标签
  const catLabel = document.createElement("span");
  catLabel.dataset.key = "catLabel";
  catLabel.className = "py-1 text-sm font-bold text-slate-500";
  wrap.appendChild(catLabel);

  // 分类下拉
  const catSelect = document.createElement("select");
  catSelect.className =
    "w-1/3 border rounded ml-2 text-center text-xs text-slate-600 hover:bg-slate-50 cursor-pointer";
  wrap.appendChild(catSelect);

  // 管理分类按钮
  const manageCatBtn = document.createElement("button");
  manageCatBtn.dataset.key = "CategoryManagement";
  manageCatBtn.className =
    "ml-2 px-2 py-1 text-white text-xs rounded bg-blue-500 hover:bg-blue-600";
  wrap.appendChild(manageCatBtn);

  // 函数：刷新下拉选项
  function refreshCatOptions(selectedId) {
    catSelect.innerHTML = `<option value="">未分类</option>`;
    _allCats.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.name;
      if (c.id == selectedId) opt.selected = true;
      catSelect.appendChild(opt);
    });

    // 新增分类选项
    const newOpt = document.createElement("option");
    newOpt.value = "NEW";
    newOpt.textContent = "新增分类…";
    catSelect.appendChild(newOpt);
  }

  const firstCat = await getCategoryForScreenshot(item.id);
  refreshCatOptions(firstCat?.id);
  wrap.dataset.categoryId = firstCat?.id || "";

  // 初始化下拉
  catSelect.addEventListener("focus", async () => {
    const firstCat = await getCategoryForScreenshot(item.id);
    refreshCatOptions(firstCat?.id);
  });

  // 分类选择变更
  catSelect.addEventListener("change", async (e) => {
    const val = e.target.value;
    if (val === "NEW") {
      // 新增分类弹窗
      const modal = document.createElement("div");
      modal.className =
        "fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50";
      modal.innerHTML = `
      <div class="bg-white rounded-2xl p-6 w-72 shadow-xl space-y-4">
        <h2 class="text-lg font-semibold text-slate-700" data-key="newCat">新增分类</h2>
        <input id="newCatInput" class="w-full border rounded-lg p-2 text-sm" data-placeholder-key="catName" />
        <div class="flex justify-end gap-2">
          <button id="catCancel" class="px-3 py-1 rounded bg-gray-200" data-key="cancelAdd">取消</button>
          <button id="catSave" class="px-3 py-1 rounded bg-blue-600 text-white" data-key="save">保存</button>
        </div>
      </div>
    `;
      document.body.appendChild(modal);

      updateTexts(modal);

      const input = modal.querySelector("#newCatInput");
      modal
        .querySelector("#catCancel")
        .addEventListener("click", () => modal.remove());
      modal.querySelector("#catSave").addEventListener("click", async () => {
        const newName = input.value.trim();
        if (!newName) return;

        // 写入数据库
        const newId = await addCategory(newName);
        _allCats.push({ id: newId, name: newName });

        // 自动绑定到当前截图
        await bindCategoryToScreenshot(item.id, newName);

        // 刷新下拉并选中新分类
        refreshCatOptions(newId);
        renderCategoryFilterBar();

        modal.remove();
        const newcatDone = getLang("newcatDone");
        showToast(newcatDone, "success");
      });
    } else if (val === "") {
      // 解绑分类
      await getCategoryForScreenshot(item.id);
      refreshCatOptions(null);
      wrap.dataset.categoryId = "";
    } else {
      // 选择已有分类
      const catName = _allCats.find((c) => c.id == val).name;
      await bindCategoryToScreenshot(item.id, catName);
      refreshCatOptions(val);
      wrap.dataset.categoryId = val;
    }
  });

  // 管理分类按钮点击事件
  manageCatBtn.addEventListener("click", async () => {
    // 弹窗容器
    const modal = document.createElement("div");
    modal.className =
      "fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50";
    modal.innerHTML = `
      <div class="bg-white rounded-2xl p-6 w-80 shadow-xl space-y-4">
        <h2 class="text-lg font-semibold text-slate-700" data-key="CategoryManagement">管理分类</h2>
        <div id="categoryList" class="space-y-2 max-h-60 overflow-y-auto border p-2 rounded"></div>
        <div class="flex gap-2">
          <input id="newCatInput" class="flex-1 border rounded-lg p-2 text-sm" data-placeholder-key="catName" />
          <button id="addCatBtn" class="px-3 py-1 rounded bg-blue-500 text-white text-sm" data-key="addCat">新增</button>
        </div>
        <div class="flex justify-between gap-2">
          <button id="clearCatBtn" class="px-3 py-1 rounded bg-red-500 text-white text-sm hover:bg-red-600" data-key="ClearAllCats">清空分类</button>
          <button id="closeCatModal" class="px-3 py-1 rounded bg-gray-200 text-sm" data-key="closenotice">关闭</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const listDiv = modal.querySelector("#categoryList");
    const input = modal.querySelector("#newCatInput");

    // 渲染分类列表
    function renderList() {
      listDiv.innerHTML = _allCats
        .map(
          (c) => `
      <div class="flex justify-between items-center p-1 border-b text-sm">
        <span>${c.name}</span>
        <button data-id="${c.id}" class="text-red-500 hover:text-red-700 text-xs">x</button>
      </div>
    `
        )
        .join("");

      // 绑定删除事件
      listDiv.querySelectorAll("button").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.dataset.id;
          const name = _allCats.find((c) => c.id == id).name;

          const confirmDeleteCat = getLang("confirmDeleteCat");
          const confirmed = await showConfirm(
            `${confirmDeleteCat} "${name}"？`
          );
          if (confirmed) {
            await deleteCategory(Number(id)); // 删除数据库及解绑截图
            _allCats = _allCats.filter((c) => c.id != id); // 前端 _allCats 同步
            renderList(); // 重新渲染列表
            refreshCatOptions(null); // 刷新下拉框
            renderCategoryFilterBar();
            const catDeleted = getLang("catDeleted");
            showToast(catDeleted, "success");
          }
        });
      });
    }

    renderList();
    updateTexts();

    // 新增分类
    modal.querySelector("#addCatBtn").addEventListener("click", async () => {
      const name = input.value.trim();
      if (!name) return;
      const newId = await addCategory(name);
      _allCats.push({ id: newId, name });
      renderList();
      input.value = "";
      refreshCatOptions(newId); // 下拉框选中新分类
      renderCategoryFilterBar(); // <-- 顶部分类过滤条刷新
      const newcatDone = getLang("newcatDone");
      showToast(newcatDone, "success");
    });

    // 清空分类
    modal.querySelector("#clearCatBtn").addEventListener("click", async () => {
      const confirmClearAllCats = getLang("confirmClearAllCats");
      const confirmed = await showConfirm(confirmClearAllCats);
      if (confirmed) {
        await clearAllCategories();
        const allCatsCleared = getLang("allCatsCleared");
        showToast(allCatsCleared, "success", () => location.reload());
      }
    });

    // 关闭弹窗
    modal.querySelector("#closeCatModal").addEventListener("click", () => {
      modal.remove();
    });
  });

  const noteBtn = document.createElement("button");
  noteBtn.dataset.key = item.note ? "editNote" : "addNote";
  noteBtn.className =
    "block px-2 py-1 rounded bg-green-500 text-white text-xs hover:bg-green-600";
  wrap.appendChild(noteBtn);

  // 备注显示区
  const noteLabel = document.createElement("span");
  noteLabel.className = "block text-sm font-bold text-slate-500";
  if (item.note) noteLabel.dataset.key = "noteLabel";
  wrap.appendChild(noteLabel);

  const noteDiv = document.createElement("div");
  if (item.note)
    noteDiv.className =
      "block text-xs text-slate-700 break-all note-area border border-slate-200 rounded px-2 py-2";
  if (item.note) noteDiv.textContent = item.note;
  wrap.appendChild(noteDiv);

  // 删除按钮
  const delBtn = document.createElement("button");
  delBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5-4h4m-4 0a1 1 0 00-1 1v1h6V4a1 1 0 00-1-1m-4 0h4" />
    </svg>
  `;
  delBtn.className = `
    absolute top-0 right-2
    p-0
    text-red-200
    hover:text-red-600
    transition
    duration-150
    ease-in-out
    cursor-pointer
  `;
  wrap.appendChild(delBtn);

  // ==== 事件绑定 ====

  // 点击图片放大
  img.addEventListener("click", () => openLightbox(img.src));

  // 点击 user 过滤
  wrap.querySelector(".timeline-user").addEventListener("click", async (e) => {
    filterUserId = e.currentTarget.dataset.userid;
    showFilterBar();
    await rebuildTimeline();
  });

  // 删除截图
  delBtn.addEventListener("click", async () => {
    const text = getLang("deleteScreenshot");
    const confirmed = await showConfirm(text);
    if (confirmed) {
      try {
        await deleteScreenshotById(item.id);
        wrap.remove(); // 从 DOM 移除
        _cache = null;
        showToast(`✅ ${getLang("deleteSuccess")}`, "success");
        await rebuildTimeline();
      } catch (err) {
        console.error("删除失败:", err);
        showToast(`❌ ${getLang("deleteFailed")}`, "failed");
      }
    }
  });

  // ==== 备注弹窗 ====
  noteBtn.addEventListener("click", () => {
    const shownote = noteDiv.textContent;
    const modal = document.createElement("div");
    modal.className =
      "fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50";
    modal.innerHTML = `
      <div class="bg-white rounded-2xl p-6 w-80 shadow-xl space-y-4">
        <h2 class="text-lg font-semibold text-slate-700" data-key="${
          shownote ? "editNote" : "addNote"
        }">添加备注</h2>
        <textarea id="noteInput" class="w-full border rounded-lg p-2 text-sm" rows="4">${shownote}</textarea>
        <div class="flex justify-end gap-2">
          <button id="noteCancel" class="px-3 py-1 rounded bg-gray-200" data-key="cancelAdd">取消</button>
          <button id="noteSave" class="px-3 py-1 rounded bg-green-600 text-white" data-key="save">保存</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    updateTexts(modal);

    const input = modal.querySelector("#noteInput");
    modal
      .querySelector("#noteCancel")
      .addEventListener("click", () => modal.remove());
    modal.querySelector("#noteSave").addEventListener("click", async () => {
      const note = input.value.trim();
      await updateScreenshotNote(item.id, note);
      noteLabel.dataset.key = note ? "noteLabel" : "";
      if (!note) {
        noteLabel.textContent = "";
      }
      noteDiv.className = note
        ? "block text-xs text-slate-700 break-all note-area border border-slate-200 rounded px-2 py-2"
        : "";
      noteDiv.textContent = note ? note : "";
      noteBtn.dataset.key = note ? "editNote" : "addNote";
      modal.remove();
      const noteSaved = getLang("noteSaved");
      showToast(noteSaved, "success");
    });
  });

  // ==== 初始化显示分类 ====
  const cat = await getCategoryForScreenshot(item.id); // ✅ 单分类
  if (cat) {
    // 如果已有分类，设置下拉选中
    const opt = Array.from(catSelect.options).find((o) => o.value == cat.id);
    if (opt) opt.selected = true;
  }

  return wrap;
}

async function appendNextPage() {
  const grid = $("#timeline-grid");
  const start = _page * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, _filtered.length);

  // 找到已有的列（如果没有就先建）
  let cols = grid.querySelectorAll(".masonry-col");
  if (cols.length === 0) {
    const columnCount = getColumnCount();
    cols = Array.from({ length: columnCount }, () => {
      const col = document.createElement("div");
      col.className = "masonry-col flex flex-col gap-4 flex-1";
      grid.appendChild(col);
      return col;
    });
  }

  // 行优先插入
  for (let i = start; i < end; i++) {
    const card = await renderCard(_filtered[i]);

    // 按照顺序放到对应列 (左到右)
    const colIndex = i % cols.length;
    cols[colIndex].appendChild(card);
  }

  // 更新页数
  _page++;
  if (end >= _filtered.length) {
    $("#sentinel").textContent = "没有更多了";
    if (_observer) _observer.disconnect();
  } else {
    $("#sentinel").textContent = "下拉加载更多…";
  }

  // 初始化或刷新 sticky 日期
  updateStickyDate();

  // 如果有时间轴元素，显示它（可选）
  const axis = $("#timeline-axis");
  if (axis) {
    axis.classList.remove("hidden");
  }

  setupTimelineScrollObserver();
}

function getColumnCount() {
  const select = document.getElementById("columnCount");
  return parseInt(select?.value || "3", 10);
}

async function rebuildTimeline() {
  _allCats = await getAllCategories(); // 加载全局分类数组
  _all = await getScreenshots();
  _filtered = applyFilters(_all);
  clearTimeline();
  renderRanking(_filtered);
  renderCategoryFilterBar();
  await appendNextPage();
  setupInfiniteScroll();
}

function setupInfiniteScroll() {
  if (_observer) _observer.disconnect();
  _observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) appendNextPage();
    },
    { rootMargin: "600px 0px" }
  );
  _observer.observe($("#sentinel"));
}

// 渲染顶部分类
function renderCategoryFilterBar() {
  const bar = document.getElementById("categoryFilterBar");
  if (!bar) return;
  bar.innerHTML = "";

  // “全部”按钮
  const allBtn = document.createElement("button");
  allBtn.dataset.key = "allCats";
  allBtn.className = "px-3 py-1 rounded text-base font-bold hover:bg-blue-300";

  setActiveFilter(allBtn);
  allBtn.addEventListener("click", async () => {
    _categoryId = null;
    await rebuildTimeline();
    updateTexts();
  });
  bar.appendChild(allBtn);

  // 遍历所有分类
  _allCats.forEach(async (c) => {
    const btn = document.createElement("button");
    btn.textContent = c.name;
    btn.className = "px-3 py-1 rounded text-sm hover:bg-blue-300";

    btn.addEventListener("click", async () => {
      _categoryId = c.id;
      _filtered = await getScreenshotsByCategory(c.id);
      _page = 0;
      clearTimeline(); // 清空原有瀑布流
      await appendNextPage(); // 渲染新的分页
      await updateTexts();
      setActiveFilter(btn);
    });
    bar.appendChild(btn);
  });
}

// 高亮当前选中分类
function setActiveFilter(activeBtn) {
  document.querySelectorAll("#categoryFilterBar button").forEach((b) => {
    b.classList.remove("bg-blue-600", "text-white");
    b.classList.add("bg-slate-100");
  });
  activeBtn.classList.add("bg-blue-600", "text-white");
  activeBtn.classList.remove("bg-slate-100");
}

// 生成左侧时间节点
function updateStickyDate() {
  const grid = document.getElementById("timeline-grid");
  const sticky = document.getElementById("sticky-date");
  if (!grid || !sticky) return;

  const cards = grid.querySelectorAll(".timeline-card");
  const viewportTop = 0; // 视口顶部
  const offset = 50; // 容差像素

  for (let card of cards) {
    const rect = card.getBoundingClientRect();
    if (rect.bottom > viewportTop + offset) {
      sticky.textContent = card.dataset.date;
      break;
    }
  }
}

function setupTimelineScrollObserver() {
  const axis = document.getElementById("timeline-axis");
  const grid = document.getElementById("timeline-grid");
  const cards = document.querySelectorAll("#timeline-grid .timeline-card");
  const axisNodes = document.querySelectorAll("#timeline-axis .axis-node");

  // 1️⃣ 先解绑旧 observer
  if (_scrollObserver) _scrollObserver.disconnect();

  // 2️⃣ 让左侧和右侧滚动同步
  grid.addEventListener("scroll", () => {
    axis.scrollTop = grid.scrollTop;
  });

  // 3️⃣ 新建 IntersectionObserver 负责高亮
  _scrollObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const date = entry.target.dataset.date;

          axisNodes.forEach((n) => {
            const dot = n.querySelector("div");
            dot.classList.remove("bg-blue-500", "bg-slate-400");
            dot.classList.add(
              n.dataset.date === date ? "bg-blue-500" : "bg-slate-400"
            );
          });
        }
      });
    },
    { root: grid, threshold: 0.5 } // ⚠️ root 一定要是 grid
  );

  // 4️⃣ 绑定到所有卡片
  cards.forEach((c) => _scrollObserver.observe(c));
}

// ---------- Stats ----------
function groupByDay(items) {
  const map = new Map();
  for (const it of items) {
    const d = new Date(it.date);
    const key = d.toLocaleDateString();
    map.set(key, (map.get(key) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => new Date(a.day) - new Date(b.day));
}

function renderStatCards(items) {
  const users = new Set(items.map((i) => i.userId));
  const byDay = groupByDay(items);
  const maxDay = byDay.reduce((m, x) => Math.max(m, x.count), 0);
  const el = $("#stats-cards");
  el.innerHTML = `
    <div class="glass rounded-2xl p-4 text-center">
      <div class="text-slate-500 text-sm" data-key="totalCount">总截图数</div>
      <div class="text-2xl font-semibold">${items.length}</div>
    </div>

    <div class="glass rounded-2xl p-4 text-center">
      <div class="text-slate-500 text-sm" data-key="uniqueUserCount">用户数</div>
      <div class="text-2xl font-semibold">${users.size}</div>
    </div>

    <div class="glass rounded-2xl p-4 text-center">
      <div class="text-slate-500 text-sm" data-key="busyday">最忙的一天</div>
      <div class="text-lg font-medium">${
        byDay.length
          ? byDay.reduce((a, b) => (a.count > b.count ? a : b)).day
          : "-"
      }</div>
    </div>

    <div class="glass rounded-2xl p-4 text-center">
      <div class="text-slate-500 text-sm" data-key="highestperday">单日峰值</div>
      <div class="text-2xl font-semibold">${maxDay}</div>
    </div>
  `;
}

function renderDailyChart(items) {
  const data = groupByDay(items); // [{ date, count }, ...]

  const cvs = document.getElementById("dailyChart");
  const ctx = cvs.getContext("2d");

  const W = (cvs.width = cvs.clientWidth);
  const H = (cvs.height = cvs.clientHeight || 180);
  const pad = 40;

  ctx.clearRect(0, 0, W, H);

  const max = Math.max(1, ...data.map((d) => d.count));
  const stepX = (W - pad * 2) / Math.max(1, data.length - 1);

  // 坐标轴
  ctx.strokeStyle = "rgba(0,0,0,0.1)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, pad);
  ctx.lineTo(pad, H - pad);
  ctx.lineTo(W - pad, H - pad);
  ctx.stroke();

  // Y轴刻度
  ctx.fillStyle = "#666";
  ctx.font = "12px sans-serif";
  for (let i = 0; i <= 5; i++) {
    const y = H - pad - ((H - pad * 2) * i) / 5;
    const val = Math.round((max * i) / 5);
    ctx.fillText(val, pad - 30, y + 4);
    // 横线
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(W - pad, y);
    ctx.strokeStyle = "rgba(0,0,0,0.05)";
    ctx.stroke();
  }

  // X轴刻度（每 10 天显示一次）
  ctx.fillStyle = "#666";
  ctx.textAlign = "center";
  const stepLabel = Math.ceil(data.length / 10);
  for (let i = 0; i < data.length; i += stepLabel) {
    const x = pad + i * stepX;
    const date = new Date(data[i].day);

    ctx.fillText(`${date.getMonth() + 1}/${date.getDate()}`, x, H - pad + 16);
  }

  // 折线
  ctx.beginPath();
  for (let i = 0; i < data.length; i++) {
    const x = pad + i * stepX;
    const y = H - pad - (data[i].count / max) * (H - pad * 2);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#0A84FF";
  ctx.stroke();

  // 点
  for (let i = 0; i < data.length; i++) {
    const x = pad + i * stepX;
    const y = H - pad - (data[i].count / max) * (H - pad * 2);
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#0A84FF";
    ctx.fill();
  }
}

// 初始化活跃度热力图
async function renderHeatmap() {
  const data = await getDailyActivity(); // { '2025-09-09': 3, ... }
  const container = document.getElementById("heatmap");
  container.innerHTML = "";

  const totalDays = 90;
  const today = new Date();

  for (let i = totalDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const count = data[dateStr] || 0;

    const cell = document.createElement("div");
    cell.className = "heatmap-cell";

    // 设置颜色
    if (count === 0) cell.style.backgroundColor = "#ebedf0";
    else if (count < 3) cell.style.backgroundColor = "#c6e48b";
    else if (count < 6) cell.style.backgroundColor = "#7bc96f";
    else if (count < 10) cell.style.backgroundColor = "#239a3b";
    else cell.style.backgroundColor = "#196127";

    // tooltip
    cell.title = `${dateStr}: ${count} 次活跃`;

    container.appendChild(cell);
  }

  // 月份标签
  const monthSet = new Set();
  const cells = container.children;
  for (let i = 0; i < cells.length; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - (totalDays - 1 - i));
    const month = d.getMonth() + 1;
    const year = d.getFullYear();
    if (!monthSet.has(month)) {
      monthSet.add(month);
      const label = document.createElement("div");
      label.textContent = `${year}/${month}`;
      label.style.position = "fixed";
      const col = Math.floor(i / 7);
      label.style.left = `${24 + col * 44}px`; //  cell +  gap
      label.style.bottom = "10px";
      label.style.fontSize = "14px";
      label.style.color = "#000000ff";
      container.appendChild(label);
    }
  }
}

// ---------- Lightbox ----------
function openLightbox(src) {
  const lightbox = document.createElement("div");
  lightbox.className = "lightbox";

  const img = document.createElement("img");
  img.src = src;

  const closeBtn = document.createElement("span");
  closeBtn.className = "lightbox-close";
  closeBtn.innerHTML = "&times;"; // ×

  closeBtn.addEventListener("click", () => {
    document.body.removeChild(lightbox);
  });

  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) {
      document.body.removeChild(lightbox);
    }
  });

  lightbox.appendChild(img);
  lightbox.appendChild(closeBtn);
  document.body.appendChild(lightbox);
}

// ---------- Back to top ----------
const backTop = document.getElementById("backTop");
window.addEventListener("scroll", () => {
  if (window.scrollY > 600) backTop.classList.remove("hidden");
  else backTop.classList.add("hidden");
});
backTop.addEventListener("click", () =>
  window.scrollTo({ top: 0, behavior: "smooth" })
);

// ---------- Tabs & Filters events ----------
document.querySelectorAll(".tab-button").forEach((tab) => {
  tab.addEventListener("click", async () => {
    const name = tab.dataset.tab;
    setActiveTab(name);
    if (name === "timeline") {
      await rebuildTimeline();
    } else if (name === "stats") {
      updateTexts();
      const items = await getScreenshots();
      renderStatCards(items);
      renderDailyChart(items);
      renderHeatmap();
    }
  });
});

document.getElementById("clearUser").addEventListener("click", async () => {
  filterUserId = null;
  showFilterBar();
  await rebuildTimeline();
});

document.getElementById("clearFilters").addEventListener("click", async () => {
  filterUserId = null;
  kw = "";
  startDate = null;
  endDate = null;
  const kwInput = document.getElementById("kw");
  kwInput.value = "";
  document.getElementById("startDate").value = "";
  document.getElementById("endDate").value = "";
  showFilterBar();
  await rebuildTimeline();
});

document.getElementById("kw").addEventListener("keydown", async (e) => {
  if (e.key === "Enter") {
    kw = e.currentTarget.value.trim();
    clearTimeline();
    await rebuildTimeline();
  }
});
document.getElementById("startDate").addEventListener("change", async (e) => {
  const v = e.currentTarget.value;
  startDate = v ? new Date(v).setHours(0, 0, 0, 0) : null;
  await rebuildTimeline();
});
document.getElementById("endDate").addEventListener("change", async (e) => {
  const v = e.currentTarget.value;
  endDate = v ? new Date(v).setHours(0, 0, 0, 0) : null;
  await rebuildTimeline();
});

document.getElementById("columnCount").addEventListener("change", async () => {
  const grid = $("#timeline-grid");
  grid.innerHTML = ""; // 清空已有的列
  _page = 0; // 重置分页
  await appendNextPage(); // 重新渲染
  await updateTexts();
});

// 清空userId所有截图
document
  .getElementById("clearallbyuserId")
  .addEventListener("click", async () => {
    const confirmClearAllScreenshots = getLang("confirmClearAllScreenshots");
    const confirmed = await showConfirm(confirmClearAllScreenshots);
    if (!confirmed) return; // 用户取消

    try {
      await deleteAllScreenshotsById(filterUserId, true);

      // ✅ 清空成功提示
      showToast(`🗑️ ${getLang("clearSuccess")}`, "success", () =>
        location.reload()
      );
    } catch (err) {
      console.error("清空失败：", err);
      showToast(`❌ ${getLang("clearFailed")}`, "failed");
    }
  });

// ---------- export & import ----------
// 导出截图备份
document.getElementById("exportBtn").addEventListener("click", async () => {
  try {
    await exportToJsonFile();

    showToast(`✅ ${getLang("timelineexportSuccess")}`, "success");
  } catch (err) {
    console.error("导出失败：", err);
    showToast(`❌ ${getLang("timelineexportFailed")}`, "failed");
  }
});

// 导入截图备份
document.getElementById("importBtn").addEventListener("click", () => {
  document.getElementById("importFileInput").click();
});

document
  .getElementById("importFileInput")
  .addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (file.type !== "application/json" && !file.name.endsWith(".json")) {
      alert("请选择有效的 JSON 文件！");
      return;
    }

    try {
      // 调用你的导入函数
      await importFromJsonFile(file);

      // ✅ 导入成功后显示 toast
      showToast(`✅ ${getLang("timelineimportSuccess")}`, "success", () =>
        location.reload()
      );
    } catch (err) {
      console.error("导入失败：", err);
      showToast(`❌ ${getLang("timelineimportFailed")}`, "failed");
    }

    // 清空 input 的值，防止连续两次选同一个文件时不会触发 change 事件
    event.target.value = "";
  });

// 手动添加截图
document.getElementById("addBtn").addEventListener("click", createManualPanel);

function createManualPanel() {
  // 更新语言
  updateTexts();

  const panel = document.createElement("div");
  panel.className =
    "fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-auto";

  panel.innerHTML = `
    <div class="bg-white rounded-3xl p-8 w-full max-w-2xl flex flex-col gap-6 shadow-2xl relative">
      <h2 class="text-2xl font-bold text-center text-gray-800" data-key="addManually">手动添加截图</h2>
      
      <!-- 上传区域 -->
      <div id="dropZone" class="border-2 border-dashed border-gray-300 rounded-xl p-10 text-center cursor-pointer hover:border-yellow-400 transition-colors flex flex-col items-center justify-center gap-2">
        <span class="text-gray-500" data-key="dragtoupload">拖拽图片到此或点击上传</span>
        <input type="file" id="manualBlobInput" accept="image/*" class="hidden" />
        <img id="previewImg" class="mt-4 max-h-64 rounded-lg hidden" />
      </div>

      <!-- 表单 -->
      <input type="text" id="manualHandle" data-placeholder-key="handleInput" class="border p-3 rounded-lg focus:outline-yellow-400" />
      <input type="text" id="manualTweetlink" data-placeholder-key="tweetlinkInput" class="border p-3 rounded-lg focus:outline-yellow-400" />

      <!-- 按钮 -->
      <div class="flex justify-end gap-4 mt-2">
        <button id="manualCancel" class="px-6 py-3 bg-gray-300 rounded-xl hover:bg-gray-400 transition" data-key="cancelAdd">取消</button>
        <button id="manualSave" class="px-6 py-3 bg-yellow-400 rounded-xl text-white hover:bg-yellow-500 transition" data-key="confirmAdd">保存</button>
      </div>
    </div>
  `;

  document.body.appendChild(panel);

  const dropZone = panel.querySelector("#dropZone");
  const blobInput = panel.querySelector("#manualBlobInput");
  const previewImg = panel.querySelector("#previewImg");
  const handleInput = panel.querySelector("#manualHandle");
  const tweetlinkInput = panel.querySelector("#manualTweetlink");
  const saveBtn = panel.querySelector("#manualSave");
  const cancelBtn = panel.querySelector("#manualCancel");

  let selectedFile = null;

  // 点击上传
  dropZone.addEventListener("click", () => blobInput.click());

  // 文件选择
  blobInput.addEventListener("change", (e) => {
    if (e.target.files.length) {
      selectedFile = e.target.files[0];
      showPreview(selectedFile);
    }
  });

  // 拖拽上传
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("border-yellow-400");
  });

  dropZone.addEventListener("dragleave", (e) => {
    e.preventDefault();
    dropZone.classList.remove("border-yellow-400");
  });

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("border-yellow-400");
    if (e.dataTransfer.files.length) {
      selectedFile = e.dataTransfer.files[0];
      blobInput.files = e.dataTransfer.files; // 同步input
      showPreview(selectedFile);
    }
  });

  function showPreview(file) {
    const url = URL.createObjectURL(file);
    previewImg.src = url;
    previewImg.classList.remove("hidden");
  }

  // 取消
  cancelBtn.onclick = () => panel.remove();

  // 保存
  saveBtn.onclick = async () => {
    if (!selectedFile) return alert("请先上传图片！");
    let handle = handleInput.value.trim();
    if (!handle) return alert("Handle为必填项！");
    if (handle.startsWith("@")) {
      handle = handle.slice(1);
    }

    const tweetlink = tweetlinkInput.value.trim();
    const userId = await getUserId(handle);
    if (!userId) return alert("userId获取失败！");

    // 获取上传文件后缀
    const extMatch = selectedFile.name.match(/\.(\w+)$/);
    const ext = extMatch ? extMatch[1] : "png"; // 默认 png
    const dateStr = new Date().toISOString().split("T")[0];
    const filename = `XMark-Screenshot-${dateStr}.${ext}`;

    try {
      await addManualScreenshot({
        blob: selectedFile,
        handle,
        userId,
        filename,
        tweetlink,
      });

      panel.remove();
      // 可选：刷新 timeline
      showToast(`✅ ${getLang("uploadSuccess")}`, "success", () =>
        location.reload()
      );
    } catch (err) {
      console.error("上传失败", err);
      showToast(`❌ ${getLang("uploadFailed")}`, "failed");
    }
  };
}

// 清空所有截图
document.getElementById("clearBtn").addEventListener("click", async () => {
  const confirmClearAllScreenshots = getLang("confirmClearAllScreenshots");
  const confirmed = await showConfirm(confirmClearAllScreenshots);
  if (!confirmed) return; // 用户取消

  try {
    await clearAllStores();

    // ✅ 清空成功提示
    showToast(`🗑️ ${getLang("clearSuccess")}`, "success", () =>
      location.reload()
    );
  } catch (err) {
    console.error("清空失败：", err);
    showToast(`❌ ${getLang("clearFailed")}`, "failed");
  }
});

// Toast 函数
function showToast(message, status = "success", callback) {
  const toast = document.createElement("div");

  // 根据状态切换主色
  let colorClass;
  if (status === "success") {
    colorClass = "text-green-500"; // 绿色
  } else if (status === "failed") {
    colorClass = "text-red-500"; // 红色
  } else {
    colorClass = "text-blue-500"; // 默认蓝色
  }

  toast.className = `
    fixed bottom-8 right-8
    bg-gray-800 text-white
    rounded-2xl
    p-4
    w-56
    shadow-lg
    flex flex-col gap-3
    text-sm
    opacity-0 translate-y-8
    transform-gpu
    transition-all duration-300
    z-50
    font-sans
  `;

  toast.innerHTML = `
    <div class="text-lg font-extrabold text-blue-500" data-key="notice">
      通知
    </div>
    <div class="text-center text-base font-bold leading-relaxed mb-1 ${colorClass}">
      ${message}
    </div>
    <button class="
      self-center mt-1
      bg-blue-500 hover:bg-blue-400
      text-white font-semibold
      text-sm px-3 py-1.5
      rounded-full
      transition-colors duration-200
    " data-key="closenotice">
      关闭
    </button>
  `;

  document.body.appendChild(toast);
  updateTexts(toast);

  // 弹出动画（轻微弹跳）
  requestAnimationFrame(() => {
    toast.classList.remove("opacity-0", "translate-y-8");
    toast.classList.add("animate-bounceOnce");
  });

  // Tailwind 不自带单次弹跳，需要自己加 keyframes
  const style = document.createElement("style");
  style.innerHTML = `
    @keyframes bounceOnce {
      0% { transform: translateY(30px); opacity: 0; }
      50% { transform: translateY(-5px); opacity: 1; }
      100% { transform: translateY(0); opacity: 1; }
    }
    .animate-bounceOnce {
      animation: bounceOnce 0.4s ease forwards;
    }
  `;
  document.head.appendChild(style);

  const removeToast = () => {
    toast.classList.add("opacity-0", "translate-y-5");
    setTimeout(() => {
      toast.remove();
      if (callback) callback(); // Toast 消失后再刷新
    }, 300);
    document.removeEventListener("click", handleOutsideClick);
  };

  // 点击关闭按钮
  toast.querySelector("button").addEventListener("click", removeToast);

  // 点击外部关闭
  const handleOutsideClick = (event) => {
    if (!toast.contains(event.target)) {
      removeToast();
    }
  };
  setTimeout(() => document.addEventListener("click", handleOutsideClick), 0);

  // 2000ms 自动消失
  setTimeout(removeToast, 2000);
}

// 确认函数
function showConfirm(message) {
  return new Promise((resolve) => {
    // 创建遮罩层
    const modal = document.createElement("div");
    modal.className =
      "fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 opacity-0 transition-opacity duration-300";

    // 创建内容
    modal.innerHTML = `
      <div class="bg-red-700 rounded-2xl shadow-2xl p-6 w-90 text-center transform scale-95 transition-transform duration-300">
        <h2 class="text-lg font-semibold text-white mb-3" data-key="confirmTitle">确认操作</h2>
        <p class="text-base text-white mb-6">${message}</p>
        <div class="flex justify-center gap-8">
          <button class="confirm-cancel px-5 py-2 rounded-xl bg-gray-200 text-gray-700 hover:text-white hover:bg-green-600 transition-colors" data-key="NO">
            取消
          </button>
          <button class="confirm-ok px-5 py-2 rounded-xl bg-gray-200 text-gray-700 hover:text-white hover:bg-black shadow-md transition-colors" data-key="YES">
            确认
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    updateTexts();

    // 强制触发一次 reflow 以启动动画
    requestAnimationFrame(() => {
      modal.classList.remove("opacity-0");
      const content = modal.querySelector("div");
      content.classList.remove("scale-95");
      content.classList.add("scale-100");
    });

    // 找按钮
    const okBtn = modal.querySelector(".confirm-ok");
    const cancelBtn = modal.querySelector(".confirm-cancel");

    // 关闭动画 & 清理
    const cleanup = () => {
      modal.classList.add("opacity-0");
      const content = modal.querySelector("div");
      content.classList.remove("scale-100");
      content.classList.add("scale-95");

      setTimeout(() => modal.remove(), 300); // 等动画结束再移除
    };

    okBtn.addEventListener("click", () => {
      cleanup();
      resolve(true);
    });

    cancelBtn.addEventListener("click", () => {
      cleanup();
      resolve(false);
    });
  });
}

// ---------- Init (lazy: only timeline first) ----------
setActiveTab("timeline");
const requestdata = await getStorage("filterUserId");
if (requestdata.filterUserId) {
  filterUserId = requestdata.filterUserId;
  showFilterBar();
  chrome.storage.local.remove("filterUserId");
}
await rebuildTimeline();
updateTexts();

// Cleanup
window.addEventListener("beforeunload", revokeAllURLs);

// 监听翻页
window.addEventListener("scroll", updateStickyDate);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.lang) {
    resetLangData();
    updateTexts();
  }
});

function getStorage(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (data) => resolve(data));
  });
}
