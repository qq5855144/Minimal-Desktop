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
type BgTab = 'bing' | 'local' | 'url';

interface BingImage {
  url: string;          // 完整图片 URL
  copyright: string;    // 版权描述
  title: string;
}

interface SettingsViewProps {
  open: boolean;
  onClose: () => void;
}

const SettingsView: React.FC<SettingsViewProps> = ({ open, onClose }) => {
  const { data, addPage, setCurrentPage, importData, settings, updateSettings } = useDesktop();
  const [panel, setPanel] = useState<Panel>('main');
  const [urlInput, setUrlInput] = useState('');
  const [bgTab, setBgTab] = useState<BgTab>('bing');
  const [bingImages, setBingImages] = useState<BingImage[]>([]);
  const [bingLoading, setBingLoading] = useState(false);
  const [bingError, setBingError] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const isNeu = settings.style === 'neumorphism';
  const t = getPanelTheme(isNeu);

  const handleClose = () => { setPanel('main'); onClose(); };

  // ── 必应壁纸 fetch ──
  const fetchBingWallpapers = useCallback(async () => {
    setBingLoading(true);
    setBingError(false);
    try {
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(
        'https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8&mkt=zh-CN'
      )}`;
      const res = await fetch(proxyUrl);
      const data = await res.json();
      const parsed = JSON.parse(data.contents);
      const imgs: BingImage[] = (parsed.images as { url: string; copyright: string; title?: string }[]).map((img) => ({
        url: `https://www.bing.com${img.url.replace(/1920x1080/g, '1920x1080')}`,
        copyright: img.copyright,
        title: img.title ?? img.copyright.split('（')[0].split(' (')[0],
      }));
      setBingImages(imgs);
    } catch {
      setBingError(true);
    } finally {
      setBingLoading(false);
    }
  }, []);

  // 打开背景面板时自动加载
  useEffect(() => {
    if (panel === 'bg' && bgTab === 'bing' && bingImages.length === 0 && !bingLoading) {
      fetchBingWallpapers();
    }
  }, [panel, bgTab, bingImages.length, bingLoading, fetchBingWallpapers]);

  // ── 应用必应壁纸 ──
  const applyBingWallpaper = useCallback((img: BingImage) => {
    updateSettings({ bgImage: img.url, bgVideo: undefined, bgType: 'image' });
    toast.success('必应壁纸已应用');
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
          onClick={() => !item.disabled && setPanel(item.id)}
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
    const tabs: { id: BgTab; label: string }[] = [
      { id: 'bing', label: '必应每日' },
      { id: 'local', label: '本地文件' },
      { id: 'url', label: '图片 URL' },
    ];

    // 当前壁纸状态标识（已内联到 return）


    // 标签切换栏
    const tabBar = (
      <div className={`flex rounded-xl p-0.5 mb-4 ${isNeu ? 'bg-gray-200' : 'bg-white/10'}`}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setBgTab(tab.id);
              if (tab.id === 'bing' && bingImages.length === 0 && !bingLoading) fetchBingWallpapers();
            }}
            className={`flex-1 py-2 rounded-[10px] text-xs font-medium transition-all ${
              bgTab === tab.id
                ? isNeu
                  ? 'bg-white shadow text-gray-800'
                  : 'bg-white/20 text-white shadow'
                : isNeu
                  ? 'text-gray-500 hover:text-gray-700'
                  : 'text-white/50 hover:text-white/80'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    );

    // 必应壁纸 tab
    const bingTab = (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className={`text-xs ${t.textDim}`}>过去 8 天的必应每日壁纸</p>
          <button
            type="button"
            onClick={fetchBingWallpapers}
            disabled={bingLoading}
            className={`flex items-center gap-1 text-xs ${t.backText} disabled:opacity-40`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${bingLoading ? 'animate-spin' : ''}`} /> 刷新
          </button>
        </div>
        {bingLoading ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <Loader2 className={`w-6 h-6 animate-spin ${t.textDim}`} />
            <span className={`text-xs ${t.textDim}`}>正在加载必应壁纸…</span>
          </div>
        ) : bingError ? (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <span className={`text-xs ${t.textDim}`}>加载失败，请检查网络</span>
            <button
              type="button"
              onClick={fetchBingWallpapers}
              className="text-xs text-primary underline"
            >重试</button>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {bingImages.map((img, i) => {
              const thumbUrl = img.url.replace(/1920x1080/g, '640x360');
              const isActive = settings.bgImage === img.url;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => applyBingWallpaper(img)}
                  className={`relative aspect-video rounded-xl overflow-hidden border-2 transition-all ${
                    isActive ? 'border-primary scale-[0.97]' : isNeu ? 'border-gray-200 hover:border-gray-400' : 'border-white/10 hover:border-white/40'
                  }`}
                >
                  <img
                    src={thumbUrl}
                    alt={img.title}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    crossOrigin="anonymous"
                  />
                  {isActive && (
                    <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                      <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                        <Check className="w-3 h-3 text-white" strokeWidth={3} />
                      </div>
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-1 py-0.5">
                    <p className="text-white/90 text-[8px] leading-tight truncate">{img.title}</p>
                  </div>
                  {i === 0 && (
                    <div className="absolute top-1 left-1 bg-primary text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full">今日</div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );

    // 本地文件 tab
    const localTab = (
      <div className="space-y-3">
        <input ref={fileInputRef} type="file" accept="image/*,image/gif" className="hidden" onChange={handleBgFile} />
        <input ref={videoInputRef} type="file" accept="video/mp4,video/webm,video/ogg" className="hidden" onChange={handleVideoFile} />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className={`flex items-center gap-3 w-full rounded-2xl px-4 py-3.5 border transition-colors ${t.itemBg} ${t.itemBgHover} ${t.itemBorder}`}
        >
          <div className="w-9 h-9 rounded-xl bg-blue-500 flex items-center justify-center shrink-0">
            <Image className="w-5 h-5 text-white" />
          </div>
          <div className="text-left">
            <p className={`text-sm font-medium ${t.textPrimary}`}>选择图片 / GIF</p>
            <p className={`text-xs ${t.textDim}`}>JPG · PNG · GIF · WEBP</p>
          </div>
          <ChevronRight className={`w-4 h-4 shrink-0 ml-auto ${t.textDim}`} />
        </button>
        <button
          type="button"
          onClick={() => videoInputRef.current?.click()}
          className={`flex items-center gap-3 w-full rounded-2xl px-4 py-3.5 border transition-colors ${t.itemBg} ${t.itemBgHover} ${t.itemBorder}`}
        >
          <div className="w-9 h-9 rounded-xl bg-orange-500 flex items-center justify-center shrink-0">
            <Video className="w-5 h-5 text-white" />
          </div>
          <div className="text-left">
            <p className={`text-sm font-medium ${t.textPrimary}`}>选择视频</p>
            <p className={`text-xs ${t.textDim}`}>MP4 · WEBM（刷新后失效）</p>
          </div>
          <ChevronRight className={`w-4 h-4 shrink-0 ml-auto ${t.textDim}`} />
        </button>
      </div>
    );

    // URL 输入 tab
    const urlTab = (
      <div className="space-y-3">
        <p className={`text-xs ${t.textDim}`}>输入图片或视频的直链地址</p>
        <div className={`flex rounded-2xl border overflow-hidden ${t.itemBorder}`}>
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleBgUrl()}
            placeholder="https://example.com/wallpaper.jpg"
            className={`flex-1 min-w-0 bg-transparent px-4 py-3 text-sm outline-none ${t.textPrimary} placeholder:${t.textDim}`}
          />
        </div>
        <button
          type="button"
          onClick={handleBgUrl}
          disabled={!urlInput.trim()}
          className="w-full flex items-center justify-center gap-2 rounded-2xl px-4 py-3 bg-primary/20 hover:bg-primary/30 text-primary text-sm font-medium transition-colors disabled:opacity-40"
        >
          <Link className="w-4 h-4" /> 应用壁纸
        </button>
        <p className={`text-xs ${t.textDim}`}>视频链接（.mp4/.webm）将作为动态壁纸，页面刷新后失效</p>
      </div>
    );

    return (
      <div className="flex flex-col h-full">
        {/* 固定头部：返回 + 标题 + 紧凑预览条 */}
        <div className="px-5 pt-3 pb-2 shrink-0">
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={() => setPanel('main')} className={`flex items-center gap-1 text-sm ${t.backText}`}>
              <ChevronLeft className="w-4 h-4" /> 返回
            </button>
            <h3 className={`text-sm font-semibold ${t.textPrimary}`}>背景设置</h3>
            {(settings.bgImage || settings.bgVideo) ? (
              <button type="button" onClick={handleClearBg} className={`text-xs ${t.textDim} hover:text-red-400 transition-colors`}>
                恢复默认
              </button>
            ) : <div className="w-14" />}
          </div>
          {/* 紧凑预览条 */}
          <div className={`relative w-full h-14 rounded-xl overflow-hidden ${t.itemBg}`}>
            {settings.bgType === 'video' && settings.bgVideo ? (
              <video src={settings.bgVideo} autoPlay loop muted playsInline className="w-full h-full object-cover" />
            ) : settings.bgType === 'image' && settings.bgImage ? (
              <img src={settings.bgImage} alt="当前壁纸" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-gradient-to-r from-blue-600/40 to-purple-600/40" />
            )}
            <div className="absolute inset-0 bg-black/30 flex items-center px-3">
              <span className="text-white/90 text-xs font-medium">
                {settings.bgType === 'default' ? '默认渐变背景' : settings.bgType === 'video' ? '🎬 视频壁纸' : '🖼️ 图片壁纸'}
              </span>
            </div>
          </div>
        </div>

        {/* 固定标签栏 */}
        <div className="px-5 pb-2 shrink-0">
          {tabBar}
        </div>

        {/* 可滚动内容区 */}
        <div className="flex-1 overflow-y-auto px-5 pb-5 min-h-0">
          {bgTab === 'bing'  && bingTab}
          {bgTab === 'local' && localTab}
          {bgTab === 'url'   && urlTab}
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
