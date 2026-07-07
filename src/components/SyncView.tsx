import React, { useState, useCallback, useEffect } from 'react';
import { useDesktop } from '@/contexts/DesktopContext';
import { loadSyncConfig, saveSyncConfig, clearSyncConfig } from '@/lib/storage';
import { verifyToken, uploadToGithub, downloadFromGithub } from '@/lib/github';
import type { SyncConfig } from '@/types';
import {
  Upload, Download, LogOut, Loader2, CheckCircle2, AlertCircle, Github, X, CloudUpload, CloudDownload,
} from 'lucide-react';
import { toast } from 'sonner';

interface SyncViewProps {
  open: boolean;
  onClose: () => void;
}

const INTERVAL_OPTIONS: { value: SyncConfig['syncInterval']; label: string }[] = [
  { value: 'manual', label: '手动同步' },
  { value: '1d',     label: '每1天' },
  { value: '7d',     label: '每7天' },
  { value: '30d',    label: '每30天' },
];

const DEFAULT_CONFIG: SyncConfig = {
  token: '', owner: '', repo: '', branch: 'main',
  path: 'ios-desktop.json', fileName: 'desktop_backup.json', syncInterval: 'manual',
};

const SyncView: React.FC<SyncViewProps> = ({ open, onClose }) => {
  const { data, importData } = useDesktop();
  const [config, setConfig] = useState<SyncConfig>(DEFAULT_CONFIG);
  const [verifying, setVerifying] = useState(false);
  const [syncing, setSyncing] = useState<'upload' | 'download' | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  useEffect(() => {
    if (open) {
      const saved = loadSyncConfig();
      if (saved) { setConfig(saved); setLoggedIn(!!saved.token && !!saved.owner); }
      else setConfig(DEFAULT_CONFIG);
      setStatusMsg(null);
    }
  }, [open]);

  const saveConfig = useCallback((next: SyncConfig) => {
    setConfig(next);
    if (loggedIn) saveSyncConfig(next);
  }, [loggedIn]);

  const handleVerify = useCallback(async () => {
    if (!config.token.trim()) { toast.error('请输入 GitHub Token'); return; }
    setVerifying(true); setStatusMsg(null);
    try {
      const user = await verifyToken(config.token.trim());
      if (user) {
        const next = { ...config, owner: user.login };
        setConfig(next); setLoggedIn(true); saveSyncConfig(next);
        toast.success(`已连接：${user.login}`);
      } else {
        setStatusMsg({ type: 'error', msg: 'Token 无效，请检查后重试' });
        toast.error('Token 无效');
      }
    } catch {
      setStatusMsg({ type: 'error', msg: '验证失败，请检查网络' });
    } finally { setVerifying(false); }
  }, [config]);

  const handleUpload = useCallback(async () => {
    if (!config.repo.trim()) { toast.error('请填写仓库名称'); return; }
    setSyncing('upload'); setStatusMsg(null);
    try {
      const syncCfg = { ...config, path: config.fileName || 'desktop_backup.json' };
      const result = await uploadToGithub(syncCfg, data);
      setStatusMsg({ type: result.ok ? 'success' : 'error', msg: result.message });
      if (result.ok) {
        const next = { ...config, lastSyncAt: new Date().toISOString() };
        saveConfig(next); saveSyncConfig(next);
        toast.success('已上传到云端');
      } else { toast.error(result.message); }
    } catch { setStatusMsg({ type: 'error', msg: '上传失败，请检查网络' }); }
    finally { setSyncing(null); }
  }, [config, data, saveConfig]);

  const handleDownload = useCallback(async () => {
    if (!config.repo.trim()) { toast.error('请填写仓库名称'); return; }
    setSyncing('download'); setStatusMsg(null);
    try {
      const syncCfg = { ...config, path: config.fileName || 'desktop_backup.json' };
      const result = await downloadFromGithub(syncCfg);
      setStatusMsg({ type: result.ok ? 'success' : 'error', msg: result.message });
      if (result.ok && result.data) {
        importData(result.data);
        const next = { ...config, lastSyncAt: new Date().toISOString() };
        saveConfig(next); saveSyncConfig(next);
        toast.success('已从云端恢复');
      } else { toast.error(result.message); }
    } catch { setStatusMsg({ type: 'error', msg: '下载失败，请检查网络' }); }
    finally { setSyncing(null); }
  }, [config, importData, saveConfig]);

  const handleLogout = useCallback(() => {
    clearSyncConfig(); setConfig(DEFAULT_CONFIG); setLoggedIn(false); setStatusMsg(null);
    toast.success('已断开连接');
  }, []);

  const formatDate = (iso?: string) => {
    if (!iso) return null;
    return new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const nextSyncLabel = () => {
    if (!config.lastSyncAt || config.syncInterval === 'manual') return null;
    const days = config.syncInterval === '1d' ? 1 : config.syncInterval === '7d' ? 7 : 30;
    const next = new Date(config.lastSyncAt);
    next.setDate(next.getDate() + days);
    const diffMs = next.getTime() - Date.now();
    if (diffMs < 0) return '待同步';
    const diffDays = Math.ceil(diffMs / 86400000);
    return `${diffDays} 天后`;
  };

  if (!open) return null;

  const fieldCls = 'w-full rounded-xl bg-white/10 border border-white/10 px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-primary/60';

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-t-3xl bg-[rgba(20,20,30,0.95)] backdrop-blur-2xl border-t border-white/10 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 拖拽条 */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        <div className="px-5 py-4 space-y-4 max-h-[85vh] overflow-y-auto">
          {/* 头部 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                <Github className="w-4 h-4 text-emerald-400" />
              </div>
              <h2 className="text-base font-semibold text-white">云同步设置</h2>
            </div>
            <button type="button" onClick={onClose} className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors">
              <X className="w-4 h-4 text-white/60" />
            </button>
          </div>

          {/* 已配置状态 */}
          {loggedIn && config.owner && (
            <div className="flex items-center gap-3 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 px-4 py-3">
              <div className="w-9 h-9 rounded-full bg-emerald-500/30 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-emerald-300">已配置同步</p>
                <p className="text-xs text-emerald-400/70 truncate">用户: {config.owner} | 仓库: {config.repo || '未选择'}</p>
              </div>
              <button type="button" onClick={handleLogout} className="shrink-0 flex items-center gap-1 text-xs text-white/40 hover:text-white/70 transition-colors">
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Token */}
          <div className="space-y-1.5">
            <label className="text-sm text-white/60">GitHub 个人访问令牌 (Token)</label>
            <input
              type="password"
              value={config.token}
              onChange={(e) => setConfig((p) => ({ ...p, token: e.target.value }))}
              placeholder="ghp_xxxxxxxxxxxx"
              className={fieldCls}
            />
            {!loggedIn && (
              <button
                type="button"
                onClick={handleVerify}
                disabled={verifying}
                className="w-full mt-2 rounded-xl bg-primary py-2.5 text-sm font-medium text-white flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Github className="w-4 h-4" />}
                验证并连接
              </button>
            )}
          </div>

          {/* 仓库名称 */}
          <div className="space-y-1.5">
            <label className="text-sm text-white/60">仓库名称 (例如: my-desktop-data)</label>
            <input
              value={config.repo}
              onChange={(e) => saveConfig({ ...config, repo: e.target.value })}
              placeholder="my-desktop-data"
              className={fieldCls}
            />
          </div>

          {/* 数据文件名 */}
          <div className="space-y-1.5">
            <label className="text-sm text-white/60">数据文件名</label>
            <input
              value={config.fileName}
              onChange={(e) => saveConfig({ ...config, fileName: e.target.value })}
              placeholder="desktop_backup.json"
              className={fieldCls}
            />
          </div>

          {/* 自动同步间隔 */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-white/60">自动同步间隔</span>
            <select
              value={config.syncInterval}
              onChange={(e) => saveConfig({ ...config, syncInterval: e.target.value as SyncConfig['syncInterval'] })}
              className="rounded-xl bg-white/10 border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/60"
            >
              {INTERVAL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} className="bg-[#1a1a2e]">{o.label}</option>
              ))}
            </select>
          </div>

          {/* 状态提示 */}
          {statusMsg && (
            <div className={`flex items-center gap-2 rounded-xl p-3 text-sm ${statusMsg.type === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
              {statusMsg.type === 'success'
                ? <CheckCircle2 className="w-4 h-4 shrink-0" />
                : <AlertCircle className="w-4 h-4 shrink-0" />}
              <span>{statusMsg.msg}</span>
            </div>
          )}

          {/* 分割线 */}
          <div className="h-px bg-white/10" />

          {/* 操作按钮 */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handleUpload}
              disabled={!!syncing || !loggedIn}
              className="flex items-center justify-center gap-2 rounded-2xl py-3.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium transition-colors disabled:opacity-40"
            >
              {syncing === 'upload' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudUpload className="w-4 h-4" />}
              上传到云端
            </button>
            <button
              type="button"
              onClick={handleDownload}
              disabled={!!syncing || !loggedIn}
              className="flex items-center justify-center gap-2 rounded-2xl py-3.5 bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium transition-colors disabled:opacity-40"
            >
              {syncing === 'download' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudDownload className="w-4 h-4" />}
              从云端恢复
            </button>
          </div>

          {/* 同步时间信息 */}
          {config.lastSyncAt && (
            <div className="text-center space-y-0.5 pb-2">
              <p className="text-xs text-white/30">上次同步: {formatDate(config.lastSyncAt)}</p>
              {nextSyncLabel() && <p className="text-xs text-white/20">预计下次同步: {nextSyncLabel()}</p>}
            </div>
          )}
        </div>
        <div className="pb-8" />
      </div>
    </div>
  );
};

export default SyncView;