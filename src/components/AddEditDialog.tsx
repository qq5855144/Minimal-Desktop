import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { DesktopItem } from '@/types';
import { getFaviconUrl, getDirectFaviconUrl, normalizeUrl } from '@/lib/favicon';
import { Upload, Globe, Trash2, Loader2, RefreshCw, Link, ImagePlus, Sparkles } from 'lucide-react';

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
  // 图标来源模式
  const [iconSource, setIconSource] = useState<IconSource>('auto');
  // 自动模式：从网站获取的 favicon
  const [autoFavicon, setAutoFavicon] = useState<string | undefined>();
  // 自动模式：favicon.im 失败后的直连备用
  const [autoFaviconFallback, setAutoFaviconFallback] = useState<string | undefined>();
  // URL 模式：用户手动填入图标 URL
  const [customIconUrl, setCustomIconUrl] = useState('');
  // 本地模式：本地上传 base64
  const [localIconData, setLocalIconData] = useState<string | undefined>();
  const [fetching, setFetching] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 计算当前实际使用的图标
  const effectiveIcon =
    iconSource === 'auto' ? autoFavicon :
    iconSource === 'url' ? (customIconUrl.trim() || undefined) :
    localIconData;

  // 重置表单
  useEffect(() => {
    if (!open) return;
    if (item) {
      setName(item.name);
      setUrl(item.url || '');
      // 编辑时：如果有 iconUrl 且以 data: 开头则是本地，否则先用 auto
      if (item.iconUrl?.startsWith('data:')) {
        setIconSource('local');
        setLocalIconData(item.iconUrl);
        setAutoFavicon(undefined);
        setCustomIconUrl('');
      } else if (item.iconUrl) {
        setIconSource('url');
        setCustomIconUrl(item.iconUrl);
        setAutoFavicon(undefined);
        setLocalIconData(undefined);
      } else {
        setIconSource('auto');
        if (item.url) {
          const norm = normalizeUrl(item.url);
          setAutoFavicon(getFaviconUrl(norm));
          setAutoFaviconFallback(getDirectFaviconUrl(norm));
        } else {
          setAutoFavicon(undefined);
          setAutoFaviconFallback(undefined);
        }
        setCustomIconUrl('');
        setLocalIconData(undefined);
      }
    } else {
      setName(''); setUrl('');
      setIconSource('auto'); setAutoFavicon(undefined);
      setAutoFaviconFallback(undefined);
      setCustomIconUrl(''); setLocalIconData(undefined);
    }
  }, [open, item]);

  // 自动获取 favicon + 网站名
  const fetchFavicon = useCallback(async (rawUrl: string, forceNameFetch = false) => {
    if (!rawUrl.trim()) return;
    const normalized = normalizeUrl(rawUrl);
    setFetching(true);
    try {
      setAutoFavicon(getFaviconUrl(normalized));
      setAutoFaviconFallback(getDirectFaviconUrl(normalized));
      if (forceNameFetch && !name.trim()) {
        try {
          const u = new URL(normalized);
          setName(u.hostname.replace(/^www\./, '').split('.')[0]);
        } catch { /* ignore */ }
      }
    } finally {
      setFetching(false);
    }
  }, [name]);

  const handleUrlBlur = useCallback(() => {
    if (iconSource === 'auto') fetchFavicon(url, true);
  }, [url, iconSource, fetchFavicon]);

  const handleRefreshIcon = useCallback(() => {
    fetchFavicon(url, false);
  }, [url, fetchFavicon]);

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

  const iconSourceTabs: { key: IconSource; icon: React.ReactNode; label: string }[] = [
    { key: 'auto', icon: <Sparkles className="w-3.5 h-3.5" />, label: '智能' },
    { key: 'url',  icon: <Link className="w-3.5 h-3.5" />,     label: 'URL' },
    { key: 'local',icon: <ImagePlus className="w-3.5 h-3.5" />, label: '本地' },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-sm rounded-3xl gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-0">
          <DialogTitle className="text-base">{isEdit ? '编辑应用' : '添加应用'}</DialogTitle>
        </DialogHeader>

        <div className="px-5 pt-4 pb-1 space-y-3">
          {/* ── 顶部：图标预览 + 名称/URL 输入 ── */}
          <div className="flex gap-3 items-start">
            {/* 图标预览 */}
            <div className="relative shrink-0">
              <div
                className="w-[60px] h-[60px] rounded-[22%] flex items-center justify-center overflow-hidden ios-icon-shadow bg-muted"
              >
                {effectiveIcon ? (
                  <img
                    src={effectiveIcon}
                    alt=""
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      // favicon.im 失败时回退到直连 favicon.ico
                      if (autoFaviconFallback && (e.target as HTMLImageElement).src !== autoFaviconFallback) {
                        (e.target as HTMLImageElement).src = autoFaviconFallback;
                      } else {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }
                    }}
                  />
                ) : (
                  <Globe className="w-7 h-7 text-white" />
                )}
              </div>
              {/* 刷新按钮 */}
              {iconSource === 'auto' && (
                <button
                  type="button"
                  onClick={handleRefreshIcon}
                  disabled={fetching || !url.trim()}
                  className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-background border border-border flex items-center justify-center shadow-sm disabled:opacity-40 hover:bg-muted transition-colors"
                  title="重新获取图标"
                >
                  {fetching
                    ? <Loader2 className="w-2.5 h-2.5 animate-spin text-muted-foreground" />
                    : <RefreshCw className="w-2.5 h-2.5 text-muted-foreground" />}
                </button>
              )}
            </div>

            {/* 名称 + URL */}
            <div className="flex-1 min-w-0 space-y-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="应用名称"
                maxLength={20}
                className="h-9 text-sm"
              />
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onBlur={handleUrlBlur}
                placeholder="网站 URL（如 github.com）"
                className="h-9 text-sm"
              />
            </div>
          </div>

          {/* ── 图标来源选择器 ── */}
          <div className="space-y-2">
            <div className="flex gap-1 p-0.5 bg-muted rounded-lg">
              {iconSourceTabs.map(({ key, icon, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setIconSource(key)}
                  className={`
                    flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-xs font-medium
                    transition-all duration-150
                    ${iconSource === key
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'}
                  `}
                >
                  {icon}{label}
                </button>
              ))}
            </div>

            {/* 图标来源内容区 */}
            {iconSource === 'auto' && (
              <p className="text-xs text-muted-foreground px-1">
                {autoFavicon ? '已从网站获取图标' : '输入网址后自动获取网站图标'}
              </p>
            )}
            {iconSource === 'url' && (
              <Input
                value={customIconUrl}
                onChange={(e) => setCustomIconUrl(e.target.value)}
                placeholder="图标图片 URL"
                className="h-9 text-sm"
              />
            )}
            {iconSource === 'local' && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center gap-2 px-3 h-9 rounded-lg border border-dashed border-border text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
              >
                <Upload className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{localIconData ? '已上传（点击更换）' : '点击选择本地图片'}</span>
              </button>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
          </div>


        </div>

        <div className="flex flex-row items-center gap-2 px-5 py-3 border-t border-border/50">
          {isEdit && onDelete && (
            <Button size="sm" variant="destructive" onClick={handleDelete} className="gap-1">
              <Trash2 className="w-3.5 h-3.5" />
              删除
            </Button>
          )}
          <div className="flex-1" />
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button size="sm" onClick={handleSubmit}>{isEdit ? '保存' : '添加'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AddEditDialog;
