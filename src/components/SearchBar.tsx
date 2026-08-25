import { Mic, ScanLine } from 'lucide-react';
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
    ? `flex h-[42px] items-center gap-2 rounded-[10px] border-2 bg-transparent px-3 transition-all duration-200 ${
      isNeu
        ? 'border-slate-400/80 shadow-[0_4px_12px_rgba(148,163,184,0.18)]'
        : 'border-white/90 shadow-[0_4px_14px_rgba(0,0,0,0.10)]'
    }`
    : isNeu
      ? 'flex h-[42px] items-center gap-2 rounded-full px-3 transition-all duration-200 neu-raised-focused'
      : 'flex h-[42px] items-center gap-2 rounded-full bg-white/25 px-3 shadow-lg transition-all duration-200';
  const formStyle = isOutline || isNeu
    ? {}
    : { backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' };
  const inputCls = isNeu
    ? 'flex-1 min-w-0 bg-transparent text-slate-700 text-sm placeholder:text-slate-400 outline-none cursor-pointer'
    : 'flex-1 min-w-0 bg-transparent text-white text-sm placeholder:text-white/50 outline-none cursor-pointer';

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

        {/* 只读占位输入框（视觉一致，点击由父层打开搜索屏） */}
        <span className={inputCls} style={{ fontSize: 14 }}>
          搜索或输入网址后回车
        </span>

        {/* 右侧功能图标 */}
        <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
          <button type="button" aria-label="语音搜索"
            className={isNeu ? 'text-slate-400 hover:text-slate-600 transition-colors' : 'text-white/60 hover:text-white transition-colors'}>
            <Mic className="w-4 h-4" />
          </button>
          <button type="button" aria-label="扫码搜索"
            className={isNeu ? 'text-slate-400 hover:text-slate-600 transition-colors' : 'text-white/60 hover:text-white transition-colors'}>
            <ScanLine className="w-4 h-4" />
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
