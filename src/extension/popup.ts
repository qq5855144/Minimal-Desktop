/**
 * popup.ts — 扩展工具栏弹出面板逻辑
 *
 * 用户在任意网页点击工具栏图标 → popup.html 打开 →
 * 读取当前标签页信息 → 写入 pendingClip → 用户打开新标签页即弹出添加对话框
 */

const MAX_TITLE_LEN = 64;

/**
 * 从网页标题中提取纯网站名称。
 *
 * 第一步：按常见文字分隔符切割，取第一段
 *   例：「秒哒-无代码应用搭建平台」→「秒哒」
 *       「GitHub - Where the world builds software」→「GitHub」
 *
 * 第二步：若第一段中存在"空格 + 非正文字符"（括号、颜文字、符号等），
 *   在该空格处进一步截断
 *   例：「哔哩哔哩 (゜-゜)つロ 干杯~」→「哔哩哔哩」
 *       「GitHub Actions」→ 保留（空格后是普通字母，不截断）
 */
function extractSiteName(raw: string): string {
  const trimmed = raw.trim();

  // 第一步：按硬分隔符切割（- | – — , · /）
  const sep1 = trimmed.match(/^(.+?)\s*[-|–—,·\/]\s*.+$/);
  let name = sep1 ? sep1[1].trim() : trimmed;

  // 第二步：若空格后紧跟非正文字符（括号/颜文字/装饰符号），在该空格处截断
  const sep2 = name.match(/^(.+?)\s+(?=[\(\[\{<（【《『「'"'"@#$%^&*~`！？。，、；：☆★♪♫♬♩©®™°•])/u);
  if (sep2) name = sep2[1].trim();

  return name.length > MAX_TITLE_LEN ? name.slice(0, MAX_TITLE_LEN - 1) + '…' : name;
}

async function init() {
  const faviconEl  = document.getElementById('favicon') as HTMLImageElement;
  const faviconPh  = document.getElementById('favicon-ph') as HTMLElement;
  const titleEl    = document.getElementById('title') as HTMLElement;
  const urlEl      = document.getElementById('url') as HTMLElement;
  const addBtn     = document.getElementById('add-btn') as HTMLButtonElement;
  const statusEl   = document.getElementById('status') as HTMLElement;
  const mainEl     = document.getElementById('main') as HTMLElement;

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

  addBtn.addEventListener('click', async () => {
    addBtn.disabled = true;
    const btnText = addBtn.childNodes[addBtn.childNodes.length - 1];
    if (btnText?.nodeType === Node.TEXT_NODE) btnText.textContent = '正在添加…';

    await chrome.storage.local.set({
      pendingClip: { url: pageUrl, title: pageTitle, favicon: pageFavicon || undefined },
    });

    await chrome.tabs.create({});

    mainEl.style.display = 'none';
    statusEl.style.display = 'flex';
    setTimeout(() => window.close(), 1200);
  });
}

init().catch(console.error);
