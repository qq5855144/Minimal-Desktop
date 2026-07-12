const IS_EXTENSION = import.meta.env.VITE_IS_EXTENSION === 'true';
const EXTENSION_OPEN_DELAY_MS = 90;

function markExternalLaunch() {
  if (typeof document === 'undefined') {
    return () => {};
  }

  const html = document.documentElement;
  const body = document.body;
  const previousActive = document.activeElement;

  html.dataset.externalLaunch = 'true';
  if (body) {
    body.dataset.externalLaunch = 'true';
  }
  if (previousActive instanceof HTMLElement) {
    previousActive.blur();
  }

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    delete html.dataset.externalLaunch;
    if (body) {
      delete body.dataset.externalLaunch;
    }
    window.removeEventListener('focus', release);
    window.removeEventListener('pageshow', release);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      release();
    }
  };

  window.addEventListener('focus', release);
  window.addEventListener('pageshow', release);
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.setTimeout(release, 1500);

  return release;
}

function openViaBackground(url: string): boolean {
  if (
    !IS_EXTENSION ||
    typeof chrome === 'undefined' ||
    !chrome?.runtime?.sendMessage
  ) {
    return false;
  }

  chrome.runtime.sendMessage(
    {
      type: 'OPEN_EXTERNAL_URL',
      url,
      delayMs: EXTENSION_OPEN_DELAY_MS,
    },
    (response?: { ok?: boolean }) => {
      if (chrome.runtime.lastError || !response?.ok) {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    },
  );

  return true;
}

export function openExternalUrl(url: string) {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) return;

  // 部分浏览器在 `window.open()` 前会先完成一次当前页面重绘，
  // 对桌面这种大面积模糊/滤镜场景更容易感知成“闪一下”。
  // 改用原生锚点点击，并在打开前短暂冻结当前页的点击态/过渡，
  // 以减少 active 态和 backdrop-filter 合成层一起抖动的概率。
  if (typeof document !== 'undefined' && document.body) {
    markExternalLaunch();
    if (openViaBackground(trimmedUrl)) {
      return;
    }
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
    });
    return;
  }

  window.open(trimmedUrl, '_blank', 'noopener,noreferrer');
}
