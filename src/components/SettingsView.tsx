import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useDesktop } from '@/contexts/DesktopContext';
import type { DesktopStyle } from '@/types';
import {
  Image, Video, LayoutGrid, Palette, ChevronRight, ChevronLeft,
  RotateCcw, FilePlus, X, Check, Clock, Search, Layers, Link,
  RefreshCw, Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { defaultDesktopData, WIDGET_ITEMS } from '@/lib/storage';
import { getPanelTheme } from '@/lib/panelTheme';

type Panel = 'main' | 'bg' | 'view' | 'style' | 'widgets';
type BgCategory = 'bing' | 'nature' | 'city' | 'space' | 'minimal';

interface BingImage {
  url: string;
  copyright: string;
  title: string;
}

interface CuratedWallpaper {
  thumb: string;
  full: string;
  title: string;
}

// 分类 → Wallhaven 搜索关键词（专业壁纸站，原生CORS，无需Key）
const WALLHAVEN_QUERIES: Record<Exclude<BgCategory, 'bing'>, string> = {
  nature:  'nature landscape',
  city:    'city night',
  space:   'space galaxy',
  minimal: 'minimalist abstract',
};
const CATEGORY_LABELS: Record<Exclude<BgCategory, 'bing'>, string> = {
  nature:  '自然风景',
  city:    '城市建筑',
  space:   '宇宙星空',
  minimal: '极简抽象',
};

// picsum.photos 备用（seed随机，每次开面板不同）
function picsumFallback(cat: Exclude<BgCategory, 'bing'>, page: number, sessionSeed: number): CuratedWallpaper[] {
  return Array.from({ length: 9 }, (_, i) => {
    const seed = sessionSeed + page * 9 + i;
    return {
      thumb: `https://picsum.photos/seed/${seed}/480/270`,
      full:  `https://picsum.photos/seed/${seed}/1920/1080`,
      title: `${CATEGORY_LABELS[cat]} ${page * 9 + i + 1}`,
    };
  });
}

// Wallhaven API（原生CORS，SFW，高清壁纸）
async function fetchWallhavenImages(
  cat: Exclude<BgCategory, 'bing'>,
  page: number,
): Promise<CuratedWallpaper[]> {
  const q = encodeURIComponent(WALLHAVEN_QUERIES[cat]);
  const url = `https://wallhaven.cc/api/v1/search?q=${q}&categories=110&purity=100&atleast=1920x1080&sorting=random&page=${page + 1}&per_page=9`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const json = await res.json() as {
    data: Array<{
      thumbs: { large: string; small: string };
      path: string;
      id: string;
    }>;
  };
  if (!json.data?.length) throw new Error('no results');
  return json.data.map((d, i) => ({
    thumb: d.thumbs.large ?? d.thumbs.small,
    full:  d.path,
    title: `${CATEGORY_LABELS[cat]} ${page * 9 + i + 1}`,
  }));
}

interface SettingsViewProps {
  open: boolean;
  onClose: () => void;
}

const SettingsView: React.FC<SettingsViewProps> = ({ open, onClose }) => {
  const { data, addPage, setCurrentPage, importData, settings, updateSettings } = useDesktop();
  const [panel, setPanel] = useState<Panel>('main');
  const [urlInput, setUrlInput] = useState('');
  const [bgCat, setBgCat] = useState<BgCategory>('bing');
  const [catPage, setCatPage] = useState<Record<string, number>>({});
  const [catImages, setCatImages] = useState<Record<string, CuratedWallpaper[]>>({});
  const [catLoading, setCatLoading] = useState<string | null>(null);
  const [bingImages, setBingImages] = useState<BingImage[]>([]);
  const [bingLoading, setBingLoading] = useState(false);
  const [bingError, setBingError] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  // 每次打开面板时生成新随机基数，保证每次壁纸不同
  const sessionSeedRef = useRef(Math.floor(Math.random() * 10000));
  const isNeu = settings.style === 'neumorphism';
  const t = getPanelTheme(isNeu);

  const handleClose = () => { setPanel('main'); onClose(); };

  // ── 必应壁纸 fetch（多源回退）──
  const fetchBingWallpapers = useCallback(async () => {
    setBingLoading(true);
    setBingError(false);
    try {
      // 方案1: bing.biturl.top (有 CORS 头，直接请求)
      const results: BingImage[] = [];
      const fetches = Array.from({ length: 8 }, (_, i) =>
        fetch(`https://bing.biturl.top/?resolution=1920&format=json&index=${i}&mkt=zh-CN`, { signal: AbortSignal.timeout(8000) })
          .then((r) => r.json())
          .then((d: { url: string; copyright: string }) => {
            results[i] = {
              url: d.url,
              copyright: d.copyright,
              title: d.copyright.split('，')[0].split(', ')[0].replace(/\(.*\)/, '').trim(),
            };
          })
          .catch(() => null)
      );
      await Promise.allSettled(fetches);
      const valid = results.filter(Boolean);
      if (valid.length > 0) {
        setBingImages(valid);
        return;
      }
      // 方案2: allorigins 代理 Bing 官方 API
      const proxy = `https://api.allorigins.win/get?url=${encodeURIComponent(
        'https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8&mkt=zh-CN'
      )}`;
      const res = await fetch(proxy, { signal: AbortSignal.timeout(10000) });
      const json = await res.json();
      const parsed = JSON.parse(json.contents);
      const imgs: BingImage[] = (parsed.images as { url: string; copyright: string; title?: string }[]).map((img) => ({
        url: `https://www.bing.com${img.url}`,
        copyright: img.copyright,
        title: img.title ?? img.copyright.split('（')[0].split(' (')[0].trim(),
      }));
      setBingImages(imgs);
    } catch {
      setBingError(true);
    } finally {
      setBingLoading(false);
    }
  }, []);

  useEffect(() => {
    if (panel === 'bg' && bgCat === 'bing' && bingImages.length === 0 && !bingLoading) {
      fetchBingWallpapers();
    }
  }, [panel, bgCat, bingImages.length, bingLoading, fetchBingWallpapers]);

  // ── 精选分类壁纸 fetch（Wallhaven + picsum 备用）──
  const fetchCategoryImages = useCallback(async (cat: Exclude<BgCategory, 'bing'>, page: number) => {
    const key = `${cat}-${page}-${sessionSeedRef.current}`;
    if (catImages[key]) return; // 已缓存
    setCatLoading(cat);
    try {
      const items = await fetchWallhavenImages(cat, page);
      setCatImages((prev) => ({ ...prev, [key]: items }));
    } catch {
      // Wallhaven 失败 → picsum 备用（seed随机）
      const items = picsumFallback(cat, page, sessionSeedRef.current);
      setCatImages((prev) => ({ ...prev, [key]: items }));
    } finally {
      setCatLoading(null);
    }
  }, [catImages]);

  useEffect(() => {
    if (panel === 'bg' && bgCat !== 'bing') {
      const page = catPage[bgCat] ?? 0;
      fetchCategoryImages(bgCat as Exclude<BgCategory, 'bing'>, page);
    }
  }, [panel, bgCat, catPage, fetchCategoryImages]);

  const applyWallpaper = useCallback((url: string, label: string) => {
    updateSettings({ bgImage: url, bgVideo: undefined, bgType: 'image' });
    toast.success(`「${label}」已应用`);
  }, [updateSettings]);

  // ── 背景 ──
  const handleBgFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = ev.target?.result as string;
      updateSettings({ bgImage: base64, bgVideo: undefined, bgType: 'image' });
      toast.success('壁纸已更新');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }, [updateSettings]);

  const handleVideoFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    updateSettings({ bgVideo: url, bgImage: undefined, bgType: 'video' });
    toast.success('视频壁纸已应用（刷新后失效，建议使用图片）');
    e.target.value = '';
  }, [updateSettings]);

  const handleClearBg = useCallback(() => {
    updateSettings({ bgImage: undefined, bgVideo: undefined, bgType: 'default' });
    toast.success('已恢复默认背景');
  }, [updateSettings]);

  // ── 通过 URL 应用壁纸 ──
  const handleBgUrl = useCallback(() => {
    const url = urlInput.trim();
    if (!url) return;
    const isVideo = /\.(mp4|webm|ogg)(\?.*)?$/i.test(url);
    if (isVideo) {
      updateSettings({ bgVideo: url, bgImage: undefined, bgType: 'video' });
      toast.success('视频壁纸已应用');
    } else {
      updateSettings({ bgImage: url, bgVideo: undefined, bgType: 'image' });
      toast.success('图片壁纸已应用');
    }
    setUrlInput('');
  }, [urlInput, updateSettings]);

  // ── 数据 ──
  const handleAddPage = useCallback(() => {
    addPage();
    setCurrentPage(data.pages.length);
    toast.success('已添加新页面');
    handleClose();
  }, [addPage, setCurrentPage, data.pages.length]);

  const handleResetToDefault = useCallback(() => {
    if (!window.confirm('确认恢复默认桌面？系统应用和组件将恢复，用户自定义应用会被清除。')) return;
    importData(structuredClone(defaultDesktopData));
    toast.success('已恢复默认桌面');
    handleClose();
  }, [importData]);

  // ── 组件管理 ──
  const widgetExists = (id: string) => data.pages.flat().some((it) => it.id === id);

  const toggleWidget = useCallback((widgetId: 'widget-clock' | 'widget-search') => {
    const exists = widgetExists(widgetId);
    if (exists) {
      const newData = structuredClone(data);
      newData.pages = newData.pages.map((p) => p.filter((it) => it.id !== widgetId));
      importData(newData);
      toast.success('已移除组件');
    } else {
      const def = WIDGET_ITEMS.find((w) => w.id === widgetId);
      if (!def) return;
      const newData = structuredClone(data);
      const usedRows = new Set(newData.pages[0].map((it) => it.row));
      let targetRow = def.row;
      if (usedRows.has(targetRow)) {
        for (let r = 0; r < 8; r++) {
          if (!usedRows.has(r)) { targetRow = r; break; }
        }
      }
      newData.pages[0].push({ ...def, row: targetRow });
      importData(newData);
      toast.success('已添加组件');
    }
  }, [data, importData]);

  if (!open) return null;

  // ── 主面板 ──
  const renderMain = () => (
    <div className="px-5 py-4 space-y-2">
      <h2 className={`text-base font-semibold mb-3 ${t.textPrimary}`}>设置</h2>
      {[
        {
          id: 'bg' as Panel,
          icon: <Image className="w-5 h-5" />,
          label: '背景设置',
          desc: isNeu ? '新拟态风格下不可用' : '壁纸、视频、GIF',
          color: 'bg-blue-500',
          disabled: isNeu,
        },
        { id: 'view' as Panel, icon: <LayoutGrid className="w-5 h-5" />, label: '应用视图设置', desc: `图标 ${settings.iconSize}px · ${settings.cols} 列`, color: 'bg-indigo-500', disabled: false },
        { id: 'style' as Panel, icon: <Palette className="w-5 h-5" />, label: '风格设置', desc: isNeu ? '新拟态' : '毛玻璃', color: 'bg-purple-500', disabled: false },
        {
          id: 'widgets' as Panel,
          icon: <Layers className="w-5 h-5" />,
          label: '组件管理',
          desc: `时钟 ${widgetExists('widget-clock') ? '已启用' : '已隐藏'} · 搜索栏 ${widgetExists('widget-search') ? '已启用' : '已隐藏'}`,
          color: 'bg-teal-500',
          disabled: false,
        },
      ].map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => {
            if (!item.disabled) {
              if (item.id === 'bg') {
                // 每次进入壁纸面板：重置随机种子 + 清空缓存，保证图片不重复
                sessionSeedRef.current = Math.floor(Math.random() * 10000);
                setCatImages({});
                setCatPage({});
              }
              setPanel(item.id);
            }
          }}
          disabled={item.disabled}
          className={`flex items-center gap-3 w-full rounded-2xl px-4 py-3 transition-colors border ${
            item.disabled
              ? `${t.itemBg} ${t.itemBorder} opacity-40 cursor-not-allowed`
              : `${t.itemBg} ${t.itemBgHover} ${t.itemBorder}`
          }`}
        >
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0 ${item.color} ${item.disabled ? 'opacity-50' : ''}`}>
            {item.icon}
          </div>
          <div className="flex-1 min-w-0 text-left">
            <p className={`text-sm font-medium ${t.textPrimary}`}>{item.label}</p>
            <p className={`text-xs ${item.disabled ? 'text-red-400/70' : t.textDim}`}>{item.desc}</p>
          </div>
          {!item.disabled && <ChevronRight className={`w-4 h-4 shrink-0 ${t.textDim}`} />}
        </button>
      ))}

      <div className="pt-2 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={handleAddPage}
          className={`flex items-center justify-center gap-2 rounded-2xl px-4 py-3 ${t.itemBg} ${t.itemBgHover} ${t.textMuted} text-sm transition-colors border ${t.itemBorder}`}
        >
          <FilePlus className="w-4 h-4" /> 新增桌面页
        </button>
        <button
          type="button"
          onClick={handleResetToDefault}
          className={`flex items-center justify-center gap-2 rounded-2xl px-4 py-3 ${t.dangerBg} ${t.dangerText} text-sm transition-colors`}
        >
          <RotateCcw className="w-4 h-4" /> 恢复默认
        </button>
      </div>
    </div>
  );

  // ── 背景设置面板 ──
  const renderBg = () => {
    const categories: { id: BgCategory; label: string }[] = [
      { id: 'bing',    label: '必应每日' },
      { id: 'nature',  label: '自然风景' },
      { id: 'city',    label: '城市建筑' },
      { id: 'space',   label: '宇宙星空' },
      { id: 'minimal', label: '极简抽象' },
    ];

    // 通用壁纸网格组件
    const WallpaperGrid = ({ items, isActive }: {
      items: { thumb: string; full: string; title: string }[];
      isActive: (full: string) => boolean;
    }) => (
      <div className="grid grid-cols-3 gap-2">
        {items.map((item, i) => (
          <button
            key={i}
            type="button"
            onClick={() => applyWallpaper(item.full, item.title)}
            className={`relative aspect-video rounded-xl overflow-hidden border-2 transition-all active:scale-95 ${
              isActive(item.full)
                ? 'border-primary'
                : isNeu ? 'border-gray-200 hover:border-gray-400' : 'border-white/10 hover:border-white/30'
            }`}
          >
            <img
              src={item.thumb}
              alt={item.title}
              className="w-full h-full object-cover"
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={(e) => {
                const el = e.target as HTMLImageElement;
                el.style.opacity = '0';
                el.parentElement!.style.background = '#1e293b';
              }}
            />
            {isActive(item.full) && (
              <div className="absolute inset-0 bg-primary/25 flex items-center justify-center">
                <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center shadow-lg">
                  <Check className="w-3 h-3 text-white" strokeWidth={3} />
                </div>
              </div>
            )}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 py-1">
              <p className="text-white/95 text-[9px] leading-tight truncate">{item.title}</p>
            </div>
          </button>
        ))}
      </div>
    );

    // 必应每日内容
    const bingContent = bingLoading ? (
      <div className="flex flex-col items-center justify-center py-10 gap-2">
        <Loader2 className={`w-6 h-6 animate-spin ${t.textDim}`} />
        <span className={`text-xs ${t.textDim}`}>正在加载必应壁纸…</span>
      </div>
    ) : bingError ? (
      <div className="flex flex-col items-center justify-center py-10 gap-3">
        <span className={`text-sm ${t.textDim}`}>加载失败</span>
        <p className={`text-xs ${t.textDim} text-center px-4`}>请检查网络后重试，或切换其他分类</p>
        <button type="button" onClick={fetchBingWallpapers}
          className="px-4 py-1.5 rounded-full bg-primary/20 text-primary text-xs font-medium">
          重试
        </button>
      </div>
    ) : bingImages.length === 0 ? null : (
      <WallpaperGrid
        items={bingImages.map((img) => ({
          thumb: img.url.replace(/1920x1080/g, '640x360'),
          full: img.url,
          title: img.title,
        }))}
        isActive={(full) => settings.bgImage === full}
      />
    );

    return (
      <div className="flex flex-col h-full">
        {/* 固定头部 */}
        <div className="px-5 pt-3 pb-2 shrink-0 flex items-center justify-between">
          <button type="button" onClick={() => setPanel('main')}
            className={`flex items-center gap-1 text-sm ${t.backText}`}>
            <ChevronLeft className="w-4 h-4" /> 返回
          </button>
          <h3 className={`text-sm font-semibold ${t.textPrimary}`}>壁纸</h3>
          <div className="flex items-center gap-2">
            {bgCat === 'bing' ? (
              <button type="button" onClick={fetchBingWallpapers} disabled={bingLoading}
                className={`${t.textDim} disabled:opacity-40`}>
                <RefreshCw className={`w-4 h-4 ${bingLoading ? 'animate-spin' : ''}`} />
              </button>
            ) : (
              <button type="button" onClick={() => {
                const cat = bgCat as Exclude<BgCategory, 'bing'>;
                const next = (catPage[cat] ?? 0) + 1;
                setCatPage((prev) => ({ ...prev, [cat]: next }));
              }} disabled={catLoading === bgCat}
                className={`${t.textDim} disabled:opacity-40`}>
                <RefreshCw className={`w-4 h-4 ${catLoading === bgCat ? 'animate-spin' : ''}`} />
              </button>
            )}
            {(settings.bgImage || settings.bgVideo) && (
              <button type="button" onClick={handleClearBg}
                className="text-xs text-red-400/80 hover:text-red-400 transition-colors">
                重置
              </button>
            )}
          </div>
        </div>

        {/* 分类横向滚动 chips */}
        <div className="px-5 pb-2 shrink-0">
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {categories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  setBgCat(cat.id);
                  if (cat.id === 'bing' && bingImages.length === 0 && !bingLoading) fetchBingWallpapers();
                }}
                className={`flex items-center gap-1.5 shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  bgCat === cat.id
                    ? 'bg-primary text-white shadow-sm'
                    : isNeu
                      ? 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                      : 'bg-white/10 text-white/70 hover:bg-white/20'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* 可滚动壁纸区 */}
        <div className="flex-1 overflow-y-auto px-5 min-h-0 pb-2">
          {bgCat === 'bing' && bingContent}
          {bgCat !== 'bing' && (() => {
            const cat = bgCat as Exclude<BgCategory, 'bing'>;
            const page = catPage[cat] ?? 0;
            const key = `${cat}-${page}-${sessionSeedRef.current}`;
            const items = catImages[key];
            if (catLoading === cat) return (
              <div className="flex flex-col items-center justify-center py-10 gap-2">
                <Loader2 className={`w-6 h-6 animate-spin ${t.textDim}`} />
                <span className={`text-xs ${t.textDim}`}>正在从 Wallhaven 加载壁纸…</span>
              </div>
            );
            if (!items) return null;
            return (
              <WallpaperGrid
                items={items}
                isActive={(full) => settings.bgImage === full}
              />
            );
          })()}
        </div>

        {/* 底部本地/URL 操作栏 */}
        <div className={`shrink-0 px-5 py-3 border-t ${t.itemBorder}`}>
          <input ref={fileInputRef} type="file" accept="image/*,image/gif" className="hidden" onChange={handleBgFile} />
          <input ref={videoInputRef} type="file" accept="video/mp4,video/webm,video/ogg" className="hidden" onChange={handleVideoFile} />
          <div className="flex gap-2 mb-2">
            <button type="button" onClick={() => fileInputRef.current?.click()}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-medium border transition-colors ${t.itemBg} ${t.itemBgHover} ${t.itemBorder} ${t.textMuted}`}>
              <Image className="w-3.5 h-3.5" /> 本地图片
            </button>
            <button type="button" onClick={() => videoInputRef.current?.click()}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-medium border transition-colors ${t.itemBg} ${t.itemBgHover} ${t.itemBorder} ${t.textMuted}`}>
              <Video className="w-3.5 h-3.5" /> 本地视频
            </button>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleBgUrl()}
              placeholder="粘贴图片/视频 URL…"
              className={`flex-1 min-w-0 bg-transparent border rounded-xl px-3 py-2 text-xs outline-none ${t.itemBorder} ${t.textPrimary}`}
            />
            <button type="button" onClick={handleBgUrl} disabled={!urlInput.trim()}
              className="shrink-0 px-3 py-2 rounded-xl bg-primary/20 hover:bg-primary/30 text-primary text-xs font-medium transition-colors disabled:opacity-40 flex items-center gap-1">
              <Link className="w-3.5 h-3.5" /> 应用
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ── 应用视图设置面板 ──
  const renderView = () => (
    <div className="px-5 py-4 space-y-5">
      <button type="button" onClick={() => setPanel('main')} className={`flex items-center gap-1.5 text-sm ${t.backText}`}>
        <ChevronLeft className="w-4 h-4" /> 返回
      </button>
      <h3 className={`text-base font-semibold ${t.textPrimary}`}>应用视图设置</h3>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className={`text-sm ${t.textMuted}`}>图标大小</span>
          <span className="text-sm font-medium text-primary">{settings.iconSize} px</span>
        </div>
        <input
          type="range" min={36} max={64} step={2}
          value={settings.iconSize}
          onChange={(e) => updateSettings({ iconSize: Number(e.target.value) })}
          className="w-full accent-primary"
        />
        <div className={`flex justify-between text-xs ${t.textDim}`}>
          <span>小 (36)</span><span>默认 (46)</span><span>大 (64)</span>
        </div>
      </div>
      <div className="space-y-3">
        <span className={`text-sm ${t.textMuted}`}>每行列数</span>
        <div className="grid grid-cols-2 gap-3 mt-2">
          {([4, 5] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => updateSettings({ cols: c })}
              className={`flex flex-col items-center gap-2 rounded-2xl py-3 border transition-colors ${
                settings.cols === c
                  ? 'bg-primary/20 border-primary text-primary'
                  : `${t.itemBg} ${t.itemBorder} ${t.textMuted}`
              }`}
            >
              <div className={`grid gap-1 ${c === 4 ? 'grid-cols-4' : 'grid-cols-5'}`}>
                {Array.from({ length: c }).map((_, i) => (
                  <div key={i} className={`w-4 h-4 rounded-md ${settings.cols === c ? 'bg-primary/60' : isNeu ? 'bg-gray-300' : 'bg-white/20'}`} />
                ))}
              </div>
              <span className="text-sm font-medium">{c} 列</span>
              {c === 4 && <span className="text-xs opacity-50">默认</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className={`text-sm ${t.textMuted}`}>每页行数</span>
          <span className="text-sm font-medium text-primary">{settings.rows ?? 7} 行</span>
        </div>
        <input
          type="range" min={1} max={14} step={1}
          value={settings.rows ?? 7}
          onChange={(e) => updateSettings({ rows: Number(e.target.value) })}
          className="w-full accent-primary"
        />
        <div className={`flex justify-between text-xs ${t.textDim}`}>
          <span>1 行</span><span>默认 (7)</span><span>14 行</span>
        </div>
      </div>
    </div>
  );

  // ── 风格设置面板 ──
  const renderStyle = () => {
    const styles: { id: DesktopStyle; label: string; desc: string }[] = [
      { id: 'glassmorphism', label: '毛玻璃', desc: '半透明磨砂质感，背景虚化' },
      { id: 'neumorphism', label: '新拟态', desc: '柔和浮雕，光影立体感' },
    ];
    return (
      <div className="px-5 py-4 space-y-4">
        <button type="button" onClick={() => setPanel('main')} className={`flex items-center gap-1.5 text-sm ${t.backText}`}>
          <ChevronLeft className="w-4 h-4" /> 返回
        </button>
        <h3 className={`text-base font-semibold ${t.textPrimary}`}>风格设置</h3>
        <div className="space-y-3">
          {styles.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => updateSettings({ style: s.id })}
              className={`flex items-center gap-3 w-full rounded-2xl px-4 py-3.5 border transition-colors ${
                settings.style === s.id
                  ? 'bg-primary/15 border-primary/60'
                  : `${t.itemBg} ${t.itemBorder}`
              }`}
            >
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                settings.style === s.id ? 'border-primary bg-primary' : isNeu ? 'border-gray-300' : 'border-white/30'
              }`}>
                {settings.style === s.id && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
              </div>
              <div className="text-left">
                <p className={`text-sm font-medium ${settings.style === s.id ? 'text-primary' : t.textPrimary}`}>{s.label}</p>
                <p className={`text-xs ${t.textDim}`}>{s.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  };

  // ── 组件管理面板 ──
  const renderWidgets = () => {
    const widgetDefs = [
      { id: 'widget-clock' as const, label: '时钟', desc: '显示实时时间、日期与农历', icon: <Clock className="w-5 h-5" /> },
      { id: 'widget-search' as const, label: '搜索栏', desc: '点击左侧引擎图标可切换 / 添加搜索引擎', icon: <Search className="w-5 h-5" /> },
    ];
    return (
      <div className="px-5 py-4 space-y-4">
        <button type="button" onClick={() => setPanel('main')} className={`flex items-center gap-1.5 text-sm ${t.backText}`}>
          <ChevronLeft className="w-4 h-4" /> 返回
        </button>
        <h3 className={`text-base font-semibold ${t.textPrimary}`}>组件管理</h3>
        <p className={`text-xs ${t.textDim}`}>点击开关可在桌面上显示或隐藏对应组件</p>
        <div className="space-y-3">
          {widgetDefs.map((w) => {
            const enabled = widgetExists(w.id);
            return (
              <button
                key={w.id}
                type="button"
                onClick={() => toggleWidget(w.id)}
                className={`flex items-center gap-3 w-full rounded-2xl px-4 py-3.5 ${t.itemBg} ${t.itemBgHover} border ${t.itemBorder} transition-colors`}
              >
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-colors ${enabled ? 'bg-teal-500 text-white' : isNeu ? 'bg-gray-200 text-gray-400' : 'bg-white/10 text-white/40'}`}>
                  {w.icon}
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <p className={`text-sm font-medium ${t.textPrimary}`}>{w.label}</p>
                  <p className={`text-xs ${t.textDim}`}>{w.desc}</p>
                </div>
                <div className={`w-11 h-6 rounded-full transition-colors shrink-0 relative ${enabled ? 'bg-teal-500' : isNeu ? 'bg-gray-300' : 'bg-white/20'}`}>
                  <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </div>
              </button>
            );
          })}
        </div>
        <p className={`text-xs ${t.textDim} pt-1`}>💡 搜索引擎切换：点击搜索框左侧的引擎图标即可打开选择面板</p>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center" onClick={handleClose}>
      <div
        className={`w-full max-w-lg rounded-t-3xl animate-slide-up flex flex-col ${t.sheetBg} ${t.sheetBorder}`}
        style={{
          maxHeight: '85dvh',
          overflow: 'hidden',
          ...(isNeu ? { boxShadow: '0 -8px 32px rgba(0,0,0,0.08), 0 -2px 8px rgba(0,0,0,0.04)' } : (t.sheetStyle as React.CSSProperties)),
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className={`w-10 h-1 rounded-full ${t.handle}`} />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {panel === 'main'    && renderMain()}
          {panel === 'bg'      && renderBg()}
          {panel === 'view'    && renderView()}
          {panel === 'style'   && renderStyle()}
          {panel === 'widgets' && renderWidgets()}
          {panel !== 'bg' && <div className="pb-6" />}
        </div>
      </div>
    </div>
  );
};

export default SettingsView;
