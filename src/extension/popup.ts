/**
 * popup.ts — 扩展工具栏弹出面板逻辑
 *
 * 用户在任意网页点击工具栏图标 → popup.html 打开 →
 * 读取当前标签页信息 → 写入 pendingClip → 用户打开新标签页即弹出添加对话框
 */

import { extractSiteName } from '../lib/webClip';

async function init() {
  const faviconEl  = document.getElementById('favicon') as HTMLImageElement;
  const faviconPh  = document.getElementById('favicon-ph') as HTMLElement;
  const titleEl    = document.getElementById('title') as HTMLElement;
  const urlEl      = document.getElementById('url') as HTMLElement;
  const targetEls = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-clip-target]'));
  const statusEl   = document.getElementById('status') as HTMLElement;
  const mainEl     = document.getElementById('main') as HTMLElement;

  // 获取当前活动标签页
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  const forbidden = ['chrome://', 'chrome-extension://', 'edge://', 'about:', 'moz-extension://'];
  const isSystem = !tab?.url || forbidden.some((p) => tab.url!.startsWith(p)) || !/^https?:\/\//i.test(tab.url);

  if (isSystem) {
    titleEl.textContent = '无法剪藏系统页面';
    urlEl.textContent = tab?.url ?? '';
    targetEls.forEach((button) => { button.disabled = true; });
    return;
  }

  const pageUrl   = tab.url!;
  // 应用标题提取规则：只取分隔符前的网站名称
  const pageTitle = tab.title ? extractSiteName(tab.title) : new URL(pageUrl).hostname;
  const pageFavicon = tab.favIconUrl ?? '';

  // 填充预览
  titleEl.textContent = pageTitle;
  urlEl.textContent = pageUrl;

  // favicon 处理：加载成功后隐藏占位符；失败则保留占位符
  if (pageFavicon) {
    faviconEl.onload  = () => {
      faviconEl.style.display = 'block';
      faviconPh.style.display = 'none';   // 隐藏地球占位符
    };
    faviconEl.onerror = () => {
      faviconEl.style.display = 'none';
      faviconPh.style.display = 'flex';   // 保留占位符
    };
    faviconEl.src = pageFavicon;
  }
  // 无 favicon 时占位符默认可见（HTML 中 display:flex）



  targetEls.forEach((button) => button.addEventListener('click', async () => { const target = button.dataset.clipTarget as 'desktop' | 'bookmarks';
    targetEls.forEach((button) => { button.disabled = true; });
    button.textContent = '正在添加…';

    try {
    await chrome.storage.local.set({
      pendingClip: { id: crypto.randomUUID(), target, url: pageUrl, title: pageTitle, favicon: pageFavicon || undefined },
    });

    await chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });

    mainEl.style.display = 'none';
    statusEl.style.display = 'flex';
    const success = statusEl.querySelector('.success-text');
    if (success) success.textContent = '正在保存';
    setTimeout(() => window.close(), 1200);
    } catch { targetEls.forEach((item) => { item.disabled = false; }); button.textContent = target === 'bookmarks' ? '添加到书签' : '添加到桌面'; }
  }));
}

init().catch(console.error);
