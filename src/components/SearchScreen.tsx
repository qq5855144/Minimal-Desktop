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

// ── 百度搜索建议（JSONP）──────────────────────────────────────────────────────
function fetchBaiduSuggest(wd: string): Promise<string[]> {
  return new Promise((resolve) => {
    const cbName = `__bsug_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    const cleanup = () => {
      try { document.head.removeChild(script); } catch { /* ignore */ }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any)[cbName];
    };
    script.onerror = () => { cleanup(); resolve([]); };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any)[cbName] = (data: { s?: string[] }) => {
      cleanup();
      resolve(data?.s ?? []);
    };
    script.src = `https://suggestion.baidu.com/su?ie=utf-8&wd=${encodeURIComponent(wd)}&cb=${cbName}`;
    document.head.appendChild(script);
    setTimeout(() => { cleanup(); resolve([]); }, 5000);
  });
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
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // 实时拉取建议（防抖 300ms）
  useEffect(() => {
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    const trimmed = query.trim();
    if (!trimmed) { setSuggests([]); return; }
    suggestTimer.current = setTimeout(async () => {
      const list = await fetchBaiduSuggest(trimmed);
      setSuggests(list);
    }, 300);
    return () => { if (suggestTimer.current) clearTimeout(suggestTimer.current); };
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
    : 'bg-[#dde3ea]';
  const inputBar = isGlass
    ? 'flex items-center gap-2.5 px-3 py-2.5 rounded-2xl bg-white/20 ring-2 ring-white/40 shadow-lg'
    : 'flex items-center gap-2.5 px-3 py-2.5 rounded-2xl neu-raised-focused';
  const inputCls = isGlass
    ? 'flex-1 min-w-0 bg-transparent text-white placeholder:text-white/50 outline-none text-base'
    : 'flex-1 min-w-0 bg-transparent text-slate-700 placeholder:text-slate-400 outline-none text-base';
  const labelCls = isGlass ? 'text-white/70 text-sm font-medium' : 'text-slate-500 text-sm font-medium';
  const itemBg = isGlass ? 'bg-white/15 hover:bg-white/25' : 'bg-white hover:bg-slate-50 shadow-sm';
  const itemTextCls = isGlass ? 'text-white text-sm' : 'text-slate-700 text-sm';
  const iconCls = isGlass ? 'text-white/50 shrink-0 w-4 h-4' : 'text-slate-400 shrink-0 w-4 h-4';
  const actionCls = isGlass
    ? 'shrink-0 text-white/40 hover:text-white/80 transition-colors'
    : 'shrink-0 text-slate-300 hover:text-slate-500 transition-colors';

  return (
    <div
      className={`fixed inset-0 z-[500] flex flex-col rounded-none ${overlayBg}`}
      style={isGlass ? { backdropFilter: 'blur(32px)', WebkitBackdropFilter: 'blur(32px)', borderRadius: 0 } : { borderRadius: 0 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex flex-col w-full max-w-xl mx-auto px-4 pt-12 gap-4 flex-1 overflow-hidden">
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
              style={{ fontSize: 16 }}
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
        <div className="flex-1 overflow-y-auto min-h-0 space-y-2 pb-8">
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
