const SUGGEST_MESSAGE_TYPE = 'MINIMAL_DESKTOP_SUGGEST_RESULT';
const SUGGEST_LIMIT = 10;
const SUGGEST_TIMEOUT_MS = 5000;

export function normalizeSuggestionList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    const suggestion = value.trim().slice(0, 160);
    if (!suggestion || seen.has(suggestion)) continue;
    seen.add(suggestion);
    result.push(suggestion);
    if (result.length >= SUGGEST_LIMIT) break;
  }
  return result;
}

function createRequestToken(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const randomPart = crypto.getRandomValues(new Uint32Array(2)).join('-');
  return `${Date.now()}-${randomPart}`;
}

/**
 * GitHub Pages 等纯静态部署无法代理跨域请求。这里把百度 JSONP 放进没有
 * allow-same-origin 权限的 sandbox iframe：远程脚本可运行并回传建议，但无法
 * 读取父页面 DOM、localStorage、IndexedDB 或桌面状态。
 *
 * 注意：iframe 必须通过 src 加载同源的 suggest.html，而不是 srcdoc——
 * srcdoc 文档会继承父页面的 CSP（当前 index.html 为 script-src 'self'，
 * 不支持内联脚本），导致引导脚本与百度 JSONP 都被阻止；独立子页面不受
 * 父 CSP 约束，沙箱隔离依然生效（sandbox 仅 allow-scripts）。
 */
export function fetchSandboxedBaiduSuggest(
  query: string,
  signal: AbortSignal,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const token = createRequestToken();
    const iframe = document.createElement('iframe');
    iframe.hidden = true;
    iframe.tabIndex = -1;
    iframe.setAttribute('aria-hidden', 'true');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.referrerPolicy = 'no-referrer';

    const requestUrl = new URL('https://suggestion.baidu.com/su');
    requestUrl.searchParams.set('ie', 'utf-8');
    requestUrl.searchParams.set('wd', query);
    requestUrl.searchParams.set('cb', '__minimalDesktopSuggest');

    // 参数经 hash 传递：不触发服务器请求/重写，也不出现在服务端日志。
    // 相对路径解析可适配 GitHub Pages 子路径（/Minimal-Desktop/）部署。
    const helperUrl = new URL('suggest.html', window.location.href);
    helperUrl.hash = encodeURIComponent(
      JSON.stringify({
        type: SUGGEST_MESSAGE_TYPE,
        token,
        url: requestUrl.toString(),
      }),
    );
    iframe.src = helperUrl.toString();

    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      clearTimeout(timeoutId);
      signal.removeEventListener('abort', onAbort);
      window.removeEventListener('message', onMessage);
      iframe.remove();
    };
    const finish = (suggestions: string[]) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(suggestions);
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      const message = event.data as { type?: unknown; token?: unknown; data?: unknown } | null;
      if (
        !message
        || message.type !== SUGGEST_MESSAGE_TYPE
        || message.token !== token
      ) return;
      finish(normalizeSuggestionList(message.data));
    };

    signal.addEventListener('abort', onAbort, { once: true });
    window.addEventListener('message', onMessage);
    timeoutId = setTimeout(() => finish([]), SUGGEST_TIMEOUT_MS);
    (document.body ?? document.documentElement).appendChild(iframe);
  });
}
