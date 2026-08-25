import { Mic, ScanLine, Search } from 'lucide-react';
import React, { useCallback, useRef, useState } from 'react';
import { useDesktop } from '@/contexts/DesktopContext';
import { getEngineById, getEngineIconSrc } from '@/lib/searchEngines';
import SearchEnginePanel from './SearchEnginePanel';
import SearchScreen from './SearchScreen';


const SearchBar: React.FC = () => {
  const [panelOpen, setPanelOpen] = useState(false);
  const [searchScreenOpen, setSearchScreenOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const engineBtnRef = useRef<HTMLButtonElement>(null);
  const { settings } = useDesktop();
  const isNeu = settings.style === 'neumorphism';
  const isOutline = settings.searchBarStyle === 'outline';

  const currentEngine = getEngineById(
    settings.searchEngine ?? 'bing',
    settings.customEngines,
    settings.deletedSearchEngineIds,
  );
  const [iconErr, setIconErr] = useState(false);
  const iconSrc = getEngineIconSrc(currentEngine);

  const openPanel = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setAnchorRect(engineBtnRef.current?.getBoundingClientRect() ?? null);
    setPanelOpen(true);
  }, []);

  const formCls = isOutline
    ? `flex items-center gap-3 px-3.5 py-2.5 rounded-[22px] border-[3px] transition-all duration-200 shadow-[0_10px_28px_rgba(0,0,0,0.10)] ${
      isNeu ? 'border-slate-400/80 text-slate-700' : 'border-white/95 text-white'
    }`
    : isNeu
      ? 'flex items-center gap-2 px-3 py-[9px] rounded-full transition-all duration-200 neu-raised-focused'
      : 'flex items-center gap-2 px-3 py-[9px] rounded-full transition-all duration-200 bg-white/25 shadow-lg';
  const formStyle = isNeu && !isOutline ? {} : {
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    background: isOutline ? 'rgba(255,255,255,0.06)' : undefined,
  };
  const inputCls = isNeu
    ? 'flex-1 min-w-0 bg-transparent text-slate-700 placeholder:text-slate-400 outline-none cursor-pointer'
    : 'flex-1 min-w-0 bg-transparent text-white placeholder:text-white/70 outline-none cursor-pointer';

  return (
    <div className="desktop-widget-search-padding pb-3">
      {/* 搜索栏外壳：点击任意位置打开搜索专用屏 */}
      <div
        className={formCls}
        style={formStyle}
        onClick={() => setSearchScreenOpen(true)}
        role="button"
        data-press-intent-surface="true"
        tabIndex={0}
        aria-label="打开搜索"
        onKeyDown={(e) => e.key === 'Enter' && setSearchScreenOpen(true)}
      >
        {/* 搜索引擎图标按钮（点击不打开搜索屏，改为切换引擎面板） */}
        <button
          ref={engineBtnRef}
          type="button"
          onClick={openPanel}
          aria-label="切换搜索引擎"
          className={`shrink-0 flex items-center justify-center transition-transform active:scale-90 ${isOutline ? 'w-9 h-9 rounded-full border-[3px] border-current' : 'w-6 h-6'}`}
        >
          {isOutline ? (
            <Search className="w-5 h-5" strokeWidth={3} />
          ) : iconSrc && !iconErr ? (
            <img src={iconSrc} alt={currentEngine.name} width={20} height={20} className="object-contain" onError={() => setIconErr(true)} />
          ) : (
            <span className="w-6 h-6 rounded-md flex items-center justify-center text-white text-[10px] font-bold" style={{ background: currentEngine.color }}>
              {currentEngine.name.slice(0, 1)}
            </span>
          )}
        </button>

        {/* 只读占位输入框（视觉一致，点击由父层打开搜索屏） */}
        <span className={`${inputCls} ${isOutline ? 'font-semibold tracking-tight' : ''}`} style={{ fontSize: isOutline ? 16 : 14 }}>
          搜索或输入网址
        </span>

        {/* 右侧功能图标 */}
        <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
          <button type="button" aria-label="语音搜索"
            className={isNeu ? 'text-slate-400 hover:text-slate-600 transition-colors' : 'text-white/70 hover:text-white transition-colors'}>
            <Mic className={isOutline ? 'w-5 h-5' : 'w-4 h-4'} />
          </button>
          <button type="button" aria-label="扫码搜索"
            className={isNeu ? 'text-slate-400 hover:text-slate-600 transition-colors' : 'text-white/70 hover:text-white transition-colors'}>
            <ScanLine className={isOutline ? 'w-6 h-6' : 'w-4 h-4'} strokeWidth={isOutline ? 2.5 : 2} />
          </button>
        </div>
      </div>

      {/* 搜索引擎切换面板 */}
      {panelOpen && (
        <SearchEnginePanel anchorRect={anchorRect} onClose={() => setPanelOpen(false)} />
      )}

      {/* 搜索专用屏 */}
      <SearchScreen
        open={searchScreenOpen}
        onClose={() => setSearchScreenOpen(false)}
      />
    </div>
  );
};

export default SearchBar;
