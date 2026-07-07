import React, { useState, useRef, useCallback } from 'react';
import { useDesktop } from '@/contexts/DesktopContext';
import type { DesktopStyle } from '@/types';
import {
  Image, Video, LayoutGrid, Palette, ChevronRight, ChevronLeft,
  RotateCcw, FilePlus, X, Check, Clock, Search, Layers,
} from 'lucide-react';
import { toast } from 'sonner';
import { defaultDesktopData, WIDGET_ITEMS } from '@/lib/storage';

type Panel = 'main' | 'bg' | 'view' | 'style' | 'widgets';

interface SettingsViewProps {
  open: boolean;
  onClose: () => void;
}

const SettingsView: React.FC<SettingsViewProps> = ({ open, onClose }) => {
  const { data, addPage, setCurrentPage, importData, settings, updateSettings } = useDesktop();
  const [panel, setPanel] = useState<Panel>('main');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleClose = () => { setPanel('main'); onClose(); };

  // ── 背景 ──
  const handleBgFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isVideo = file.type.startsWith('video/');
    if (isVideo) {
      const url = URL.createObjectURL(file);
      updateSettings({ bgVideo: url, bgImage: undefined, bgType: 'video' });
      toast.success('视频壁纸已应用（刷新后失效，建议使用图片）');
    } else {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const base64 = ev.target?.result as string;
        updateSettings({ bgImage: base64, bgVideo: undefined, bgType: 'image' });
        toast.success('壁纸已更新');
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  }, [updateSettings]);

  const handleClearBg = useCallback(() => {
    updateSettings({ bgImage: undefined, bgVideo: undefined, bgType: 'default' });
    toast.success('已恢复默认背景');
  }, [updateSettings]);

  // ── 数据 ──
  const handleAddPage = useCallback(() => {
    addPage();
    setCurrentPage(data.pages.length);
    toast.success('已添加新页面');
    handleClose();
  }, [addPage, setCurrentPage, data.pages.length]);

  // 恢复默认：还原系统应用 + widgets，保留用户添加的应用
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
      // 移除：过滤掉该 widget
      const newData = structuredClone(data);
      newData.pages = newData.pages.map((p) => p.filter((it) => it.id !== widgetId));
      importData(newData);
      toast.success('已移除组件');
    } else {
      // 添加回默认位置
      const def = WIDGET_ITEMS.find((w) => w.id === widgetId);
      if (!def) return;
      const newData = structuredClone(data);
      // 找 page0 中不冲突的行
      const usedRows = new Set(newData.pages[0].map((it) => it.row));
      let targetRow = def.row;
      if (usedRows.has(targetRow)) {
        // 找一个空行
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

  const overlay = 'fixed inset-0 z-[80] flex items-end justify-center';
  const sheet = 'w-full max-w-lg rounded-t-3xl overflow-hidden animate-slide-up';
  const sheetBg = 'bg-[rgba(20,20,30,0.92)] backdrop-blur-2xl border-t border-white/10';

  // ── 主面板 ──
  const renderMain = () => (
    <div className="px-5 py-4 space-y-2">
      <h2 className="text-base font-semibold text-white mb-3">设置</h2>
      {[
        {
          id: 'bg' as Panel,
          icon: <Image className="w-5 h-5" />,
          label: '背景设置',
          desc: settings.style === 'neumorphism' ? '新拟态风格下不可用' : '壁纸、视频、GIF',
          color: 'bg-blue-500',
          disabled: settings.style === 'neumorphism',
        },
        { id: 'view' as Panel, icon: <LayoutGrid className="w-5 h-5" />, label: '应用视图设置', desc: `图标 ${settings.iconSize}px · ${settings.cols} 列`, color: 'bg-indigo-500', disabled: false },
        { id: 'style' as Panel, icon: <Palette className="w-5 h-5" />, label: '风格设置', desc: settings.style === 'glassmorphism' ? '毛玻璃' : '新拟态', color: 'bg-purple-500', disabled: false },
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
          className={`flex items-center gap-3 w-full rounded-2xl px-4 py-3 transition-colors ${
            item.disabled
              ? 'bg-white/5 opacity-40 cursor-not-allowed'
              : 'bg-white/10 hover:bg-white/15'
          }`}
        >
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0 ${item.color} ${item.disabled ? 'opacity-50' : ''}`}>
            {item.icon}
          </div>
          <div className="flex-1 min-w-0 text-left">
            <p className="text-sm font-medium text-white">{item.label}</p>
            <p className={`text-xs ${item.disabled ? 'text-red-400/70' : 'text-white/50'}`}>{item.desc}</p>
          </div>
          {!item.disabled && <ChevronRight className="w-4 h-4 text-white/30 shrink-0" />}
        </button>
      ))}

      <div className="pt-2 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={handleAddPage}
          className="flex items-center justify-center gap-2 rounded-2xl px-4 py-3 bg-white/10 hover:bg-white/15 text-white/80 text-sm transition-colors"
        >
          <FilePlus className="w-4 h-4" /> 新增桌面页
        </button>
        <button
          type="button"
          onClick={handleResetToDefault}
          className="flex items-center justify-center gap-2 rounded-2xl px-4 py-3 bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 text-sm transition-colors"
        >
          <RotateCcw className="w-4 h-4" /> 恢复默认
        </button>
      </div>
    </div>
  );

  // ── 背景设置面板 ──
  const renderBg = () => (
    <div className="px-5 py-4 space-y-4">
      <button type="button" onClick={() => setPanel('main')} className="flex items-center gap-1.5 text-white/60 text-sm">
        <ChevronLeft className="w-4 h-4" /> 返回
      </button>
      <h3 className="text-base font-semibold text-white">背景设置</h3>
      <div className="relative w-full aspect-[9/4] rounded-2xl overflow-hidden bg-white/5">
        {settings.bgType === 'video' && settings.bgVideo ? (
          <video src={settings.bgVideo} autoPlay loop muted playsInline className="w-full h-full object-cover" />
        ) : settings.bgType === 'image' && settings.bgImage ? (
          <img src={settings.bgImage} alt="壁纸预览" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-blue-600/40 to-purple-600/40 flex items-center justify-center">
            <span className="text-white/40 text-sm">默认渐变背景</span>
          </div>
        )}
      </div>
      <input ref={fileInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleBgFile} />
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center justify-center gap-2 rounded-2xl px-4 py-3 bg-primary/20 hover:bg-primary/30 text-primary text-sm font-medium transition-colors"
        >
          <Image className="w-4 h-4" /> 选择图片/GIF
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center justify-center gap-2 rounded-2xl px-4 py-3 bg-white/10 hover:bg-white/15 text-white/70 text-sm transition-colors"
        >
          <Video className="w-4 h-4" /> 选择视频
        </button>
      </div>
      {(settings.bgImage || settings.bgVideo) && (
        <button
          type="button"
          onClick={handleClearBg}
          className="w-full flex items-center justify-center gap-2 rounded-2xl px-4 py-3 bg-white/5 hover:bg-white/10 text-white/50 text-sm transition-colors"
        >
          <X className="w-4 h-4" /> 恢复默认背景
        </button>
      )}
      <p className="text-xs text-white/30">支持 JPG / PNG / GIF / WEBP 图片及 MP4 / WEBM 视频。视频壁纸在页面刷新后失效。</p>
    </div>
  );

  // ── 应用视图设置面板 ──
  const renderView = () => (
    <div className="px-5 py-4 space-y-5">
      <button type="button" onClick={() => setPanel('main')} className="flex items-center gap-1.5 text-white/60 text-sm">
        <ChevronLeft className="w-4 h-4" /> 返回
      </button>
      <h3 className="text-base font-semibold text-white">应用视图设置</h3>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-white/80">图标大小</span>
          <span className="text-sm font-medium text-primary">{settings.iconSize} px</span>
        </div>
        <input
          type="range" min={36} max={64} step={2}
          value={settings.iconSize}
          onChange={(e) => updateSettings({ iconSize: Number(e.target.value) })}
          className="w-full accent-primary"
        />
        <div className="flex justify-between text-xs text-white/30">
          <span>小 (36)</span><span>默认 (46)</span><span>大 (64)</span>
        </div>
      </div>
      <div className="space-y-3">
        <span className="text-sm text-white/80">每行列数</span>
        <div className="grid grid-cols-2 gap-3 mt-2">
          {([4, 5] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => updateSettings({ cols: c })}
              className={`flex flex-col items-center gap-2 rounded-2xl py-3 border transition-colors ${
                settings.cols === c
                  ? 'bg-primary/20 border-primary text-primary'
                  : 'bg-white/5 border-white/10 text-white/60'
              }`}
            >
              <div className={`grid gap-1 ${c === 4 ? 'grid-cols-4' : 'grid-cols-5'}`}>
                {Array.from({ length: c }).map((_, i) => (
                  <div key={i} className={`w-4 h-4 rounded-md ${settings.cols === c ? 'bg-primary/60' : 'bg-white/20'}`} />
                ))}
              </div>
              <span className="text-sm font-medium">{c} 列</span>
              {c === 4 && <span className="text-xs opacity-50">默认</span>}
            </button>
          ))}
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
        <button type="button" onClick={() => setPanel('main')} className="flex items-center gap-1.5 text-white/60 text-sm">
          <ChevronLeft className="w-4 h-4" /> 返回
        </button>
        <h3 className="text-base font-semibold text-white">风格设置</h3>
        <div className="space-y-3">
          {styles.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => updateSettings({ style: s.id })}
              className={`flex items-center gap-3 w-full rounded-2xl px-4 py-3.5 border transition-colors ${
                settings.style === s.id
                  ? 'bg-primary/15 border-primary/60'
                  : 'bg-white/5 border-white/10'
              }`}
            >
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                settings.style === s.id ? 'border-primary bg-primary' : 'border-white/30'
              }`}>
                {settings.style === s.id && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
              </div>
              <div className="text-left">
                <p className={`text-sm font-medium ${settings.style === s.id ? 'text-primary' : 'text-white/80'}`}>{s.label}</p>
                <p className="text-xs text-white/40">{s.desc}</p>
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
      { id: 'widget-search' as const, label: '搜索栏', desc: 'Bing 搜索 / 网址直达', icon: <Search className="w-5 h-5" /> },
    ];
    return (
      <div className="px-5 py-4 space-y-4">
        <button type="button" onClick={() => setPanel('main')} className="flex items-center gap-1.5 text-white/60 text-sm">
          <ChevronLeft className="w-4 h-4" /> 返回
        </button>
        <h3 className="text-base font-semibold text-white">组件管理</h3>
        <p className="text-xs text-white/40">点击开关可在桌面上显示或隐藏对应组件</p>
        <div className="space-y-3">
          {widgetDefs.map((w) => {
            const enabled = widgetExists(w.id);
            return (
              <button
                key={w.id}
                type="button"
                onClick={() => toggleWidget(w.id)}
                className="flex items-center gap-3 w-full rounded-2xl px-4 py-3.5 bg-white/8 hover:bg-white/12 border border-white/10 transition-colors"
              >
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-colors ${enabled ? 'bg-teal-500 text-white' : 'bg-white/10 text-white/40'}`}>
                  {w.icon}
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-medium text-white">{w.label}</p>
                  <p className="text-xs text-white/40">{w.desc}</p>
                </div>
                {/* 开关 */}
                <div className={`w-11 h-6 rounded-full transition-colors shrink-0 relative ${enabled ? 'bg-teal-500' : 'bg-white/20'}`}>
                  <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className={overlay} onClick={handleClose}>
      <div className={`${sheet} ${sheetBg}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>
        {panel === 'main' && renderMain()}
        {panel === 'bg' && renderBg()}
        {panel === 'view' && renderView()}
        {panel === 'style' && renderStyle()}
        {panel === 'widgets' && renderWidgets()}
        <div className="h-safe-area pb-6" />
      </div>
    </div>
  );
};

export default SettingsView;
