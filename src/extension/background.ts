/**
 * background.ts — MV3 Service Worker
 *
 * 功能1：点击扩展工具栏图标时，读取当前活动标签页的
 * URL / 标题 / favicon，写入 chrome.storage.local，
 * 新标签页（Desktop）打开后自动读取并弹出"添加应用"对话框。
 *
 * 功能2：代理搜索建议请求（FETCH_SUGGEST）
 * Service Worker 无 CORS 限制，可直接访问 suggestion.baidu.com
 */

export interface PendingClip {
  url: string;
  title: string;
  favicon?: string;
}

// 工具栏图标点击 → 读取当前 tab 信息 → 存入 pendingClip
chrome.action.onClicked.addListener(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return;

  // 过滤不可添加的系统页面
  const forbidden = ['chrome://', 'chrome-extension://', 'edge://', 'about:', 'moz-extension://'];
  if (forbidden.some((p) => tab.url!.startsWith(p))) {
    // 直接打开新标签（无剪藏内容）
    await chrome.tabs.create({});
    return;
  }

  const clip: PendingClip = {
    url: tab.url,
    title: tab.title ?? new URL(tab.url).hostname,
    favicon: tab.favIconUrl ?? undefined,
  };

  await chrome.storage.local.set({ pendingClip: clip });

  // 打开/聚焦新标签页，Desktop 会读取 pendingClip 并弹出添加对话框
  await chrome.tabs.create({});
});

// ── 代理搜索建议请求（绕过 CORS）─────────────────────────────────────────────
// 扩展页面（new tab）的 fetch 会携带 Origin 头，百度不返回 CORS 头导致被浏览器拦截
// Service Worker 的 fetch 不受 CORS 限制（host_permissions 足够）
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'FETCH_SUGGEST') return false;
  const wd = msg.query as string;
  const url = `https://suggestion.baidu.com/su?ie=utf-8&wd=${encodeURIComponent(wd)}&cb=sugg`;
  fetch(url)
    .then((r) => r.text())
    .then((text) => {
      const m = text.match(/\bs\s*:\s*(\[[\s\S]*?\])/);
      sendResponse({ ok: true, data: m ? JSON.parse(m[1]) : [] });
    })
    .catch(() => sendResponse({ ok: false, data: [] }));
  return true; // 保持 sendResponse 通道异步打开
});
