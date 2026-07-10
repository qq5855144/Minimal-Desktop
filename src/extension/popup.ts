/**
 * popup.ts — 扩展工具栏弹出面板逻辑
 *
 * 用户在任意网页点击工具栏图标 → popup.html 打开 →
 * 读取当前标签页信息 → 写入 pendingClip → 用户打开新标签页即弹出添加对话框
 */

const MAX_TITLE_LEN = 64;

function clampTitle(t: string): string {
  return t.length > MAX_TITLE_LEN ? t.slice(0, MAX_TITLE_LEN - 1) + '…' : t;
}

async function init() {
  const faviconEl = document.getElementById('favicon') as HTMLImageElement;
  const titleEl = document.getElementById('title') as HTMLElement;
  const urlEl = document.getElementById('url') as HTMLElement;
  const addBtn = document.getElementById('add-btn') as HTMLButtonElement;
  const statusEl = document.getElementById('status') as HTMLElement;
  const mainEl = document.getElementById('main') as HTMLElement;

  // 获取当前活动标签页
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  const forbidden = ['chrome://', 'chrome-extension://', 'edge://', 'about:', 'moz-extension://'];
  const isSystem = !tab?.url || forbidden.some((p) => tab.url!.startsWith(p));

  if (isSystem) {
    titleEl.textContent = '无法剪藏系统页面';
    urlEl.textContent = tab?.url ?? '';
    addBtn.disabled = true;
    addBtn.textContent = '不支持此页面';
    return;
  }

  const pageUrl = tab.url!;
  const pageTitle = clampTitle(tab.title ?? new URL(pageUrl).hostname);
  const pageFavicon = tab.favIconUrl ?? '';

  // 填充预览
  titleEl.textContent = pageTitle;
  urlEl.textContent = pageUrl;
  if (pageFavicon) {
    faviconEl.src = pageFavicon;
    faviconEl.style.display = 'block';
    faviconEl.onerror = () => { faviconEl.style.display = 'none'; };
  }

  addBtn.addEventListener('click', async () => {
    addBtn.disabled = true;
    addBtn.textContent = '正在添加…';

    await chrome.storage.local.set({
      pendingClip: { url: pageUrl, title: pageTitle, favicon: pageFavicon || undefined },
    });

    // 打开新标签页（Desktop 会读取 pendingClip 并弹出添加对话框）
    await chrome.tabs.create({});

    // 显示成功状态后自动关闭
    mainEl.style.display = 'none';
    statusEl.style.display = 'flex';
    setTimeout(() => window.close(), 900);
  });
}

init().catch(console.error);
