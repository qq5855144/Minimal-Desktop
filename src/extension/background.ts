/**
 * background.ts — MV3 Service Worker
 *
 * 功能：点击扩展工具栏图标时，读取当前活动标签页的
 * URL / 标题 / favicon，写入 chrome.storage.local，
 * 新标签页（Desktop）打开后自动读取并弹出"添加应用"对话框。
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
