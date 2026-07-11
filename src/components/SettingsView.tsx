import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useDesktop } from '@/contexts/DesktopContext';
import type { DesktopStyle } from '@/types';
import {
  Image, Video, LayoutGrid, Palette, ChevronRight, ChevronLeft,
  RotateCcw, FilePlus, X, Check, Clock, Search, Layers,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { defaultDesktopData, WIDGET_ITEMS, DEFAULT_BG_IMAGE } from '@/lib/storage';
import { getPanelTheme } from '@/lib/panelTheme';
import { saveVideoDB, clearVideoDB, IDB_VIDEO_MARKER, VIDEO_MAX_BYTES } from '@/lib/videoStorage';

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

// 分类 → Pixabay 搜索关键词
const PIXABAY_QUERIES: Record<Exclude<BgCategory, 'bing'>, string> = {
  nature:  'nature forest mountain waterfall',
  city:    'city skyline architecture night',
  space:   'galaxy nebula space cosmos',
  minimal: 'minimalism abstract geometry clean',
};
const CATEGORY_LABELS: Record<Exclude<BgCategory, 'bing'>, string> = {
  nature:  '自然风景',
  city:    '城市建筑',
  space:   '宇宙星空',
  minimal: '极简抽象',
};

// 各分类精选 Unsplash photo ID（网络异常时的最终兜底，内容严格对应分类）
const UNSPLASH_POOL: Record<Exclude<BgCategory, 'bing'>, string[]> = {
  nature: [
    '1506905925346-21bda4d32df4','1469474968028-56623f02e42e','1426604966848-d7adac402bff',
    '1501854140801-50d01698950b','1433086966358-54859d0ed716','1472214103451-9374bd1c798e',
    '1559827260-dc66d52bef19','1476842634003-7dcca8f832de','1500534314209-a25ddb2bd429',
    '1518173946687-a4c8892bbd9f','1519681393784-d120267933ba','1464822759023-fed622ff2c3b',
    '1448375240586-3310fffb9e2b','1491466153226-b5522a4cf6c1','1516912481800-b0194da29a51',
    '1455156218388-5e61287f89af','1504280390367-361c6d9f38f4','1434394354979-a235cd36269d',
    '1441974231531-c6227db2b6a5','1490730141103-6cac27aaab94',
  ],
  city: [
    '1477959858617-67f85cf4f1df','1480714378408-67cf0d13bc1b','1444723121867-7a241cacace9',
    '1534430480872-3498386e7856','1486325212027-8081e485255e','1519501025264-65ba15a82390',
    '1513635269975-59663e0ac1ad','1558618666-fcd25c85cd64','1542051841857-5f90071e7989',
    '1449824913935-59a10b8d2000','1431066153169-e69cb069d0a1','1486816428908-db2af4c8ebde',
    '1505761671935-60b3a7427bad','1470252649378-9c29740c9fa8','1435224668334-0f82ec57b605',
    '1496568816309-51d7c20e3b21','1514924013411-cbf0fb7bf1f6','1498503403619-e39a4ff390cb',
    '1477322524744-0eece9e79640','1460317442301-4f3d2ad4d8b5',
  ],
  space: [
    '1462331940025-496dfbfc7564','1419242902214-272b3f66ee7a','1534796636912-3b95b3ab5986',
    '1454789548928-9efd52dc4031','1543722530-d2c3201371e7','1614732414444-096e5f1122d5',
    '1581822261290-991b38693d1b','1509773896068-7fd415d91e2e','1539321908154-04927596764d',
    '1446776811953-b23d57bd21aa','1503264116898-7b5e2b5c32b3','1467261939-69e12d55e9e3',
    '1520034475321-cbe63696469a','1504192010706-dd7f569ee2be','1451187580459-43490279c0fa',
    '1502134249126-9f3755a50d78','1444703686981-a3abbc4d4fe3','1478760329108-5c3ed9d495a0',
    '1516339901601-2e1b62dc0c45','1543722530-d2c3201371e7',
  ],
  minimal: [
    '1557682250-33bd709cbe85','1558591710-4b4a1ae0f04d','1579546929518-9e396f3cc809',
    '1500462918059-b1a0cb512f1d','1542281286-9e0a16bb7366','1525909002-1b05e0c869d8',
    '1550684848-fac1c5b4e853','1536566482680-fca0e1e20f28','1507003211169-0a1dd7228f2d',
    '1508615039623-a25605d2b022','1553356084-58ef4a67b2a7','1493238792000-8113da705763',
    '1568702846914-96b305d2aaeb','1574169208507-84aef6f80c47','1524274568599-fd37951b12de',
    '1561716741-3006cf53a9d1','1567360425852-ad6d2e98fb20','1544013585-c9b42cbcf2ad',
    '1518640467707-6811f4a6ab73','1494438639946-1ebd1d20bf85',
  ],
};

// 精选 Unsplash 兜底（网络全部失败时使用）
function unsplashFallback(cat: Exclude<BgCategory, 'bing'>, page: number, sessionSeed: number): CuratedWallpaper[] {
  const pool = UNSPLASH_POOL[cat];
  return Array.from({ length: 9 }, (_, i) => {
    const idx = (sessionSeed % pool.length + page * 9 + i) % pool.length;
    const id = pool[idx];
    return {
      thumb: `https://images.unsplash.com/photo-${id}?w=480&q=70`,
      full:  `https://images.unsplash.com/photo-${id}?w=1920&q=90`,
      title: `${CATEGORY_LABELS[cat]} ${page * 9 + i + 1}`,
    };
  });
}

// Pixabay API（主力源，国内直连，内容500万+，支持关键词分类搜索）
const PIXABAY_KEY_DEFAULT = '56625856-05d192fea977d7f39a4401e8f';
async function fetchPixabayImages(
  cat: Exclude<BgCategory, 'bing'>,
  page: number,
  apiKey: string,
): Promise<CuratedWallpaper[]> {
  const q = encodeURIComponent(PIXABAY_QUERIES[cat]);
  // Pixabay page 从 1 开始；order=popular 保证高质量图片优先
  const directUrl = `https://pixabay.com/api/?key=${apiKey}&q=${q}&image_type=photo&orientation=horizontal&safesearch=true&order=popular&min_width=1920&per_page=9&page=${page + 1}`;

  // 先尝试直连；若 CORS 拦截（status 0 / TypeError）则走 allorigins 代理
  let data: { hits: Array<{ webformatURL: string; largeImageURL: string; tags: string }> } | null = null;
  try {
    const res = await fetch(directUrl, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      data = await res.json();
    }
  } catch {
    // 直连失败，走代理
  }

  if (!data) {
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(directUrl)}`;
    const proxyRes = await fetch(proxyUrl, { signal: AbortSignal.timeout(12000) });
    if (!proxyRes.ok) throw new Error(`Pixabay proxy HTTP ${proxyRes.status}`);
    const wrapper = await proxyRes.json() as { contents: string };
    data = JSON.parse(wrapper.contents);
  }

  if (!data?.hits?.length) throw new Error('no results');
  return data.hits.map((h, i) => ({
    thumb: h.webformatURL,
    full:  h.largeImageURL,
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

  // ── 精选分类壁纸 fetch（Pixabay 主力 + 精选Unsplash分类兜底）──
  const fetchCategoryImages = useCallback(async (cat: Exclude<BgCategory, 'bing'>, page: number) => {
    const key = `${cat}-${page}-${sessionSeedRef.current}`;
    if (catImages[key]) return; // 已缓存
    setCatLoading(cat);
    try {
      const apiKey = PIXABAY_KEY_DEFAULT;
      const items = await fetchPixabayImages(cat, page, apiKey);
      setCatImages((prev) => ({ ...prev, [key]: items }));
    } catch {
      // Pixabay 失败 → 精选 Unsplash 分类兜底（内容与分类严格对应）
      const items = unsplashFallback(cat, page, sessionSeedRef.current);
      setCatImages((prev) => ({ ...prev, [key]: items }));
    } finally {
      setCatLoading(null);
    }
  }, [catImages, settings.pixabayKey]);

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

  const handleVideoFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // 大小限制：50 MB
    if (file.size > VIDEO_MAX_BYTES) {
      toast.error(`视频文件过大（${(file.size / 1024 / 1024).toFixed(1)} MB），请选择 50 MB 以内的视频`);
      e.target.value = '';
      return;
    }
    try {
      // 先创建 blob URL 供即时预览
      const blobUrl = URL.createObjectURL(file);
      // 异步写入 IndexedDB 持久化
      await saveVideoDB(file);
      // 更新设置：内存中用 blobUrl 播放，localStorage 存标记 '__idb__'
      updateSettings({ bgVideo: blobUrl, bgImage: undefined, bgType: 'video' });
      // 手动将 __idb__ 写入 localStorage（绕过 updateSettings 的 blob 拦截）
      const raw = localStorage.getItem('ios_desktop_settings');
      if (raw) {
        const parsed = JSON.parse(raw);
        parsed.bgVideo = IDB_VIDEO_MARKER;
        localStorage.setItem('ios_desktop_settings', JSON.stringify(parsed));
      }
      toast.success('视频壁纸已应用并持久化保存');
    } catch {
      toast.error('视频保存失败，请重试');
    }
    e.target.value = '';
  }, [updateSettings]);

  const handleClearBg = useCallback(() => {
    updateSettings({ bgImage: DEFAULT_BG_IMAGE, bgVideo: undefined, bgType: 'image' });
    clearVideoDB(); // 同步清除 IndexedDB 中的视频
    toast.success('已恢复默认壁纸');
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
      <div className="grid grid-cols-3 gap-2 py-2">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className={`aspect-video rounded-xl animate-pulse ${isNeu ? 'bg-gray-200' : 'bg-white/10'}`} />
        ))}
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
                className={`text-xs font-medium ${t.textDim} disabled:opacity-40 hover:text-primary transition-colors`}>
                {bingLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : '刷新'}
              </button>
            ) : (
              <button type="button" onClick={() => {
                const cat = bgCat as Exclude<BgCategory, 'bing'>;
                const next = (catPage[cat] ?? 0) + 1;
                setCatPage((prev) => ({ ...prev, [cat]: next }));
              }} disabled={catLoading === bgCat}
                className={`text-xs font-medium ${t.textDim} disabled:opacity-40 hover:text-primary transition-colors`}>
                {catLoading === bgCat ? <Loader2 className="w-4 h-4 animate-spin" /> : '更多'}
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
            // catLoading 或 items 尚未就绪时，均用骨架占位，避免面板高度收缩
            if (catLoading === cat || !items) return (
              <div className="grid grid-cols-3 gap-2 py-2">
                {Array.from({ length: 9 }).map((_, i) => (
                  <div key={i} className={`aspect-video rounded-xl animate-pulse ${isNeu ? 'bg-gray-200' : 'bg-white/10'}`} />
                ))}
              </div>
            );
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
              className="shrink-0 px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-semibold transition-colors disabled:opacity-40">
              应用
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
