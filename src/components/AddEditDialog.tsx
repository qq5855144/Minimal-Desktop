import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { DesktopItem, IconCrop } from '@/types';
import { probeFavicon, guessNameFromUrl, normalizeUrl } from '@/lib/favicon';
import { fetchAndCacheIcon } from '@/lib/iconCache';
import { useDesktop } from '@/contexts/DesktopContext';
import { getPanelTheme } from '@/lib/panelTheme';
import { Upload, Globe, Trash2, Loader2, RefreshCw, Link, ImagePlus, Sparkles, ChevronLeft, Crop } from 'lucide-react';
import IconCropDialog from '@/components/IconCropDialog';
import { optimizeIconFile } from '@/lib/imageOptimize';
import { normalizeHttpUrl } from '@/lib/urlSafety';

interface AddEditDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  item?: DesktopItem | null;
  onAdd?: (app: { name: string; url: string; iconUrl?: string; iconCrop?: IconCrop }) => void;
  onEdit?: (id: string, patch: Partial<DesktopItem>) => void;
  onDelete?: (id: string) => void;
  /** 剪藏预填：打开时自动填入 name/url/iconUrl */
  prefill?: { name: string; url: string; iconUrl?: string };
}

type IconSource = 'auto' | 'url' | 'local';

const AddEditDialog: React.FC<AddEditDialogProps> = ({
  open, onOpenChange, item, onAdd, onEdit, onDelete, prefill,
}) => {
  const isEdit = !!item;
  const { settings } = useDesktop();
  const isNeu = settings.style === 'neumorphism';
  const t = getPanelTheme(isNeu);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [iconSource, setIconSource] = useState<IconSource>('auto');
  // auto 模式：探测到的 favicon URL
  const [autoFavicon, setAutoFavicon] = useState<string | undefined>();
  // URL 模式：用户手动填入
  const [customIconUrl, setCustomIconUrl] = useState('');
  // 本地模式：base64
  const [localIconData, setLocalIconData] = useState<string | undefined>();
  const [fetching, setFetching] = useState(false);
  // 探测是否失败（全源均无法加载）
  const [probeFailed, setProbeFailed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 记录上次探测的 URL，避免重复触发
  const lastProbedUrl = useRef('');
  // 裁剪弹窗
  const [cropSrc, setCropSrc] = useState<string | undefined>();
  // 裁剪参数（CSS 模式，支持任意 URL，无跨域限制）
  const [iconCrop, setIconCrop] = useState<IconCrop | undefined>();

  const effectiveIcon =
    iconSource === 'auto' ? autoFavicon :
    iconSource === 'url'  ? (customIconUrl.trim() || undefined) :
    localIconData;

  // 重置表单（支持剪藏预填 prefill）
  useEffect(() => {
    if (!open) return;
    lastProbedUrl.current = '';
    if (item) {
      setName(item.name);
      setUrl(item.url || '');
      setIconCrop(item.iconCrop);
      if (item.iconUrl?.startsWith('data:')) {
        setIconSource('local'); setLocalIconData(item.iconUrl);
        setAutoFavicon(undefined); setCustomIconUrl(''); setProbeFailed(false);
      } else if (item.iconUrl) {
        setIconSource('url'); setCustomIconUrl(item.iconUrl);
        setAutoFavicon(undefined); setLocalIconData(undefined); setProbeFailed(false);
      } else {
        setIconSource('auto'); setAutoFavicon(undefined);
        setCustomIconUrl(''); setLocalIconData(undefined); setProbeFailed(false);
      }
    } else if (prefill) {
      setName(prefill.name);
      setUrl(prefill.url);
      setIconCrop(undefined);
      if (prefill.iconUrl) {
        setIconSource('url'); setCustomIconUrl(prefill.iconUrl);
        setAutoFavicon(undefined); setLocalIconData(undefined); setProbeFailed(false);
      } else {
        setIconSource('auto'); setAutoFavicon(undefined);
        setCustomIconUrl(''); setLocalIconData(undefined); setProbeFailed(false);
      }
    } else {
      setName(''); setUrl('');
      setIconCrop(undefined);
      setIconSource('auto'); setAutoFavicon(undefined);
      setCustomIconUrl(''); setLocalIconData(undefined); setProbeFailed(false);
    }
  }, [open, item, prefill]);

  // 多源探测 favicon + 自动填充名称
  const runProbe = useCallback(async (rawUrl: string, fillName = false) => {
    if (!rawUrl.trim()) return;
    const normalized = normalizeUrl(rawUrl);
    if (lastProbedUrl.current === normalized) return;
    lastProbedUrl.current = normalized;
    setFetching(true);
    setProbeFailed(false);
    setAutoFavicon(undefined);
    try {
      const found = await probeFavicon(normalized);
      if (found) {
        // 同时缓存到本地 iconCache 以便离线使用
        fetchAndCacheIcon(found);
        setAutoFavicon(found);
        setProbeFailed(false);
      } else {
        setProbeFailed(true);
      }
      if (fillName && !name.trim()) {
        setName(guessNameFromUrl(normalized));
      }
    } finally {
      setFetching(false);
    }
  }, [name]);

  const handleUrlBlur = useCallback(() => {
    if (iconSource === 'auto' && url.trim()) runProbe(url, true);
  }, [url, iconSource, runProbe]);

  const handleRefreshIcon = useCallback(() => {
    lastProbedUrl.current = ''; // 强制重新探测
    runProbe(url, false);
  }, [url, runProbe]);

  // 本地文件上传 → 先把 base64 存入 localIconData，再弹出裁剪弹窗
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { alert('图片不超过 10MB'); e.target.value = ''; return; }
    try {
      const dataUrl = await optimizeIconFile(file);
      setLocalIconData(dataUrl); // 保证 effectiveIcon 有值
      setCropSrc(dataUrl);       // 弹出裁剪
    } catch (error) {
      alert(error instanceof Error ? error.message : '图片处理失败');
    }
    e.target.value = '';
  }, []);

  // 裁剪确认：只更新裁剪参数，localIconData 已在 handleFileChange 里写好
  const handleCropConfirm = useCallback((crop: IconCrop) => {
    setIconCrop(crop);
    setCropSrc(undefined);
  }, []);

  const handleCropCancel = useCallback(() => setCropSrc(undefined), []);

  // 打开裁剪弹窗：新方案直接用图片 src，无需本地化，无跨域限制
  const openCrop = useCallback((src: string) => {
    if (!src) return;
    setCropSrc(src);
  }, []);

  const handleSubmit = useCallback(() => {
    if (!name.trim()) { alert('请输入应用名称'); return; }
    const finalUrl = url.trim() ? normalizeUrl(url) : '';
    const finalIcon = iconSource === 'url'
      ? (normalizeHttpUrl(customIconUrl) ?? undefined)
      : effectiveIcon;
    const patch: Partial<DesktopItem> = {
      name: name.trim(),
      url: finalUrl || undefined,
      iconUrl: finalIcon,
      iconCrop,
    };
    if (isEdit && item && onEdit) {
      onEdit(item.id, patch);
    } else if (onAdd) {
      onAdd({ name: name.trim(), url: finalUrl, iconUrl: finalIcon, iconCrop });
    }
    onOpenChange(false);
  }, [name, url, iconSource, customIconUrl, effectiveIcon, iconCrop, isEdit, item, onAdd, onEdit, onOpenChange]);

  const handleDelete = useCallback(() => {
    if (item && onDelete) { onDelete(item.id); onOpenChange(false); }
  }, [item, onDelete, onOpenChange]);

  const handleClose = useCallback(() => onOpenChange(false), [onOpenChange]);

  const iconSourceTabs: { key: IconSource; icon: React.ReactNode; label: string }[] = [
    { key: 'auto',  icon: <Sparkles className="w-3.5 h-3.5" />,  label: '智能' },
    { key: 'url',   icon: <Link className="w-3.5 h-3.5" />,       label: 'URL' },
    { key: 'local', icon: <ImagePlus className="w-3.5 h-3.5" />,  label: '本地' },
  ];

  if (!open) return null;

  return (
    <>
    {/* 裁剪弹窗（覆盖在最顶层） */}
    {cropSrc && (
      <IconCropDialog
        src={cropSrc}
        onConfirm={handleCropConfirm}
        onCancel={handleCropCancel}
      />
    )}
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 backdrop-blur-sm" onClick={handleClose}>
      <div
        className={`w-full max-w-lg rounded-t-3xl overflow-hidden animate-slide-up pb-[env(safe-area-inset-bottom,0px)] ${t.sheetBg} ${t.sheetBorder} flex flex-col`}
        style={{
          maxHeight: 'var(--desktop-sheet-max-height, 85dvh)',
          ...t.sheetStyle,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 拖拽把手 */}
        <div className="flex justify-center pt-3 pb-1">
          <div className={`w-10 h-1 rounded-full ${t.handle}`} />
        </div>

        <div className="px-5 py-4 space-y-4 flex-1 min-h-0 overflow-y-auto">
          {/* 标题行 */}
          <div className="flex items-center gap-2">
            {isEdit && (
              <button type="button" onClick={handleClose} className={`flex items-center gap-1 text-sm ${t.backText}`}>
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            <h2 className={`text-base font-semibold ${t.textPrimary}`}>{isEdit ? '编辑应用' : '添加应用'}</h2>
          </div>

          {/* 图标预览 + 名称/URL */}
          <div className="flex gap-3 items-start">
            {/* 图标预览区 */}
            <div className="relative shrink-0">
              <div className={`w-[60px] h-[60px] rounded-[22%] flex items-center justify-center overflow-hidden ios-icon-shadow ${t.iconPlaceholder}`}>
                {fetching ? (
                  <Loader2 className={`w-6 h-6 animate-spin ${t.textDim}`} />
                ) : effectiveIcon ? (
                  <img src={effectiveIcon} alt="" className="w-full h-full object-contain"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                ) : (
                  <Globe className={`w-7 h-7 ${t.textDim}`} />
                )}
              </div>
              {/* 刷新按钮（auto 模式） */}
              {iconSource === 'auto' && (
                <button
                  type="button"
                  onClick={handleRefreshIcon}
                  disabled={fetching || !url.trim()}
                  className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full ${t.closeBtn} border ${t.itemBorder} flex items-center justify-center shadow-sm disabled:opacity-30 transition-colors`}
                  title="重新获取图标"
                >
                  <RefreshCw className={`w-2.5 h-2.5 ${t.textMuted}`} />
                </button>
              )}
              {/* 裁剪按钮（有图标时显示） */}
              {effectiveIcon && !fetching && (
                <button
                  type="button"
                  onClick={() => openCrop(effectiveIcon)}
                  className={`absolute -bottom-1 -left-1 w-5 h-5 rounded-full ${t.closeBtn} border ${t.itemBorder} flex items-center justify-center shadow-sm transition-colors`}
                  title="裁剪图标"
                >
                  <Crop className={`w-2.5 h-2.5 ${t.textMuted}`} />
                </button>
              )}
            </div>

            {/* 名称 + URL 输入 */}
            <div className="flex-1 min-w-0 space-y-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="应用名称"
                maxLength={20}
                className={`h-9 text-sm ${isNeu
                  ? 'bg-white/80 border-gray-200 text-gray-800 placeholder:text-gray-400'
                  : 'bg-white/10 border-white/15 text-white placeholder:text-white/30 focus-visible:ring-primary/50'}`}
              />
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onBlur={handleUrlBlur}
                placeholder="网站 URL（如 github.com）"
                className={`h-9 text-sm ${isNeu
                  ? 'bg-white/80 border-gray-200 text-gray-800 placeholder:text-gray-400'
                  : 'bg-white/10 border-white/15 text-white placeholder:text-white/30 focus-visible:ring-primary/50'}`}
              />
            </div>
          </div>

          {/* 图标来源选择器 */}
          <div className="space-y-2">
            <div className={`flex gap-1 p-0.5 ${t.tabBg} rounded-xl`}>
              {iconSourceTabs.map(({ key, icon, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setIconSource(key)}
                  className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 ${
                    iconSource === key
                      ? `${t.tabActive} ${t.tabActiveText} shadow-sm`
                      : `${t.tabInactiveText} hover:${t.textMuted}`
                  }`}
                >
                  {icon}{label}
                </button>
              ))}
            </div>

            {/* 来源说明/输入 */}
            {iconSource === 'auto' && (
              <p className={`text-xs px-1 ${t.textDim}`}>
                {fetching ? '正在探测图标…' :
                 autoFavicon ? '✓ 已成功获取网站图标' :
                 probeFailed ? '⚠ 未能获取图标，可手动切换到 URL 或本地' :
                 '失焦后自动从多个来源探测网站图标'}
              </p>
            )}
            {iconSource === 'url' && (
              <Input
                value={customIconUrl}
                onChange={(e) => setCustomIconUrl(e.target.value)}
                placeholder="图标图片 URL"
                className={`h-9 text-sm ${isNeu
                  ? 'bg-white/80 border-gray-200 text-gray-800 placeholder:text-gray-400'
                  : 'bg-white/10 border-white/15 text-white placeholder:text-white/30 focus-visible:ring-primary/50'}`}
              />
            )}
            {iconSource === 'local' && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className={`flex-1 flex items-center gap-2 px-3 h-9 rounded-xl border border-dashed ${isNeu ? 'border-gray-300 text-gray-400 hover:bg-gray-100' : 'border-white/20 text-white/40 hover:bg-white/8'} text-sm transition-colors`}
                >
                  <Upload className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{localIconData ? '已上传（点击更换）' : '点击选择本地图片'}</span>
                </button>
                {localIconData && (
                  <button
                    type="button"
                    onClick={() => openCrop(localIconData)}
                    className={`flex items-center gap-1 px-3 h-9 rounded-xl border ${isNeu ? 'border-gray-300 text-gray-500 hover:bg-gray-100' : 'border-white/20 text-white/50 hover:bg-white/8'} text-sm transition-colors shrink-0`}
                    title="重新裁剪"
                  >
                    <Crop className="w-3.5 h-3.5" />
                    <span>裁剪</span>
                  </button>
                )}
              </div>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
          </div>
        </div>

        {/* 底部操作栏 */}
        <div className={`flex items-center gap-2 px-5 py-3 border-t shrink-0 ${t.itemBorder}`}>
          {isEdit && onDelete && (
            <Button size="sm" variant="destructive" onClick={handleDelete} className="gap-1">
              <Trash2 className="w-3.5 h-3.5" />删除
            </Button>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={handleClose}
            className={`px-4 py-2 rounded-xl text-sm ${t.textMuted} ${t.closeBtn} ${t.closeBtnHover} transition-colors`}
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {isEdit ? '保存' : '添加'}
          </button>
        </div>

        <div className="pb-6" />
      </div>
    </div>
    </>
  );

};

export default AddEditDialog;
