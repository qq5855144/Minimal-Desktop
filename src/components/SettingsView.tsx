import React, { useState, useRef, useCallback } from 'react';
import { useDesktop } from '@/contexts/DesktopContext';
import type { DesktopStyle } from '@/types';
import {
  Image, Video, LayoutGrid, Palette, ChevronRight, ChevronLeft,
  RotateCcw, FilePlus, X, Check, Clock, Search, Layers,
} from 'lucide-react';
import { toast } from 'sonner';
import { defaultDesktopData, WIDGET_ITEMS } from '@/lib/storage';
import { getPanelTheme } from '@/lib/panelTheme';

type Panel = 'main' | 'bg' | 'view' | 'style' | 'widgets';

interface SettingsViewProps {
  open: boolean;
  onClose: () => void;
}

const SettingsView: React.FC<SettingsViewProps> = ({ open, onClose }) => {
  const { data, addPage, setCurrentPage, importData, settings, updateSettings } = useDesktop();
  const [panel, setPanel] = useState<Panel>('main');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isNeu = settings.style === 'neumorphism';
  const t = getPanelTheme(isNeu);

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
  const renderBg = () => (
    <div className="px-5 py-4 space-y-4">
      <button type="button" onClick={() => setPanel('main')} className={`flex items-center gap-1.5 text-sm ${t.backText}`}>
        <ChevronLeft className="w-4 h-4" /> 返回
      </button>
      <h3 className={`text-base font-semibold ${t.textPrimary}`}>背景设置</h3>
      <div className={`relative w-full aspect-[9/4] rounded-2xl overflow-hidden ${t.itemBg}`}>
        {settings.bgType === 'video' && settings.bgVideo ? (
          <video src={settings.bgVideo} autoPlay loop muted playsInline className="w-full h-full object-cover" />
        ) : settings.bgType === 'image' && settings.bgImage ? (
          <img src={settings.bgImage} alt="壁纸预览" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-blue-600/40 to-purple-600/40 flex items-center justify-center">
            <span className={`text-sm ${t.textDim}`}>默认渐变背景</span>
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
          className={`flex items-center justify-center gap-2 rounded-2xl px-4 py-3 ${t.itemBg} ${t.itemBgHover} ${t.textMuted} text-sm transition-colors border ${t.itemBorder}`}
        >
          <Video className="w-4 h-4" /> 选择视频
        </button>
      </div>
      {(settings.bgImage || settings.bgVideo) && (
        <button
          type="button"
          onClick={handleClearBg}
          className={`w-full flex items-center justify-center gap-2 rounded-2xl px-4 py-3 ${t.itemBg} ${t.itemBgHover} ${t.textDim} text-sm transition-colors border ${t.itemBorder}`}
        >
          <X className="w-4 h-4" /> 恢复默认背景
        </button>
      )}
      <p className={`text-xs ${t.textDim}`}>支持 JPG / PNG / GIF / WEBP 图片及 MP4 / WEBM 视频。视频壁纸在页面刷新后失效。</p>
    </div>
  );

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
      { id: 'widget-search' as const, label: '搜索栏', desc: 'Bing 搜索 / 网址直达', icon: <Search className="w-5 h-5" /> },
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
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center" onClick={handleClose}>
      <div
        className={`w-full max-w-lg rounded-t-3xl overflow-hidden animate-slide-up ${t.sheetBg} ${t.sheetBorder}`}
        style={isNeu ? { boxShadow: '0 -8px 32px rgba(0,0,0,0.08), 0 -2px 8px rgba(0,0,0,0.04)' } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className={`w-10 h-1 rounded-full ${t.handle}`} />
        </div>
        {panel === 'main'    && renderMain()}
        {panel === 'bg'      && renderBg()}
        {panel === 'view'    && renderView()}
        {panel === 'style'   && renderStyle()}
        {panel === 'widgets' && renderWidgets()}
        <div className="pb-6" />
      </div>
    </div>
  );
};

export default SettingsView;
