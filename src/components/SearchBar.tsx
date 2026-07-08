import React, { useRef, useState, useCallback } from 'react';
import { Mic, Camera } from 'lucide-react';
import { useDesktop } from '@/contexts/DesktopContext';
import { getEngineById, buildSearchUrl, getEngineIconSrc } from '@/lib/searchEngines';
import SearchEnginePanel from './SearchEnginePanel';


const SearchBar: React.FC = () => {
  const [query, setQuery] = useState('');
  const [panelOpen, setPanelOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const engineBtnRef = useRef<HTMLButtonElement>(null);
  const { settings } = useDesktop();
  const isNeu = settings.style === 'neumorphism';

  const currentEngine = getEngineById(settings.searchEngine ?? 'bing', settings.customEngines);
  const [iconErr, setIconErr] = useState(false);
  const iconSrc = getEngineIconSrc(currentEngine);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = query.trim();
      if (!trimmed) return;
      const isUrl =
        /^https?:\/\//i.test(trimmed) ||
        /^[a-zA-Z0-9-]+(\.[a-zA-Z]{2,})(\/.*)?$/.test(trimmed);
      const url = isUrl
        ? (/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
        : buildSearchUrl(currentEngine, trimmed);
      window.open(url, '_blank', 'noopener,noreferrer');
      setQuery('');
      inputRef.current?.blur();
    },
    [query, currentEngine],
  );

  const openPanel = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = engineBtnRef.current?.getBoundingClientRect() ?? null;
    setAnchorRect(rect);
    setPanelOpen(true);
  }, []);

  const formCls = isNeu
    ? 'flex items-center gap-2 px-3 py-[9px] rounded-full transition-all duration-200 neu-raised-focused'
    : 'flex items-center gap-2 px-3 py-[9px] rounded-full transition-all duration-200 bg-white/25 ring-2 ring-white/40 shadow-lg';
  const formStyle = isNeu ? {} : { backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' };
  const inputCls = isNeu
    ? 'flex-1 min-w-0 bg-transparent text-slate-700 text-sm placeholder:text-slate-400 outline-none'
    : 'flex-1 min-w-0 bg-transparent text-white text-sm placeholder:text-white/50 outline-none';
  const btnCls = isNeu
    ? 'text-slate-400 hover:text-slate-600 transition-colors'
    : 'text-white/60 hover:text-white transition-colors';

  return (
    <div className="px-[7%] pb-3">
      <form onSubmit={handleSubmit} className={formCls} style={formStyle}>
        {/* 搜索引擎图标按钮 */}
        <button
          ref={engineBtnRef}
          type="button"
          onClick={openPanel}
          aria-label="切换搜索引擎"
          className="shrink-0 w-6 h-6 flex items-center justify-center transition-transform active:scale-90"
        >
          {iconSrc && !iconErr ? (
            <img src={iconSrc} alt={currentEngine.name} width={20} height={20} className="object-contain" onError={() => setIconErr(true)} />
          ) : (
            <span className="w-6 h-6 rounded-md flex items-center justify-center text-white text-[10px] font-bold" style={{ background: currentEngine.color }}>
              {currentEngine.name.slice(0, 1)}
            </span>
          )}
        </button>

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索或输入网址后回车"
          className={inputCls}
          style={{ fontSize: 16 }}
        />
        <div className="flex items-center gap-2 shrink-0">
          <button type="button" aria-label="语音搜索" className={btnCls}>
            <Mic className="w-4 h-4" />
          </button>
          <button type="button" aria-label="图片搜索" className={btnCls}>
            <Camera className="w-4 h-4" />
          </button>
        </div>
      </form>

      {panelOpen && (
        <SearchEnginePanel anchorRect={anchorRect} onClose={() => setPanelOpen(false)} />
      )}
    </div>
  );
};

export default SearchBar;
