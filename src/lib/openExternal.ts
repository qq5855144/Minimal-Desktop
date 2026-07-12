export function openExternalUrl(url: string) {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) return;

  // 部分浏览器在 `window.open()` 前会先完成一次当前页面重绘，
  // 对桌面这种大面积模糊/滤镜场景更容易感知成“闪一下”。
  // 改用原生锚点点击，让浏览器尽早进入导航流程，减少额外重绘。
  if (typeof document !== 'undefined' && document.body) {
    const anchor = document.createElement('a');
    anchor.href = trimmedUrl;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.referrerPolicy = 'no-referrer';
    anchor.style.position = 'fixed';
    anchor.style.left = '-9999px';
    anchor.style.top = '-9999px';
    document.body.appendChild(anchor);
    anchor.click();
    window.setTimeout(() => {
      anchor.remove();
    }, 0);
    return;
  }

  window.open(trimmedUrl, '_blank', 'noopener,noreferrer');
}
