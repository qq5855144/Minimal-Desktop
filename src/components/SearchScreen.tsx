/**
 * SearchScreen — 搜索专用全屏覆盖层
 * - 打开时自动聚焦输入框
 * - 空查询时显示搜索历史（本地存储，最多 20 条）
 * - 有输入时实时拉取百度搜索建议（JSONP）
 * - 与主页搜索框使用相同的引擎 & 跳转逻辑
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpLeft, Clock, Search, X } from 'lucide-react';
import { useDesktop } from '@/contexts/DesktopContext';
import { buildSearchUrl, getEngineById, getEngineIconSrc } from '@/lib/searchEngines';

// ── 历史记录工具 ──────────────────────────────────────────────────────────────
const HISTORY_KEY = 'search-history';
const MAX_HISTORY = 20;

function loadHistory(): string[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function saveHistory(list: string[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, MAX_HISTORY)));
}

function pushHistory(query: string) {
  const list = loadHistory().filter((h) => h !== query);
  saveHistory([query, ...list]);
}

// ── 百度搜索建议 ──────────────────────────────────────────────────────────────
// 三种环境策略：
//   1. 扩展环境 (VITE_IS_EXTENSION=true)：background SW 代理（无 Origin 头，绕过 CORS）
//   2. Web 环境：通过 cors.sh 代理转发（返回 Access-Control-Allow-Origin: *）

// 内存缓存：最近 30 条，避免重复请求同一关键词
const suggestCache = new Map<string, string[]>();
const CACHE_MAX = 30;
function cacheSet(key: string, val: string[]) {
  if (suggestCache.size >= CACHE_MAX) suggestCache.delete(suggestCache.keys().next().value!);
  suggestCache.set(key, val);
}

async function fetchBaiduSuggest(wd: string, signal: AbortSignal): Promise<string[]> {
  // 缓存命中直接返回
  if (suggestCache.has(wd)) return suggestCache.get(wd)!;

  // ── 扩展环境：background service worker 代理 ──────────────────────────────
  if (import.meta.env.VITE_IS_EXTENSION === 'true') {
    try {
      const resp = await new Promise<{ ok: boolean; data: string[] }>((resolve, reject) => {
        if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
        chrome.runtime.sendMessage({ type: 'FETCH_SUGGEST', query: wd }, (res) => {
          if (chrome.runtime.lastError) { reject(chrome.runtime.lastError); return; }
          resolve(res);
        });
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
      const result = resp?.ok ? (resp.data ?? []) : [];
      if (result.length) cacheSet(wd, result);
      return result;
    } catch {
      return [];
    }
  }

  // ── Web 环境：cors.sh 代理（支持 CORS，适用于 dev 和 GitHub Pages prod）──
  try {
    const baiduUrl = `https://suggestion.baidu.com/su?ie=utf-8&wd=${encodeURIComponent(wd)}&cb=sugg`;
    const url = `https://cors.sh/${baiduUrl}`;
    const text = await fetch(url, { signal }).then((r) => r.text());
    const m = text.match(/\bs\s*:\s*(\[[\s\S]*?\])/);
    if (!m) return [];
    const result = JSON.parse(m[1]) as string[];
    if (result.length) cacheSet(wd, result);
    return result;
  } catch {
    return [];
  }
}

// ── Props ────────────────────────────────────────────────────────────────────
interface SearchScreenProps {
  open: boolean;
  onClose: () => void;
  initialQuery?: string;
}

// ── 主组件 ───────────────────────────────────────────────────────────────────
const SearchScreen: React.FC<SearchScreenProps> = ({ open, onClose, initialQuery = '' }) => {
  const { settings } = useDesktop();
  const [query, setQuery] = useState(initialQuery);
  const [suggests, setSuggests] = useState<string[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [iconErr, setIconErr] = useState(false);

  const isNeu = settings.style === 'neumorphism';
  const currentEngine = getEngineById(settings.searchEngine ?? 'bing', settings.customEngines);
  const iconSrc = getEngineIconSrc(currentEngine);

  // 打开时刷新历史 & 聚焦
  useEffect(() => {
    if (!open) return;
    setHistory(loadHistory());
    setQuery(initialQuery);
    setSuggests([]);
    setTimeout(() => inputRef.current?.focus(), 80);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // 原生 touch 事件拦截：SearchScreen 挂载在 Desktop 的 swipeContainerRef 内部，
  // React 合成事件 stopPropagation 无法阻断 Desktop 注册的原生 addEventListener，
  // 必须在顶层 div 上注册原生监听器，在原生冒泡阶段直接截断。
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    const stop = (e: TouchEvent) => e.stopPropagation();
    el.addEventListener('touchstart', stop, { passive: true });
    el.addEventListener('touchmove', stop, { passive: false });
    el.addEventListener('touchend', stop, { passive: true });
    el.addEventListener('touchcancel', stop, { passive: true });
    return () => {
      el.removeEventListener('touchstart', stop);
      el.removeEventListener('touchmove', stop);
      el.removeEventListener('touchend', stop);
      el.removeEventListener('touchcancel', stop);
    };
  }, []);

  // 实时拉取建议（防抖 150ms + AbortController 取消旧请求）
  useEffect(() => {
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    const trimmed = query.trim();
    if (!trimmed) { setSuggests([]); return; }
    suggestTimer.current = setTimeout(() => {
      // 取消上一次未完成的请求
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      const ctrl = abortRef.current;
      fetchBaiduSuggest(trimmed, ctrl.signal).then((list) => {
        if (!ctrl.signal.aborted) setSuggests(list);
      });
    }, 150);
    return () => {
      if (suggestTimer.current) clearTimeout(suggestTimer.current);
    };
  }, [query]);

  // 执行搜索
  const doSearch = useCallback((term: string) => {
    const t = term.trim();
    if (!t) return;
    pushHistory(t);
    const isUrl =
      /^https?:\/\//i.test(t) ||
      /^[a-zA-Z0-9-]+(\.[a-zA-Z]{2,})(\/.*)?$/.test(t);
    const url = isUrl
      ? (/^https?:\/\//i.test(t) ? t : `https://${t}`)
      : buildSearchUrl(currentEngine, t);
    window.open(url, '_blank', 'noopener,noreferrer');
    setHistory(loadHistory());
    onClose();
  }, [currentEngine, onClose]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    doSearch(query);
  };

  const fillQuery = (term: string) => {
    setQuery(term);
    inputRef.current?.focus();
  };

  const deleteHistory = (item: string) => {
    const next = history.filter((h) => h !== item);
    setHistory(next);
    saveHistory(next);
  };

  const clearAllHistory = () => {
    setHistory([]);
    saveHistory([]);
  };

  if (!open) return null;

  // 样式变量
  const isGlass = !isNeu;
  const overlayBg = isGlass
    ? 'bg-black/30 backdrop-blur-2xl'
    : 'bg-[#dde4f0]';  // 与拟态底色精确匹配
  const inputBar = isGlass
    ? 'flex items-center gap-2 px-3 py-[9px] rounded-full bg-white/25 shadow-lg'
    : 'flex items-center gap-2 px-3 py-[9px] rounded-full neu-raised-focused';
  const inputCls = isGlass
    ? 'flex-1 min-w-0 bg-transparent text-white placeholder:text-white/50 outline-none text-sm'
    : 'flex-1 min-w-0 bg-transparent text-slate-700 placeholder:text-slate-400 outline-none text-sm';
  const labelCls = isGlass ? 'text-white/70 text-sm font-medium' : 'text-slate-500 text-sm font-medium';
  const itemBg = isGlass ? 'bg-white/15 hover:bg-white/25' : 'neu-suggest-item';  // 拟态用专属样式
  const itemTextCls = isGlass ? 'text-white text-sm' : 'text-slate-700 text-sm';
  const iconCls = isGlass ? 'text-white/50 shrink-0 w-4 h-4' : 'text-slate-400 shrink-0 w-4 h-4';
  const actionCls = isGlass
    ? 'shrink-0 text-white/40 hover:text-white/80 transition-colors'
    : 'shrink-0 text-slate-400 hover:text-slate-600 transition-colors';

  return (
    <div
      ref={overlayRef}
      className={`fixed inset-0 z-[500] flex flex-col rounded-none ${overlayBg}`}
      style={isGlass ? { backdropFilter: 'blur(32px)', WebkitBackdropFilter: 'blur(32px)', borderRadius: 0 } : { borderRadius: 0 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex flex-col w-full max-w-xl mx-auto px-4 pt-12 gap-4 flex-1 min-h-0">
        {/* 搜索栏 */}
        <form onSubmit={handleSubmit}>
          <div className={inputBar} style={isGlass ? { backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' } : {}}>
            {/* 引擎图标 */}
            <span className="shrink-0 w-6 h-6 flex items-center justify-center">
              {iconSrc && !iconErr ? (
                <img src={iconSrc} alt={currentEngine.name} width={22} height={22} className="object-contain" onError={() => setIconErr(true)} />
              ) : (
                <span className="w-6 h-6 rounded-md flex items-center justify-center text-white text-[10px] font-bold" style={{ background: currentEngine.color }}>
                  {currentEngine.name.slice(0, 1)}
                </span>
              )}
            </span>

            <input
              ref={inputRef}
              type="text"
              inputMode="search"
              enterKeyHint="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索或输入网址后回车"
              className={inputCls}
              style={{ fontSize: 14 }}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
            />

            {/* 右侧唯一 × 按钮：有内容=清空，无内容=关闭搜索屏 */}
            <button
              type="button"
              onClick={() => (query ? setQuery('') : onClose())}
              className={actionCls}
              aria-label={query ? '清空输入' : '关闭搜索'}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </form>

        {/* 内容区：建议 / 历史 */}
        <div
          className="flex-1 overflow-y-auto min-h-0 scrollbar-none space-y-2 pb-8 px-3 py-1"
          onTouchMove={(e) => e.stopPropagation()}
        >
          {query.trim() ? (
            /* 搜索建议 */
            <>
              <p className={labelCls}>搜索建议</p>
              <div className="space-y-1.5">
                {suggests.length === 0 && (
                  /* 建议加载中 or 无结果：直接回车搜索提示 */
                  <div className={`flex items-center gap-3 px-3 py-3 rounded-2xl ${itemBg} cursor-pointer transition-all active:scale-[0.98]`}
                    onClick={() => doSearch(query)}>
                    <Search className={iconCls} />
                    <span className={`${itemTextCls} flex-1 min-w-0 truncate`}>{query}</span>
                    <ArrowUpLeft className={actionCls + ' w-4 h-4'} />
                  </div>
                )}
                {suggests.map((s) => (
                  <div
                    key={s}
                    className={`flex items-center gap-3 px-3 py-3 rounded-2xl ${itemBg} cursor-pointer transition-all active:scale-[0.98]`}
                    onClick={() => doSearch(s)}
                  >
                    <Search className={iconCls} />
                    <span className={`${itemTextCls} flex-1 min-w-0 truncate`}>{s}</span>
                    {/* 填入输入框箭头 */}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); fillQuery(s); }}
                      className={actionCls}
                      aria-label="填入搜索框"
                    >
                      <ArrowUpLeft className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : (
            /* 搜索历史 */
            history.length > 0 && (
              <>
                <div className="flex items-center justify-between">
                  <p className={labelCls}>搜索历史</p>
                  <button type="button" onClick={clearAllHistory} className={actionCls + ' text-xs'}>
                    清除全部
                  </button>
                </div>
                <div className="space-y-1.5">
                  {history.map((h) => (
                    <div
                      key={h}
                      className={`flex items-center gap-3 px-3 py-3 rounded-2xl ${itemBg} cursor-pointer transition-all active:scale-[0.98]`}
                      onClick={() => doSearch(h)}
                    >
                      <Clock className={iconCls} />
                      <span className={`${itemTextCls} flex-1 min-w-0 truncate`}>{h}</span>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); deleteHistory(h); }}
                        className={actionCls}
                        aria-label="删除该条历史"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
};

export default SearchScreen;
