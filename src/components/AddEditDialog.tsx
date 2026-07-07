import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { DesktopItem } from '@/types';
import { probeFavicon, guessNameFromUrl, normalizeUrl } from '@/lib/favicon';
import { fetchAndCacheIcon } from '@/lib/iconCache';
import { Upload, Globe, Trash2, Loader2, RefreshCw, Link, ImagePlus, Sparkles, ChevronLeft } from 'lucide-react';

interface AddEditDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  item?: DesktopItem | null;
  onAdd?: (app: { name: string; url: string; iconUrl?: string }) => void;
  onEdit?: (id: string, patch: Partial<DesktopItem>) => void;
  onDelete?: (id: string) => void;
}

type IconSource = 'auto' | 'url' | 'local';

const AddEditDialog: React.FC<AddEditDialogProps> = ({
  open, onOpenChange, item, onAdd, onEdit, onDelete,
}) => {
  const isEdit = !!item;
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

  const effectiveIcon =
    iconSource === 'auto' ? autoFavicon :
    iconSource === 'url'  ? (customIconUrl.trim() || undefined) :
    localIconData;

  // 重置表单
  useEffect(() => {
    if (!open) return;
    lastProbedUrl.current = '';
    if (item) {
      setName(item.name);
      setUrl(item.url || '');
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
    } else {
      setName(''); setUrl('');
      setIconSource('auto'); setAutoFavicon(undefined);
      setCustomIconUrl(''); setLocalIconData(undefined); setProbeFailed(false);
    }
  }, [open, item]);

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

  // 本地文件上传
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { alert('图片不超过 3MB'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => setLocalIconData(ev.target?.result as string);
    reader.readAsDataURL(file);
    e.target.value = '';
  }, []);

  const handleSubmit = useCallback(() => {
    if (!name.trim()) { alert('请输入应用名称'); return; }
    const finalUrl = url.trim() ? normalizeUrl(url) : '';
    const finalIcon = effectiveIcon;
    if (isEdit && item && onEdit) {
      onEdit(item.id, { name: name.trim(), url: finalUrl || undefined, iconUrl: finalIcon });
    } else if (onAdd) {
      onAdd({ name: name.trim(), url: finalUrl, iconUrl: finalIcon });
    }
    onOpenChange(false);
  }, [name, url, effectiveIcon, isEdit, item, onAdd, onEdit, onOpenChange]);

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
    <div className="fixed inset-0 z-[80] flex items-end justify-center" onClick={handleClose}>
      <div
        className="w-full max-w-lg rounded-t-3xl overflow-hidden animate-slide-up bg-[rgba(20,20,30,0.92)] backdrop-blur-2xl border-t border-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 拖拽把手 */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* 标题行 */}
          <div className="flex items-center gap-2">
            {isEdit && (
              <button type="button" onClick={handleClose} className="flex items-center gap-1 text-white/50 text-sm">
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            <h2 className="text-base font-semibold text-white">{isEdit ? '编辑应用' : '添加应用'}</h2>
          </div>

          {/* 图标预览 + 名称/URL */}
          <div className="flex gap-3 items-start">
            {/* 图标预览区 */}
            <div className="relative shrink-0">
              <div className="w-[60px] h-[60px] rounded-[22%] flex items-center justify-center overflow-hidden ios-icon-shadow bg-white/10">
                {fetching ? (
                  <Loader2 className="w-6 h-6 text-white/40 animate-spin" />
                ) : effectiveIcon ? (
                  <img src={effectiveIcon} alt="" className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                ) : (
                  <Globe className="w-7 h-7 text-white/40" />
                )}
              </div>
              {/* 刷新按钮（auto 模式） */}
              {iconSource === 'auto' && (
                <button
                  type="button"
                  onClick={handleRefreshIcon}
                  disabled={fetching || !url.trim()}
                  className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-[rgba(30,30,45,0.95)] border border-white/20 flex items-center justify-center shadow-sm disabled:opacity-30 hover:bg-white/10 transition-colors"
                  title="重新获取图标"
                >
                  <RefreshCw className="w-2.5 h-2.5 text-white/70" />
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
                className="h-9 text-sm bg-white/10 border-white/15 text-white placeholder:text-white/30 focus-visible:ring-primary/50"
              />
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onBlur={handleUrlBlur}
                placeholder="网站 URL（如 github.com）"
                className="h-9 text-sm bg-white/10 border-white/15 text-white placeholder:text-white/30 focus-visible:ring-primary/50"
              />
            </div>
          </div>

          {/* 图标来源选择器 */}
          <div className="space-y-2">
            <div className="flex gap-1 p-0.5 bg-white/8 rounded-xl">
              {iconSourceTabs.map(({ key, icon, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setIconSource(key)}
                  className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 ${
                    iconSource === key
                      ? 'bg-white/20 text-white shadow-sm'
                      : 'text-white/40 hover:text-white/70'
                  }`}
                >
                  {icon}{label}
                </button>
              ))}
            </div>

            {/* 来源说明/输入 */}
            {iconSource === 'auto' && (
              <p className="text-xs px-1 text-white/40">
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
                className="h-9 text-sm bg-white/10 border-white/15 text-white placeholder:text-white/30 focus-visible:ring-primary/50"
              />
            )}
            {iconSource === 'local' && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center gap-2 px-3 h-9 rounded-xl border border-dashed border-white/20 text-sm text-white/40 hover:bg-white/8 transition-colors"
              >
                <Upload className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{localIconData ? '已上传（点击更换）' : '点击选择本地图片'}</span>
              </button>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
          </div>
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center gap-2 px-5 py-3 border-t border-white/8">
          {isEdit && onDelete && (
            <Button size="sm" variant="destructive" onClick={handleDelete} className="gap-1">
              <Trash2 className="w-3.5 h-3.5" />删除
            </Button>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 rounded-xl text-sm text-white/60 hover:bg-white/10 transition-colors"
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
  );
};

export default AddEditDialog;
