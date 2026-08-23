/**
 * SearchEnginePanel
 * 搜索引擎选择面板 + 添加自定义引擎对话框
 * 图标使用用户提供的内联 SVG data URL，无需网络请求
 */

import { Pencil, Plus, Trash2, X } from 'lucide-react';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { useDesktop } from '@/contexts/DesktopContext';
import { useLongPressIntent } from '@/hooks/use-long-press-intent';
import { useViewportGeometry } from '@/hooks/use-viewport-geometry';
import {
  type AnyEngine,
  getAvailableSearchEngines,
  getEngineIconSrc,
  isBuiltinSearchEngine,
} from '@/lib/searchEngines';
import { clampFloatingPosition } from '@/lib/viewport';
import type { CustomSearchEngine } from '@/types';

interface SearchEnginePanelProps {
  anchorRect: DOMRect | null;
  onClose: () => void;
}

// ── 引擎图标：内置用内联 SVG，自定义引擎用多源候选链 ───────────────────────
const EngineIcon: React.FC<{ engine: AnyEngine; size?: number }> = ({ engine, size = 48 }) => {
  const letter = engine.name.slice(0, 1).toUpperCase();
  const iconSize = Math.round(size * 0.72);

  // 内置引擎：使用本地内联 SVG，单一来源不需要多源轮询
  if ('iconSrc' in engine && engine.iconSrc) {
    return (
      <div className="flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
        <img
          src={engine.iconSrc}
          alt={engine.name}
          width={iconSize}
          height={iconSize}
          draggable={false}
          className="object-contain"
        />
      </div>
    );
  }

  // 自定义引擎：iconUrl 可能是 DataURL 或外部 URL，用多源候选兜底
  const domain = (() => {
    try {
      const u = engine.urlTemplate.replace('{q}', 'test').replace(/%s/g, 'test');
      return new URL(u).hostname;
    } catch { return ''; }
  })();
  const iconUrl = 'iconUrl' in engine ? engine.iconUrl : undefined;
  const candidates = iconUrl
    ? [iconUrl, ...getFaviconCandidates(domain)]
    : getFaviconCandidates(domain);

  return (
    <div className="flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
      <MultiSourceImg
        candidates={candidates}
        alt={engine.name}
        size={iconSize}
        fallbackColor={engine.color}
        fallbackLetter={letter}
      />
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
  name: string; urlTemplate: string; iconCandidates: string[]; color: string;
} | null {
  try {
    let urlStr = input.trim();
    if (!urlStr) return null;
    if (!/^https?:\/\//i.test(urlStr)) urlStr = 'https://' + urlStr;

    // 支持 %s 占位符（Firefox/Chrome 自定义搜索引擎格式），统一转为内部 {q}
    if (urlStr.includes('%s')) {
      const urlTemplate = urlStr.replace(/%s/g, '{q}');
      const domain = new URL(urlStr.replace(/%s/g, 'placeholder')).hostname;
      const siteName = domain.replace(/^(www\.|m\.|s\.)/i, '').split('.')[0];
      const name = siteName.charAt(0).toUpperCase() + siteName.slice(1);
      const color = PRESET_COLORS[Math.abs(name.charCodeAt(0) % PRESET_COLORS.length)];
      return { name, urlTemplate, iconCandidates: getFaviconCandidates(domain), color };
    }

    const url = new URL(urlStr);
    const domain = url.hostname;
    const siteName = domain.replace(/^(www\.|m\.|s\.)/i, '').split('.')[0];
    const name = siteName.charAt(0).toUpperCase() + siteName.slice(1);
    const color = PRESET_COLORS[Math.abs(name.charCodeAt(0) % PRESET_COLORS.length)];
    const iconCandidates = getFaviconCandidates(domain);

    // 1. URL 末尾是 "param=" 形式
    if (/[?&][a-z_]+=$/.test(urlStr)) {
      return { name, urlTemplate: urlStr + '{q}', iconCandidates, color };
    }

    // 2. URL 中已含已知搜索参数且有值 → 字符串级替换
    for (const p of SEARCH_PARAMS) {
      const re = new RegExp(`([?&]${p}=)[^&]*`);
      if (re.test(urlStr)) {
        return { name, urlTemplate: urlStr.replace(re, `$1{q}`), iconCandidates, color };
      }
    }

    // 3. 未检测到搜索参数 → 追加 ?q={q}
    const base = url.origin + url.pathname.replace(/\/$/, '');
    return { name, urlTemplate: `${base}?q={q}`, iconCandidates, color };
  } catch {
    return null;
  }
}

// ── 多源 favicon 候选 URL ────────────────────────────────────────────────
function getFaviconCandidates(domain: string): string[] {
  return [
    `https://favicon.im/${domain}`,
    `https://icon.horse/icon/${domain}`,
    `https://www.google.com/s2/favicons?domain=${domain}&sz=64`,
    `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${domain}&size=64`,
    `https://${domain}/favicon.ico`,
  ];
}

// ── 多源图标组件：按序尝试候选 URL，全部失败则显示字母兜底 ────────────
const MultiSourceImg: React.FC<{
  candidates: string[];
  alt: string;
  size: number;
  fallbackColor: string;
  fallbackLetter: string;
  className?: string;
}> = ({ candidates, alt, size, fallbackColor, fallbackLetter, className }) => {
  const [idx, setIdx] = useState(0);
  const candidateKey = candidates.join('\n');
  useEffect(() => setIdx(0), [candidateKey]);
  const src = candidates[idx] ?? null;
  if (src) {
    return (
      <img
        key={src}
        src={src}
        alt={alt}
        width={size}
        height={size}
        draggable={false}
        referrerPolicy="no-referrer"
        className={`object-contain ${className ?? ''}`}
        onError={() => setIdx((i) => i + 1)}
      />
    );
  }
  // 全部失败 → 字母兜底
  return (
    <div
      className="flex items-center justify-center rounded-2xl shrink-0"
      style={{ width: size, height: size, background: fallbackColor }}
    >
      <span className="text-white font-bold" style={{ fontSize: size * 0.42 }}>
        {fallbackLetter}
      </span>
    </div>
  );
};

// 用 <img> 探测找到第一个可加载的候选 URL（不使用 fetch，彻底避免 CORS 问题）
function pickFirstLoadableIcon(candidates: string[]): Promise<string | null> {
  const tryNext = (i: number): Promise<string | null> => {
    if (i >= candidates.length) return Promise.resolve(null);
    const url = candidates[i];
    if (url.startsWith('data:')) return Promise.resolve(url);
    return new Promise<string | null>((resolve) => {
      const img = new Image();
      img.referrerPolicy = 'no-referrer';
      const timer = setTimeout(() => {
        img.onload = img.onerror = null;
        resolve(tryNext(i + 1));
      }, 4000);
      img.onload = () => { clearTimeout(timer); resolve(url); };
      img.onerror = () => { clearTimeout(timer); resolve(tryNext(i + 1)); };
      img.src = url;
    });
  };
  return tryNext(0);
}

interface EngineEditorFormProps {
  initialEngine?: AnyEngine;
  onSave: (engine: CustomSearchEngine) => void;
  onCancel: () => void;
}

const EngineEditorForm: React.FC<EngineEditorFormProps> = ({
  initialEngine,
  onSave,
  onCancel,
}) => {
  const [rawUrl, setRawUrl] = useState(initialEngine?.urlTemplate ?? '');
  const [customName, setCustomName] = useState(initialEngine?.name ?? '');
  const [selectedIconUrl, setSelectedIconUrl] = useState<string | null>(
    initialEngine ? getEngineIconSrc(initialEngine) : null,
  );
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parsed = parseEngineUrl(rawUrl);
  const displayName = customName.trim() || parsed?.name || '';
  const canSubmit = !!parsed && displayName.length > 0;

  // 预览用图标候选：本地选择 > 自动识别多源候选链
  const previewCandidates: string[] = selectedIconUrl
    ? [selectedIconUrl]
    : (parsed?.iconCandidates ?? []);

  // 解析结果变化时自动填充名称
  useEffect(() => {
    if (!initialEngine && parsed?.name && !customName) setCustomName(parsed.name);
  }, [customName, initialEngine, parsed?.name]);

  // 选择本地图片文件
  const handleLocalIconChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result;
      if (typeof result === 'string') setSelectedIconUrl(result);
    };
    reader.readAsDataURL(file);
  };

  // 提交：本地图标直接持久化；没有显式图标时从候选链选择可加载来源。
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !parsed || submitting) return;
    setSubmitting(true);
    let persistedIconUrl = selectedIconUrl ?? undefined;
    if (!persistedIconUrl && parsed.iconCandidates.length > 0) {
      persistedIconUrl =
        (await pickFirstLoadableIcon(parsed.iconCandidates)) ?? parsed.iconCandidates[0];
    }
    onSave({
      id: initialEngine?.id ?? `custom-${Date.now()}`,
      name: displayName,
      urlTemplate: parsed.urlTemplate,
      iconUrl: persistedIconUrl,
      color: initialEngine?.color ?? parsed.color,
    });
    setSubmitting(false);
  };

  const handleUrlChange = (value: string) => {
    setRawUrl(value);
    if (!initialEngine) {
      setCustomName('');
      setSelectedIconUrl(null);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-4 space-y-3">
      <p className="text-white text-sm font-semibold">
        {initialEngine ? '编辑搜索引擎' : '添加搜索引擎'}
      </p>

      {/* URL 输入 */}
      <input
        type="text"
        value={rawUrl}
        onChange={(e) => handleUrlChange(e.target.value)}
        placeholder="输入搜索引擎网址，如 https://bing.com"
        className="w-full rounded-xl bg-white/10 text-white placeholder:text-white/40 text-sm px-3 py-2 outline-none focus:ring-1 focus:ring-white/40"
        style={{ fontSize: 16 }}
        autoComplete="off"
        autoCapitalize="none"
      />

      {/* 自动识别预览 */}
      {parsed && (
        <div className="flex items-center gap-3 rounded-xl bg-white/8 px-3 py-2">
          {/* 图标区：点击可替换为本地图片 */}
          <button
            type="button"
            title="点击选择本地图标"
            onClick={() => fileInputRef.current?.click()}
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 relative group overflow-hidden hover:ring-2 hover:ring-white/40 transition-all"
            style={{ background: 'rgba(255,255,255,0.12)' }}
          >
            {previewCandidates.length > 0 ? (
              <MultiSourceImg
                candidates={previewCandidates}
                alt={displayName}
                size={28}
                fallbackColor={initialEngine?.color ?? parsed.color}
                fallbackLetter={displayName.slice(0, 1) || '?'}
              />
            ) : (
              <span className="text-white font-bold text-sm">{displayName.slice(0, 1) || '?'}</span>
            )}
            <span className="absolute inset-0 bg-black/40 rounded-xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <span className="text-white text-[9px] leading-tight text-center px-0.5">本地<br/>图标</span>
            </span>
          </button>

          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleLocalIconChange} />

          <input
            type="text"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder="引擎名称"
            className="flex-1 bg-transparent text-white text-sm outline-none placeholder:text-white/40 border-b border-white/20 pb-0.5"
            style={{ fontSize: 15 }}
          />

          {selectedIconUrl && (
            <button type="button" title="重新自动识别图标" onClick={() => setSelectedIconUrl(null)}
              className="shrink-0 text-white/40 hover:text-white/80 transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {rawUrl.trim().length > 0 && !parsed && (
        <p className="text-yellow-400 text-xs">请输入有效的网址</p>
      )}

      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancel}
          className="flex-1 rounded-xl py-2 text-sm text-white/60 bg-white/10 hover:bg-white/15 transition-colors">
          取消
        </button>
        <button type="submit" disabled={!canSubmit || submitting}
          className="flex-1 rounded-xl py-2 text-sm text-white font-medium bg-primary/70 hover:bg-primary/90 transition-colors disabled:opacity-40">
          {submitting ? '保存中…' : '保存'}
        </button>
      </div>
    </form>
  );
};

interface EngineTileProps {
  engine: AnyEngine;
  active: boolean;
  onSelect: () => void;
  onOpenMenu: (x: number, y: number) => void;
}

const EngineTile: React.FC<EngineTileProps> = ({ engine, active, onSelect, onOpenMenu }) => {
  const tileRef = useRef<HTMLButtonElement>(null);
  const pressIntent = useLongPressIntent<HTMLButtonElement>({
    onLongPress: onOpenMenu,
  });

  // Android Chromium/WebView 可能在 React 的合成 contextmenu 回调执行前，
  // 已经依据 img 命中结果弹出原生长按菜单。直接在目标元素捕获阶段拦截
  // contextmenu/selectstart/dragstart，确保自定义 500ms 菜单不会被系统菜单覆盖。
  useLayoutEffect(() => {
    const tile = tileRef.current;
    if (!tile) return;
    const preventNativeLongPress = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    tile.addEventListener('contextmenu', preventNativeLongPress, true);
    tile.addEventListener('selectstart', preventNativeLongPress, true);
    tile.addEventListener('dragstart', preventNativeLongPress, true);
    return () => {
      tile.removeEventListener('contextmenu', preventNativeLongPress, true);
      tile.removeEventListener('selectstart', preventNativeLongPress, true);
      tile.removeEventListener('dragstart', preventNativeLongPress, true);
    };
  }, []);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (pressIntent.consumeClick()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onSelect();
  };

  return (
    <button
      ref={tileRef}
      type="button"
      draggable={false}
      onClick={handleClick}
      onPointerDown={pressIntent.onPointerDown}
      onPointerMove={pressIntent.onPointerMove}
      onPointerUp={pressIntent.onPointerUp}
      onPointerCancel={pressIntent.onPointerCancel}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onDragStart={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        onOpenMenu(rect.left + rect.width / 2, rect.top + rect.height / 2);
      }}
      className="search-engine-tile relative flex flex-col items-center gap-1 group py-0.5 touch-none select-none"
      aria-label={`${engine.name}，长按可编辑或删除`}
    >
      <div className={`rounded-xl transition-all ${active ? 'ring-2 ring-white/80 ring-offset-1 ring-offset-transparent' : ''}`}>
        <EngineIcon engine={engine} size={36} />
      </div>
      <span className="text-white/75 text-[10px] text-center leading-tight w-full truncate px-0.5">
        {engine.name}
      </span>
    </button>
  );
};

// ── 主面板 ───────────────────────────────────────────────────────────────────
const SearchEnginePanel: React.FC<SearchEnginePanelProps> = ({ anchorRect, onClose }) => {
  const { settings, updateSettings } = useDesktop();
  const [showAdd, setShowAdd] = useState(false);
  const [editingEngine, setEditingEngine] = useState<AnyEngine | null>(null);
  const [engineMenu, setEngineMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const engineMenuRef = useRef<HTMLDivElement>(null);
  const viewport = useViewportGeometry();

  // 面板弹出方向：'down'（默认向下）| 'up'（空间不足时向上）
  const [openDir, setOpenDir] = useState<'down' | 'up'>('down');

  const currentId = settings.searchEngine ?? 'bing';
  const customEngines = settings.customEngines ?? [];
  const deletedEngineIds = settings.deletedSearchEngineIds ?? [];
  const allEngines = getAvailableSearchEngines(customEngines, deletedEngineIds);
  const activeId = allEngines.some((engine) => engine.id === currentId)
    ? currentId
    : allEngines[0]?.id;

  // 水平定位：居中对齐 anchor，边界保护
  const PANEL_W = Math.max(0, Math.min(340, viewport.visual.width - 24));
  const horizontalStyle = React.useMemo<React.CSSProperties>(() => {
    if (!anchorRect) return { display: 'none' };
    const desiredLeft = anchorRect.left + anchorRect.width / 2 - PANEL_W / 2;
    const left = clampFloatingPosition(
      desiredLeft,
      PANEL_W,
      viewport.visual.left,
      viewport.visual.width,
      12,
    );
    return { position: 'fixed', left, width: PANEL_W };
  }, [anchorRect, PANEL_W, viewport.visual.left, viewport.visual.width]);

  // 首次渲染后测量真实高度，决定向上/向下展开
  useLayoutEffect(() => {
    if (!panelRef.current || !anchorRect) return;
    const MARGIN = 10; // 面板与搜索框间距
    const panelH = panelRef.current.scrollHeight;
    const spaceBelow = viewport.visual.bottom - anchorRect.bottom - MARGIN;
    const spaceAbove = anchorRect.top - viewport.visual.top - MARGIN;
    // 下方放不下 且 上方空间更充裕 → 向上展开
    setOpenDir(spaceBelow < panelH && spaceAbove > spaceBelow ? 'up' : 'down');
  }, [anchorRect, editingEngine, showAdd, viewport.visual.bottom, viewport.visual.top]);

  // 根据方向计算最终定位
  const positionStyle = React.useMemo<React.CSSProperties>(() => {
    if (!anchorRect) return {};
    const MARGIN = 10;
    const MAX_H = viewport.visual.height * 0.65;
    if (openDir === 'up') {
      // 底边贴紧搜索框顶部
      return {
        bottom: viewport.layout.height - anchorRect.top + MARGIN,
        maxHeight: Math.min(MAX_H, Math.max(80, anchorRect.top - viewport.visual.top - MARGIN)),
      };
    }
    // 顶边贴紧搜索框底部
    return {
      top: anchorRect.bottom + MARGIN,
      maxHeight: Math.min(MAX_H, Math.max(80, viewport.visual.bottom - anchorRect.bottom - MARGIN)),
    };
  }, [anchorRect, openDir, viewport.layout.height, viewport.visual.bottom, viewport.visual.height, viewport.visual.top]);

  // 动画类：向上/向下展开使用不同方向动画
  const animClass = openDir === 'up' ? 'animate-drop-up' : 'animate-drop-down';

  // 点击面板外部关闭
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || engineMenuRef.current?.contains(target)) return;
      onClose();
    };
    const keyHandler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (engineMenu) setEngineMenu(null);
      else onClose();
    };
    document.addEventListener('pointerdown', handler, true);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('pointerdown', handler, true);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [engineMenu, onClose]);

  const selectEngine = useCallback((id: string) => {
    updateSettings({ searchEngine: id });
    onClose();
  }, [updateSettings, onClose]);

  const saveEngine = useCallback((engine: CustomSearchEngine) => {
    const list = [
      ...customEngines.filter((candidate) => candidate.id !== engine.id),
      engine,
    ];
    updateSettings({
      customEngines: list,
      deletedSearchEngineIds: deletedEngineIds.filter((id) => id !== engine.id),
      searchEngine: editingEngine ? currentId : engine.id,
    });
    setShowAdd(false);
    setEditingEngine(null);
    onClose();
    toast.success(editingEngine ? '搜索引擎已更新' : '搜索引擎已添加');
  }, [customEngines, currentId, deletedEngineIds, editingEngine, onClose, updateSettings]);

  const removeEngine = useCallback((id: string) => {
    if (allEngines.length <= 1) {
      toast.error('至少需要保留一个搜索引擎');
      setEngineMenu(null);
      return;
    }
    const list = customEngines.filter((candidate) => candidate.id !== id);
    const nextDeleted = isBuiltinSearchEngine(id)
      ? [...new Set([...deletedEngineIds, id])]
      : deletedEngineIds.filter((deletedId) => deletedId !== id);
    const remaining = getAvailableSearchEngines(list, nextDeleted);
    updateSettings({
      customEngines: list,
      deletedSearchEngineIds: nextDeleted,
      searchEngine: currentId === id ? remaining[0].id : currentId,
    });
    setEngineMenu(null);
    toast.success('搜索引擎已删除');
  }, [allEngines.length, customEngines, currentId, deletedEngineIds, updateSettings]);

  const openEngineEditor = useCallback((id: string) => {
    const engine = allEngines.find((candidate) => candidate.id === id);
    if (!engine) return;
    setEngineMenu(null);
    setShowAdd(false);
    setEditingEngine(engine);
  }, [allEngines]);

  // 必须 Portal 到 body：桌面翻页滑轨使用 transform，普通后代的 fixed 定位会被
  // 滑轨接管并受桌面 overflow 裁剪，导致面板实际已打开却落在可视区之外。
  // React Portal 事件仍按组件树冒泡，因此同时阻止指针事件回到 WidgetGridCell，
  // 避免在面板内操作时触发长按菜单或组件拖拽。
  return createPortal(
    /* 透明全屏遮罩，捕获点击关闭 */
    <div
      className="fixed z-[200]"
      style={{
        left: viewport.visual.left,
        top: viewport.visual.top,
        width: viewport.visual.width,
        height: viewport.visual.height,
      }}
      onClick={onClose}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onPointerCancel={(event) => event.stopPropagation()}
    >
      {/* 面板本体：测量高度后动态决定向上/向下展开 */}
      <div
        ref={panelRef}
        className={`rounded-2xl overflow-hidden ${animClass}`}
        style={{
          ...horizontalStyle,
          ...positionStyle,
          overflowY: 'auto',
          background: 'rgba(28,28,32,0.94)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          border: '1px solid rgba(255,255,255,0.13)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {showAdd || editingEngine ? (
          <EngineEditorForm
            key={editingEngine?.id ?? 'new-engine'}
            initialEngine={editingEngine ?? undefined}
            onSave={saveEngine}
            onCancel={() => {
              setShowAdd(false);
              setEditingEngine(null);
            }}
          />
        ) : (
          <div className="p-2.5">
            {/* 标题行 */}
            <div className="flex items-center justify-between px-1 pb-1.5">
              <span className="text-white/60 text-xs font-medium">选择搜索引擎</span>
              <button
                type="button"
                onClick={onClose}
                className="text-white/40 hover:text-white/70 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 引擎网格：6列紧凑排列 */}
            <div className="grid grid-cols-6 gap-y-2 gap-x-0.5">
              {allEngines.map((eng) => {
                return (
                  <EngineTile
                    key={eng.id}
                    engine={eng}
                    active={eng.id === activeId}
                    onSelect={() => selectEngine(eng.id)}
                    onOpenMenu={(x, y) => setEngineMenu({ id: eng.id, x, y })}
                  />
                );
              })}

              {/* 添加按钮 */}
              <button
                type="button"
                onClick={() => {
                  setEngineMenu(null);
                  setEditingEngine(null);
                  setShowAdd(true);
                }}
                className="flex flex-col items-center gap-1 py-0.5"
              >
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: 'rgba(255,255,255,0.12)' }}
                >
                  <Plus className="w-5 h-5 text-white/70" />
                </div>
                <span className="text-white/60 text-[10px]">添加</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {engineMenu && (() => {
        const menuWidth = 152;
        const menuHeight = 94;
        const left = clampFloatingPosition(
          engineMenu.x,
          menuWidth,
          viewport.visual.left,
          viewport.visual.width,
        );
        const top = clampFloatingPosition(
          engineMenu.y,
          menuHeight,
          viewport.visual.top,
          viewport.visual.height,
        );
        return (
          <div
            ref={engineMenuRef}
            role="menu"
            aria-label="搜索引擎操作"
            className="fixed z-[210] w-[152px] rounded-2xl overflow-hidden shadow-2xl animate-scale-in p-1.5"
            style={{
              left,
              top,
              background: 'rgba(30,30,40,0.94)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
              border: '1px solid rgba(255,255,255,0.15)',
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => openEngineEditor(engineMenu.id)}
              className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg text-sm text-white/90 hover:bg-white/15 transition-colors"
            >
              <Pencil className="w-4 h-4 text-primary shrink-0" />
              编辑
            </button>
            <div className="h-px bg-white/10 my-0.5" />
            <button
              type="button"
              role="menuitem"
              onClick={() => removeEngine(engineMenu.id)}
              className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg text-sm text-red-400 hover:bg-white/15 transition-colors"
            >
              <Trash2 className="w-4 h-4 shrink-0" />
              删除
            </button>
          </div>
        );
      })()}
    </div>,
    document.body,
  );
};

export default SearchEnginePanel;
