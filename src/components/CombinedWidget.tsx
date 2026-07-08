import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, Camera } from 'lucide-react';
import { useDesktop } from '@/contexts/DesktopContext';
import { getEngineById, buildSearchUrl, getEngineIconSrc } from '@/lib/searchEngines';
import SearchEnginePanel from './SearchEnginePanel';

// ── 农历工具 ──────────────────────────────────────────────────────────────────
const LUNAR_MONTHS = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
const LUNAR_DAYS = [
  '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十',
];
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function getLunarDate(date: Date): string {
  const baseDate = new Date(2000, 0, 6);
  const diff = Math.floor((date.getTime() - baseDate.getTime()) / 86400000);
  let lunarYear = 1999, lunarMonth = 11, lunarDay = 0;
  if (diff >= 0) {
    let remaining = diff;
    while (remaining > 0) {
      const daysInMonth = ((lunarYear * 12 + lunarMonth) % 2 === 0) ? 30 : 29;
      const daysLeft = daysInMonth - lunarDay;
      if (remaining < daysLeft) { lunarDay += remaining; remaining = 0; }
      else {
        remaining -= daysLeft; lunarDay = 0; lunarMonth++;
        if (lunarMonth >= 12) { lunarMonth = 0; lunarYear++; }
      }
    }
  }
  return `${LUNAR_MONTHS[lunarMonth]}月${LUNAR_DAYS[lunarDay] ?? '初一'}`;
}

// ── 合并组件：时钟 + 搜索框 ──────────────────────────────────────────────────
const CombinedWidget: React.FC = () => {
  const { settings } = useDesktop();
  const [now, setNow] = useState(new Date());
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const engineBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const hours   = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const month   = now.getMonth() + 1;
  const day     = now.getDate();
  const weekday = WEEKDAYS[now.getDay()];
  const lunar   = getLunarDate(now);

  const currentEngine = getEngineById(settings.searchEngine ?? 'bing', settings.customEngines);
  const [iconErr, setIconErr] = useState(false);
  const iconSrc = getEngineIconSrc(currentEngine);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    const isUrl = /^https?:\/\//i.test(trimmed) || /^[a-zA-Z0-9-]+(\.[a-zA-Z]{2,})(\/.*)?$/.test(trimmed);
    const url = isUrl
      ? (/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
      : buildSearchUrl(currentEngine, trimmed);
    window.open(url, '_blank', 'noopener,noreferrer');
    setQuery('');
    inputRef.current?.blur();
  }, [query, currentEngine]);

  const openPanel = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = engineBtnRef.current?.getBoundingClientRect() ?? null;
    setAnchorRect(rect);
    setPanelOpen(true);
  }, []);

  return (
    <div className="flex flex-col select-none pt-3 pb-2">
      {/* 时钟区 */}
      <div className="flex flex-col items-center pb-2">
        <div
          className="text-white font-bold leading-none drop-shadow-lg"
          style={{ fontSize: 'clamp(52px, 13vw, 80px)', letterSpacing: '-2px' }}
        >
          {hours}<span className="animate-pulse opacity-80">:</span>{minutes}
        </div>
        <div className="mt-1 text-white/80 text-xs md:text-sm font-medium drop-shadow-md tracking-wide">
          {month}月{day}日&nbsp;{weekday}&nbsp;{lunar}
        </div>
      </div>

      {/* 分隔线 */}
      <div className="mx-6 border-t border-white/15 mb-2" />

      {/* 搜索框区 */}
      <div className="px-4 md:px-6">
        <form
          onSubmit={handleSubmit}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full transition-all duration-200 ${
            focused ? 'bg-white/25 ring-2 ring-white/40 shadow-lg' : 'bg-white/15 hover:bg-white/20'
          }`}
          style={{ backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}
        >
          {/* 搜索引擎图标（可点击） */}
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
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="搜索或输入网址"
            className="flex-1 min-w-0 bg-transparent text-white text-sm placeholder:text-white/50 outline-none"
            style={{ fontSize: 16 }}
          />
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" aria-label="语音搜索" className="text-white/60 hover:text-white transition-colors">
              <Mic className="w-4 h-4" />
            </button>
            <button type="button" aria-label="图片搜索" className="text-white/60 hover:text-white transition-colors">
              <Camera className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>

      {/* 搜索引擎面板（portal 到 fixed 层） */}
      {panelOpen && (
        <SearchEnginePanel anchorRect={anchorRect} onClose={() => setPanelOpen(false)} />
      )}
    </div>
  );
};

export default CombinedWidget;
