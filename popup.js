const langBtn = document.getElementById('langBtn');
let currentLang = localStorage.getItem('lang') || 'zh';
let langData = {};

// 载入语言文件并更新文本
async function loadLanguage(lang) {
  try {
    const response = await fetch(`lang/${lang}.json`);
    langData = await response.json();
    localStorage.setItem('lang', lang);
    currentLang = lang;
		chrome.storage.local.set({ lang: currentLang });
    langBtn.textContent = lang === 'zh' ? 'English' : '中文';

    updateTexts();
  } catch (e) {
    console.error('加载语言文件失败:', e);
  }
}

// 更新页面中所有需要翻译的文本
function updateTexts() {
  // 统计部分标签更新
  document.querySelectorAll('[data-key]').forEach(el => {
    const key = el.getAttribute('data-key');
    if (langData[key]) {
      el.textContent = langData[key];
    }
  });

  // 按钮和提示特殊更新
  document.getElementById('exportBtn').textContent = langData.exportNotes || 'Export';
  document.getElementById('importBtn').textContent = langData.importNotes || 'Import';
  document.getElementById('clearBtn').textContent = langData.clearNotes || 'Clear';

  // 最近备注无数据提示
  const recentNotesDiv = document.getElementById('recentNotes');
  const noNotesMsg = langData.noNotes || 'No notes available';
  if (recentNotesDiv.textContent.trim() === '' || recentNotesDiv.textContent.trim() === langData.noNotes || recentNotesDiv.textContent.trim() === '暂无备注数据') {
    recentNotesDiv.innerHTML = `<div style="text-align: center; color: #536471; padding: 20px;">${noNotesMsg}</div>`;
  }
}

// 语言切换按钮事件
langBtn.addEventListener('click', () => {
  const newLang = currentLang === 'zh' ? 'en' : 'zh';
  loadLanguage(newLang);
});

document.addEventListener('DOMContentLoaded', async function() {
  // 先加载语言
  await loadLanguage(currentLang);

  // 加载统计数据
  await loadStats();

  // 加载最近备注
  await loadRecentNotes();

  // 绑定其他事件
  document.getElementById('exportBtn').addEventListener('click', exportNotes);
  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('fileInput').click();
  });
  document.getElementById('fileInput').addEventListener('change', importNotes);
  document.getElementById('clearBtn').addEventListener('click', clearAllNotes);
});

async function loadStats() {
  try {
    const result = await chrome.storage.local.get(['twitterNotes']);
    const notes = result.twitterNotes || {};

    const totalNotes = Object.keys(notes).length;
    document.getElementById('totalNotes').textContent = totalNotes;

    // 计算今日新增
    const today = new Date().toDateString();
    const todayNotes = Object.values(notes).filter(note =>
      new Date(note.createdAt).toDateString() === today
    ).length;
    document.getElementById('todayNotes').textContent = todayNotes;
  } catch (error) {
    console.error('加载统计数据失败:', error);
  }
}

async function loadRecentNotes() {
  try {
    const result = await chrome.storage.local.get(['twitterNotes']);
    const notes = result.twitterNotes || {};

    const recentNotesContainer = document.getElementById('recentNotes');

    if (Object.keys(notes).length === 0) {
      recentNotesContainer.innerHTML = `
        <div style="text-align: center; color: #536471; padding: 20px;">
          ${langData.noNotes}
        </div>
      `;
      return;
    }

    // 按创建时间排序，显示最近10条
    const sortedNotes = Object.entries(notes)
      .sort(([,a], [,b]) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 10);

    recentNotesContainer.innerHTML = sortedNotes.map(([userId, note]) => {
      const noteName = note.name || ''; 
      const noteDescription = note.description || '';

      return `
        <div class="note-item">
          <div class="note-user">@${note.username || 'unknown'}</div>
          <div class="note-id">ID: ${userId}</div>
          <div class="note-name">${noteName}</div>
          ${noteDescription ? `<div class="note-desc">${noteDescription}</div>` : ''}
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('加载最近备注失败:', error);
  }
}

async function exportNotes() {
  try {
    const result = await chrome.storage.local.get(['twitterNotes']);
    const notes = result.twitterNotes || {};

    const exportData = {
      version: '2.0.0',
      exportTime: new Date().toISOString(),
      notes: notes
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json'
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `twitter-notes-${new Date().toISOString().split('T')[0]}.json`;
    a.click();

    URL.revokeObjectURL(url);

    // 显示成功消息
    showMessage(langData.exportSuccess);
  } catch (error) {
    showErrorMessage(langData.exportFail);
  }
}

async function importNotes(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const importData = JSON.parse(text);

    if (!importData.notes) {
      throw new Error(langData.invalidFormat);
    }

    // 获取现有备注
    const result = await chrome.storage.local.get(['twitterNotes']);
    const existingNotes = result.twitterNotes || {};

    // 处理导入的备注，确保格式正确
    const processedNotes = {};
    Object.entries(importData.notes).forEach(([userId, note]) => {
       processedNotes[userId] = note;
    });

    // 合并备注（导入的备注会覆盖现有的同用户备注）
    const mergedNotes = { ...existingNotes, ...processedNotes };

    await chrome.storage.local.set({ twitterNotes: mergedNotes });

    // 重新加载数据
    await loadStats();
    await loadRecentNotes();

    showMessage(`${langData.importSuccess} ${Object.keys(processedNotes).length} ${langData.notes}`);
  } catch (error) {
    showErrorMessage(langData.importFail);
  }

  // 清空文件输入
  event.target.value = '';
}

async function clearAllNotes() {
  if (!confirm(langData.confirmClear)) {
    return;
  }

  try {
    await exportNotes();
    await chrome.storage.local.remove(['twitterNotes']);
    await loadStats();
    await loadRecentNotes();

    showMessage('<span style="font-weight:bold; font-size:16px;color:#FFD700;">' + (langData.allCleared) + '</span>\n' + (langData.exportReminder));
  } catch (error) {
    showErrorMessage(langData.clearFail);
  }
}

function showMessage(messageHTML) {
	const messageDiv = document.createElement('div');
	
  // 创建临时消息提示
  
  messageDiv.innerHTML = messageHTML;
  messageDiv.style.cssText = `
    position: fixed;
    bottom: 10px;
    left: 50%;
    transform: translateX(-50%);
    background: mediumseagreen;
    color: white;
    padding: 8px 16px;
    border-radius: 4px;
    font-size: 12px;
    z-index: 1000;
    white-space: pre-wrap;
  `;
	
	// 创建关闭按钮元素
	const closeBtn = document.createElement('button');
	closeBtn.textContent = '×';
	closeBtn.style.cssText = `
		position: absolute;
		top: 2px;
		right: 2px;
		background: transparent;
		border: none;
		color: rebeccapurple;
		font-size: 16px;
		font-weight: bold;
		cursor: pointer;
		line-height: 1;
	`;
	
	// 关闭按钮点击时隐藏或移除消息弹窗
	closeBtn.onclick = () => {
		messageDiv.style.display = 'none';
	};
	messageDiv.appendChild(closeBtn);
	
  document.body.appendChild(messageDiv);

  setTimeout(() => {
    document.body.removeChild(messageDiv);
  }, 8000);
}

function showErrorMessage(messageHTML) {
	const messageDiv = document.createElement('div');
	
  // 创建临时消息提示
  
  messageDiv.innerHTML = messageHTML;
  messageDiv.style.cssText = `
    position: fixed;
    bottom: 10px;
    left: 50%;
    transform: translateX(-50%);
    background: red;
    color: white;
    padding: 8px 16px;
    border-radius: 4px;
    font-size: 12px;
		font-weight: bold;
    z-index: 1000;
    white-space: pre-wrap;
  `;
	
	// 创建关闭按钮元素
	const closeBtn = document.createElement('button');
	closeBtn.textContent = '×';
	closeBtn.style.cssText = `
		position: absolute;
		top: 2px;
		right: 2px;
		background: transparent;
		border: none;
		color: darkblue;
		font-size: 16px;
		font-weight: bold;
		cursor: pointer;
		line-height: 1;
	`;
	
	// 关闭按钮点击时隐藏或移除消息弹窗
	closeBtn.onclick = () => {
		messageDiv.style.display = 'none';
	};
	messageDiv.appendChild(closeBtn);
	
  document.body.appendChild(messageDiv);

  setTimeout(() => {
    document.body.removeChild(messageDiv);
  }, 8000);
}