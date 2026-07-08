/**
 * SearchEnginePanel
 * 搜索引擎选择面板 + 添加自定义引擎对话框
 * 参考设计：搜索框左侧图标点击后弹出，深色毛玻璃卡片，4列网格
 * 图标使用 Iconify（纯图标无背景）
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Icon } from '@iconify/react';
import { Plus, X, Check } from 'lucide-react';
import { useDesktop } from '@/contexts/DesktopContext';
import {
  BUILTIN_ENGINES,
  getEngineById,
  type AnyEngine,
} from '@/lib/searchEngines';
import type { CustomSearchEngine } from '@/types';

interface SearchEnginePanelProps {
  anchorRect: DOMRect | null;
  onClose: () => void;
}

// ── 引擎图标：Iconify 纯图标，无背景；自定义引擎用彩色字母 ─────────────────
const EngineIcon: React.FC<{ engine: AnyEngine; size?: number }> = ({ engine, size = 48 }) => {
  const iconId = 'iconifyIcon' in engine ? engine.iconifyIcon : null;
  const letter = engine.name.slice(0, 1).toUpperCase();

  if (iconId) {
    return (
      <div
        className="flex items-center justify-center shrink-0"
        style={{ width: size, height: size }}
      >
        <Icon icon={iconId} width={size * 0.72} height={size * 0.72} />
      </div>
    );
  }

  // 自定义引擎：彩色字母图标
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
const PRESET_COLORS = [
  '#E53935', '#D81B60', '#8E24AA', '#5E35B1',
  '#1E88E5', '#039BE5', '#00897B', '#43A047',
  '#FB8C00', '#F4511E', '#6D4C41', '#546E7A',
];

const AddEngineForm: React.FC<{ onAdd: (e: CustomSearchEngine) => void; onCancel: () => void }> = ({
  onAdd, onCancel,
}) => {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [iconUrl, setIconUrl] = useState('');
  const [color, setColor] = useState(PRESET_COLORS[0]);

  const valid = name.trim().length > 0 && url.includes('{q}');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    onAdd({
      id: `custom-${Date.now()}`,
      name: name.trim(),
      urlTemplate: url.trim(),
      iconUrl: iconUrl.trim() || undefined,
      color,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="p-4 space-y-3">
      <p className="text-white text-sm font-semibold">添加搜索引擎</p>

      <div className="space-y-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="名称（如：必应）"
          className="w-full rounded-xl bg-white/10 text-white placeholder:text-white/40 text-sm px-3 py-2 outline-none focus:ring-1 focus:ring-white/40"
          style={{ fontSize: 16 }}
        />
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="搜索 URL，用 {q} 代替关键词"
          className="w-full rounded-xl bg-white/10 text-white placeholder:text-white/40 text-sm px-3 py-2 outline-none focus:ring-1 focus:ring-white/40"
          style={{ fontSize: 16 }}
        />
        <input
          type="text"
          value={iconUrl}
          onChange={(e) => setIconUrl(e.target.value)}
          placeholder="图标 URL（可选）"
          className="w-full rounded-xl bg-white/10 text-white placeholder:text-white/40 text-sm px-3 py-2 outline-none focus:ring-1 focus:ring-white/40"
          style={{ fontSize: 16 }}
        />
      </div>

      {/* 颜色选择 */}
      <div className="flex flex-wrap gap-2">
        {PRESET_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            className="w-7 h-7 rounded-full flex items-center justify-center transition-transform active:scale-90"
            style={{ background: c }}
          >
            {color === c && <Check className="w-4 h-4 text-white" strokeWidth={3} />}
          </button>
        ))}
      </div>

      {!valid && url.length > 0 && !url.includes('{q}') && (
        <p className="text-yellow-400 text-xs">URL 必须包含 {'{q}'} 占位符</p>
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
          disabled={!valid}
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
