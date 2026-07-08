/**
 * SearchEnginePanel
 * 搜索引擎选择面板 + 添加自定义引擎对话框
 * 图标使用用户提供的内联 SVG data URL，无需网络请求
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Plus, X } from 'lucide-react';
import { useDesktop } from '@/contexts/DesktopContext';
import {
  BUILTIN_ENGINES,
  getEngineById,
  getEngineIconSrc,
  type AnyEngine,
} from '@/lib/searchEngines';
import type { CustomSearchEngine } from '@/types';

interface SearchEnginePanelProps {
  anchorRect: DOMRect | null;
  onClose: () => void;
}

// ── 引擎图标：内联 SVG data URL，带彩色字母兜底 ────────────────────────────
const EngineIcon: React.FC<{ engine: AnyEngine; size?: number }> = ({ engine, size = 48 }) => {
  const [err, setErr] = useState(false);
  const src = getEngineIconSrc(engine);
  const letter = engine.name.slice(0, 1).toUpperCase();

  if (src && !err) {
    return (
      <div className="flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
        <img
          src={src}
          alt={engine.name}
          width={size * 0.72}
          height={size * 0.72}
          className="object-contain"
          onError={() => setErr(true)}
        />
      </div>
    );
  }

  return (
    <div
      className="flex items-center justify-center rounded-2xl shrink-0"
      style={{ width: size, height: size, background: engine.color }}
    >
      <span className="text-white font-bold" style={{ fontSize: size * 0.42 }}>{letter}</span>
    </div>
  );
};

// ── 添加自定义引擎表单 ────────────────────────────────────────────────────────
// ── 预设品牌色 ────────────────────────────────────────────────────────────────
const PRESET_COLORS = [
  '#E53935', '#D81B60', '#8E24AA', '#5E35B1',
  '#1E88E5', '#039BE5', '#00897B', '#43A047',
  '#FB8C00', '#F4511E', '#6D4C41', '#546E7A',
];

// ── 从 URL 自动解析搜索引擎信息 ────────────────────────────────────────────
const SEARCH_PARAMS = ['q', 'query', 'wd', 'keyword', 'kw', 's', 'text', 'search', 'p', 'w'];

function parseEngineUrl(input: string): {
  name: string; urlTemplate: string; iconUrl: string; color: string;
} | null {
  try {
    let urlStr = input.trim();
    if (!urlStr) return null;
    if (!/^https?:\/\//i.test(urlStr)) urlStr = 'https://' + urlStr;

    const url = new URL(urlStr);
    const domain = url.hostname;
    const siteName = domain.replace(/^(www\.|m\.|s\.)/i, '').split('.')[0];
    const name = siteName.charAt(0).toUpperCase() + siteName.slice(1);
    const iconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
    const color = PRESET_COLORS[Math.abs(name.charCodeAt(0) % PRESET_COLORS.length)];

    // 1. URL 末尾是 "param=" 形式（用户粘贴的搜索链接，如 ?q= 或 ?wd=）
    //    直接在末尾追加 {q}，不做任何编码
    if (/[?&][a-z_]+=$/.test(urlStr)) {
      return { name, urlTemplate: urlStr + '{q}', iconUrl, color };
    }

    // 2. URL 中已含已知搜索参数且有值 → 字符串级替换（避免 URL API 编码 {q}）
    for (const p of SEARCH_PARAMS) {
      // 匹配 ?p=value 或 &p=value，value 到 & 或末尾
      const re = new RegExp(`([?&]${p}=)[^&]*`);
      if (re.test(urlStr)) {
        return { name, urlTemplate: urlStr.replace(re, `$1{q}`), iconUrl, color };
      }
    }

    // 3. 未检测到搜索参数 → 追加 ?q={q}
    const base = url.origin + url.pathname.replace(/\/$/, '');
    return { name, urlTemplate: `${base}?q={q}`, iconUrl, color };
  } catch {
    return null;
  }
}

// ── 添加自定义引擎表单（简化版：只需输入 URL）────────────────────────────────
const AddEngineForm: React.FC<{ onAdd: (e: CustomSearchEngine) => void; onCancel: () => void }> = ({
  onAdd, onCancel,
}) => {
  const [rawUrl, setRawUrl] = useState('');
  const [customName, setCustomName] = useState('');
  const [iconErr, setIconErr] = useState(false);

  const parsed = parseEngineUrl(rawUrl);
  const displayName = customName.trim() || parsed?.name || '';
  const canSubmit = !!parsed && displayName.length > 0;

  // 解析结果变化时自动填充名称输入框
  useEffect(() => {
    if (parsed?.name && !customName) setCustomName(parsed.name);
  }, [parsed?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !parsed) return;
    onAdd({
      id: `custom-${Date.now()}`,
      name: displayName,
      urlTemplate: parsed.urlTemplate,
      iconUrl: parsed.iconUrl,
      color: parsed.color,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="p-4 space-y-3">
      <p className="text-white text-sm font-semibold">添加搜索引擎</p>

      {/* URL 输入 */}
      <input
        type="text"
        value={rawUrl}
        onChange={(e) => { setRawUrl(e.target.value); setCustomName(''); setIconErr(false); }}
        placeholder="输入搜索引擎网址，如 https://bing.com"
        className="w-full rounded-xl bg-white/10 text-white placeholder:text-white/40 text-sm px-3 py-2 outline-none focus:ring-1 focus:ring-white/40"
        style={{ fontSize: 16 }}
        autoComplete="off"
        autoCapitalize="none"
      />

      {/* 自动识别预览 */}
      {parsed && (
        <div className="flex items-center gap-3 rounded-xl bg-white/8 px-3 py-2">
          {/* 图标预览 */}
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          >
            {!iconErr ? (
              <img
                src={parsed.iconUrl}
                alt=""
                width={28} height={28}
                className="object-contain rounded"
                onError={() => setIconErr(true)}
              />
            ) : (
              <span className="text-white font-bold text-sm">{displayName.slice(0, 1)}</span>
            )}
          </div>
          {/* 可编辑名称 */}
          <input
            type="text"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder="引擎名称"
            className="flex-1 bg-transparent text-white text-sm outline-none placeholder:text-white/40 border-b border-white/20 pb-0.5"
            style={{ fontSize: 15 }}
          />
        </div>
      )}

      {/* URL 格式提示 */}
      {rawUrl.trim().length > 0 && !parsed && (
        <p className="text-yellow-400 text-xs">请输入有效的网址</p>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-xl py-2 text-sm text-white/60 bg-white/10 hover:bg-white/15 transition-colors"
        >
          取消
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          className="flex-1 rounded-xl py-2 text-sm text-white font-medium bg-primary/70 hover:bg-primary/90 transition-colors disabled:opacity-40"
        >
          添加
        </button>
      </div>
    </form>
  );
};

// ── 主面板 ───────────────────────────────────────────────────────────────────
const SearchEnginePanel: React.FC<SearchEnginePanelProps> = ({ anchorRect, onClose }) => {
  const { settings, updateSettings } = useDesktop();
  const [showAdd, setShowAdd] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const currentId = settings.searchEngine ?? 'bing';
  const customEngines = settings.customEngines ?? [];

  // 计算面板位置：anchorRect 下方，左右居中（最宽 400px）
  const panelStyle: React.CSSProperties = (() => {
    if (!anchorRect) return { top: '50%', left: '50%', transform: 'translate(-50%,-50%)' };
    const panelW = Math.min(window.innerWidth - 32, 400);
    let left = anchorRect.left + anchorRect.width / 2 - panelW / 2;
    left = Math.max(16, Math.min(left, window.innerWidth - panelW - 16));
    const top = anchorRect.bottom + 8;
    return { position: 'fixed', top, left, width: panelW };
  })();

  // 点击面板外部关闭
  useEffect(() => {
    const handler = (e: Event) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler, true);
    document.addEventListener('touchstart', handler, true);
    return () => {
      document.removeEventListener('mousedown', handler, true);
      document.removeEventListener('touchstart', handler, true);
    };
  }, [onClose]);

  const selectEngine = useCallback((id: string) => {
    updateSettings({ searchEngine: id });
    onClose();
  }, [updateSettings, onClose]);

  const addEngine = useCallback((eng: CustomSearchEngine) => {
    const list = [...(settings.customEngines ?? []), eng];
    updateSettings({ customEngines: list, searchEngine: eng.id });
    setShowAdd(false);
    onClose();
  }, [settings.customEngines, updateSettings, onClose]);

  const removeEngine = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const list = (settings.customEngines ?? []).filter((c) => c.id !== id);
    updateSettings({
      customEngines: list,
      searchEngine: currentId === id ? 'bing' : currentId,
    });
  }, [settings.customEngines, currentId, updateSettings]);

  const allEngines: AnyEngine[] = [
    ...BUILTIN_ENGINES,
    ...customEngines.map((c) => ({ ...c, isCustom: true as const })),
  ];

  return (
    <div
      ref={panelRef}
      className="z-[200] rounded-3xl overflow-hidden shadow-2xl animate-fade-in"
      style={{
        ...panelStyle,
        background: 'rgba(28,28,32,0.88)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid rgba(255,255,255,0.12)',
      }}
    >
      {showAdd ? (
        <AddEngineForm onAdd={addEngine} onCancel={() => setShowAdd(false)} />
      ) : (
        <div className="p-3">
          {/* 标题行 */}
          <div className="flex items-center justify-between px-1 pb-2">
            <span className="text-white/60 text-xs font-medium">选择搜索引擎</span>
            <button
              type="button"
              onClick={onClose}
              className="text-white/40 hover:text-white/70 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* 引擎网格 */}
          <div className="grid grid-cols-4 gap-y-3 gap-x-1">
            {allEngines.map((eng) => {
              const active = eng.id === currentId;
              return (
                <button
                  key={eng.id}
                  type="button"
                  onClick={() => selectEngine(eng.id)}
                  className="relative flex flex-col items-center gap-1.5 group"
                >
                  {/* 当前选中高亮环 */}
                  <div className={`rounded-2xl transition-all ${active ? 'ring-2 ring-white/80 ring-offset-1 ring-offset-transparent' : ''}`}>
                    <EngineIcon engine={eng} size={52} />
                  </div>
                  <span className="text-white/80 text-[11px] text-center leading-tight max-w-[60px] truncate">
                    {eng.name}
                  </span>
                  {/* 自定义引擎删除按钮 */}
                  {'isCustom' in eng && eng.isCustom && (
                    <button
                      type="button"
                      onClick={(e) => removeEngine(eng.id, e)}
                      className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                    </button>
                  )}
                </button>
              );
            })}

            {/* 添加按钮 */}
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="flex flex-col items-center gap-1.5"
            >
              <div
                className="w-[52px] h-[52px] rounded-2xl flex items-center justify-center"
                style={{ background: 'rgba(255,255,255,0.12)' }}
              >
                <Plus className="w-6 h-6 text-white/70" />
              </div>
              <span className="text-white/60 text-[11px]">添加</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SearchEnginePanel;
