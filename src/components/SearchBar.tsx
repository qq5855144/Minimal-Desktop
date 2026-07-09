import React, { useRef, useState, useCallback } from 'react';
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

  const currentEngine = getEngineById(settings.searchEngine ?? 'bing', settings.customEngines);
  const [iconErr, setIconErr] = useState(false);
  const iconSrc = getEngineIconSrc(currentEngine);

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
    ? 'flex-1 min-w-0 bg-transparent text-slate-700 text-sm placeholder:text-slate-400 outline-none cursor-pointer'
    : 'flex-1 min-w-0 bg-transparent text-white text-sm placeholder:text-white/50 outline-none cursor-pointer';

  return (
    <div className="px-[7%] md:px-[15%] pb-3">
      {/* 搜索栏外壳：点击任意位置打开搜索专用屏 */}
      <div
        className={formCls}
        style={formStyle}
        onClick={() => setSearchScreenOpen(true)}
        role="button"
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
