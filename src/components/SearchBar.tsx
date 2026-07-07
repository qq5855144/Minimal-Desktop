import React, { useState, useRef, useCallback } from 'react';
import { Search, Mic, Camera } from 'lucide-react';
import { useDesktop } from '@/contexts/DesktopContext';

const SearchBar: React.FC = () => {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { settings } = useDesktop();
  const isNeu = settings.style === 'neumorphism';

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = query.trim();
      if (!trimmed) return;
      const isUrl =
        /^https?:\/\//i.test(trimmed) ||
        /^[a-zA-Z0-9-]+(\.[a-zA-Z]{2,})(\/.*)?$/.test(trimmed);
      if (isUrl) {
        const url = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
        window.open(url, '_blank', 'noopener,noreferrer');
      } else {
        window.open(
          `https://www.bing.com/search?q=${encodeURIComponent(trimmed)}`,
          '_blank',
          'noopener,noreferrer',
        );
      }
      setQuery('');
      inputRef.current?.blur();
    },
    [query],
  );

  const formCls = isNeu
    ? `flex items-center gap-2 px-4 py-2.5 rounded-full transition-all duration-200 ${
        focused ? 'neu-raised-focused' : 'neu-raised'
      }`
    : `flex items-center gap-2 px-4 py-2.5 rounded-full transition-all duration-200 ${
        focused ? 'bg-white/25 ring-2 ring-white/40 shadow-lg' : 'bg-white/15 hover:bg-white/20'
      }`;

  const formStyle = isNeu
    ? {}
    : { backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' };

  const iconCls = isNeu ? 'text-slate-400 shrink-0' : 'text-white/70 shrink-0';
  const inputCls = isNeu
    ? 'flex-1 min-w-0 bg-transparent text-slate-700 text-sm placeholder:text-slate-400 outline-none'
    : 'flex-1 min-w-0 bg-transparent text-white text-sm placeholder:text-white/50 outline-none';
  const btnCls = isNeu
    ? 'text-slate-400 hover:text-slate-600 transition-colors'
    : 'text-white/60 hover:text-white transition-colors';

  return (
    <div className="px-4 md:px-8 pb-3">
      <form onSubmit={handleSubmit} className={formCls} style={formStyle}>
        <Search className={`w-4 h-4 ${iconCls}`} />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
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
    </div>
  );
};

export default SearchBar;
