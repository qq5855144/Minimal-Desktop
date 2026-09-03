import {
  AlertCircle,
  CheckCircle2,
  CloudDownload,
  CloudUpload,
  Github,
  Loader2,
  LogOut,
  RefreshCw,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useDesktop } from '@/contexts/DesktopContext';
import { type DesktopDiffSummary, summarizeDesktopDiff } from '@/lib/desktopDiff';
import { AUTO_SYNC_REQUEST_EVENT } from '@/lib/autoSyncScheduler';
import { downloadFromGithub, ensureRepo, getBranchHead, verifyToken } from '@/lib/github';
import { getPanelTheme } from '@/lib/panelTheme';
import {
  clearPrivacyVault,
  clearSyncConfig,
  DEFAULT_BG_IMAGE,
  loadSyncConfig,
  SYNC_CONFIG_CHANGED_EVENT,
  savePrivacyVault,
  saveSyncConfig,
  updateSyncConfig,
} from '@/lib/storage';
import { uploadSyncSnapshot } from '@/lib/syncCoordinator';
import { buildSyncSnapshot, SYNC_DEFAULT_WALLPAPER_MARKER } from '@/lib/syncSnapshot';
import { preserveSyncStateForReconnect } from '@/lib/syncTarget';
import { clearVideoDB, saveVideoDB } from '@/lib/videoStorage';
import { clearWallpaperDB, saveWallpaperDB } from '@/lib/wallpaperStorage';
import type { DesktopBackup, SyncConfig } from '@/types';
import SystemSheet from './SystemSheet';

interface SyncViewProps {
  open: boolean;
  onClose: () => void;
}

const DEFAULT_REPO = 'minimal-desktop-data';
const DEFAULT_FILE = 'desktop_backup.json';

const DEFAULT_CONFIG: SyncConfig = {
  token: '', owner: '', repo: DEFAULT_REPO, branch: 'main',
  path: DEFAULT_FILE, fileName: DEFAULT_FILE,
  syncInterval: 'manual', autoSync: false,
  syncStatus: 'idle',
  rememberToken: false,
};

interface PendingRestore {
  data: DesktopBackup;
  remoteHead?: string;
  backupBlobSha?: string;
  backgroundFile?: File;
  backgroundBlobSha?: string;
  summary: DesktopDiffSummary;
}

const SyncView: React.FC<SyncViewProps> = ({ open, onClose }) => {
  const { data, importData, resetPrivacyLock, settings, updateSettings } = useDesktop();
  const isNeu = settings.style === 'neumorphism';
  const t = getPanelTheme(isNeu);

  const [config, setConfig] = useState<SyncConfig>(DEFAULT_CONFIG);
  const [tokenInput, setTokenInput] = useState('');
  const [remember, setRemember] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState<'upload' | 'download' | 'restore' | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [pendingRestore, setPendingRestore] = useState<PendingRestore | null>(null);

  useEffect(() => {
    if (open) {
      const saved = loadSyncConfig();
      if (saved?.token && saved?.owner) {
        setConfig(saved);
        setTokenInput(saved.token);
        setRemember(!!saved.rememberToken);
        setLoggedIn(true);
      } else {
        // Token 默认仅保留当前会话；重新认证前仍保留非敏感的目标与同步基线。
        setConfig(saved ? { ...DEFAULT_CONFIG, ...saved } : DEFAULT_CONFIG);
        setTokenInput(saved?.token ?? '');
        setRemember(!!saved?.rememberToken);
        setLoggedIn(false);
      }
      setStatusMsg(null);
      setPendingRestore(null);
    }
  }, [open]);

  // 自动同步在面板打开期间更新基线/冲突状态时，立即刷新界面而不是保留旧闭包。
  useEffect(() => {
    if (!open) return;
    const refreshConfig = () => {
      const saved = loadSyncConfig();
      if (saved) setConfig(saved);
    };
    window.addEventListener(SYNC_CONFIG_CHANGED_EVENT, refreshConfig);
    window.addEventListener('storage', refreshConfig);
    return () => {
      window.removeEventListener(SYNC_CONFIG_CHANGED_EVENT, refreshConfig);
      window.removeEventListener('storage', refreshConfig);
    };
  }, [open]);

  // 一键连接：验证 Token + 自动创建仓库
  const handleConnect = useCallback(async () => {
    const tok = tokenInput.trim();
    if (!tok) { toast.error('请输入 GitHub Token'); return; }
    setConnecting(true); setStatusMsg(null);
    try {
      // 1. 验证 Token
      const user = await verifyToken(tok);
      if (!user) {
        setStatusMsg({ type: 'error', msg: 'Token 无效，请检查后重试' });
        toast.error('Token 无效');
        return;
      }
      // 2. 确保数据仓库存在（检查或自动创建）
      const repoResult = await ensureRepo(tok, user.login, DEFAULT_REPO);
      if (!repoResult.ok) {
        setStatusMsg({ type: 'error', msg: repoResult.message });
        toast.error(repoResult.message);
        return;
      }
      const branch = repoResult.branch || 'main';
      const connection: SyncConfig = {
        ...DEFAULT_CONFIG, token: tok, owner: user.login,
        repo: DEFAULT_REPO, branch, path: DEFAULT_FILE, fileName: DEFAULT_FILE,
        rememberToken: remember,
        // 新仓库没有远端备份，可直接以初始 HEAD 为基线；已有仓库必须先由上传逻辑
        // 确认备份文件不存在，或由用户下载确认后再建立基线。
        lastRemoteHead: repoResult.created
          ? await getBranchHead(tok, user.login, DEFAULT_REPO, branch) ?? undefined
          : undefined,
      };
      const next = repoResult.created
        ? connection
        : preserveSyncStateForReconnect(connection, loadSyncConfig());
      setConfig(next);
      setLoggedIn(true);
      saveSyncConfig(next);
      const msg = repoResult.created ? `已连接 ${user.login}，数据仓库已自动创建` : `已连接 ${user.login}`;
      toast.success(msg);
      setStatusMsg({ type: 'success', msg });
    } catch {
      setStatusMsg({ type: 'error', msg: '连接失败，请检查网络' });
      toast.error('连接失败，请检查网络');
    } finally { setConnecting(false); }
  }, [tokenInput, remember]);

  const handleAutoSyncToggle = useCallback(() => {
    const autoSync = !config.autoSync;
    const next = updateSyncConfig({
      autoSync,
      syncStatus: autoSync ? 'pending' : 'idle',
      lastSyncError: undefined,
    }) ?? {
      ...config,
      autoSync,
      syncStatus: autoSync ? 'pending' as const : 'idle' as const,
      lastSyncError: undefined,
    };
    setConfig(next);
    toast.success(next.autoSync ? '已开启自动同步' : '已关闭自动同步');
    if (next.autoSync) window.dispatchEvent(new Event(AUTO_SYNC_REQUEST_EVENT));
  }, [config]);

  const performUpload = useCallback(async () => {
    if (!config.token) {
      setStatusMsg({ type: 'error', msg: '登录已过期，请重新连接' });
      toast.error('登录已过期，请重新连接');
      return;
    }
    setSyncing('upload'); setStatusMsg(null);
    try {
      const syncCfg = { ...config, path: DEFAULT_FILE };
      const uploadData = await buildSyncSnapshot(data, settings);
      const result = await uploadSyncSnapshot(syncCfg, uploadData, {
        source: 'manual',
      });
      setConfig(result.config);
      setStatusMsg({ type: result.ok ? 'success' : 'error', msg: result.message });
      if (result.ok) {
        const included = [
          uploadData.data.privacyVault ? '加密隐私数据' : null,
          uploadData.data.background ? '壁纸' : null,
        ].filter(Boolean).join('、');
        const prefix = result.unchanged ? '云端已是最新数据' : '已同步到云端';
        toast.success(included && !result.unchanged ? `${prefix}（含${included}）` : prefix);
      } else { toast.error(result.message); }
    } catch (error) {
      const message = error instanceof Error ? error.message : '上传失败，请检查网络';
      setStatusMsg({ type: 'error', msg: message });
      toast.error(message);
    }
    finally { setSyncing(null); }
  }, [config, data, settings]);

  const handleUpload = useCallback(() => performUpload(), [performUpload]);

  const handleDownload = useCallback(async () => {
    if (!config.token) {
      setStatusMsg({ type: 'error', msg: '登录已过期，请重新连接' });
      toast.error('登录已过期，请重新连接');
      return;
    }
    setSyncing('download'); setStatusMsg(null);
    try {
      const syncCfg = { ...config, path: DEFAULT_FILE };
      const result = await downloadFromGithub(syncCfg);
      if (result.ok && result.data) {
        setPendingRestore({
          data: result.data,
          remoteHead: result.remoteHead,
          backupBlobSha: result.backupBlobSha,
          backgroundFile: result.backgroundFile,
          backgroundBlobSha: result.backgroundBlobSha,
          summary: summarizeDesktopDiff(data, result.data),
        });
        setStatusMsg({ type: 'success', msg: '已读取云端备份，请确认差异后恢复' });
        toast.success('云端备份已读取');
      } else {
        setStatusMsg({ type: 'error', msg: result.message });
        toast.error(result.message);
      }
    } catch { setStatusMsg({ type: 'error', msg: '下载失败，请检查网络' }); }
    finally { setSyncing(null); }
  }, [config, data]);

  const handleConfirmRestore = useCallback(async () => {
    if (!pendingRestore) return;
    setSyncing('restore');
    let restoredBackgroundUrl: string | null = null;
    try {
      const rawBackupSettings = pendingRestore.data.settings;
      const backupSettings = rawBackupSettings
        ? {
            ...rawBackupSettings,
            bgImage: rawBackupSettings.bgImage === SYNC_DEFAULT_WALLPAPER_MARKER
              ? DEFAULT_BG_IMAGE
              : rawBackupSettings.bgImage,
          }
        : undefined;
      let restoredSettings = backupSettings;
      const background = pendingRestore.data.background;
      if (background) {
        if (!backupSettings || !pendingRestore.backgroundFile) {
          throw new Error('云端壁纸文件不完整，已取消恢复');
        }
        restoredBackgroundUrl = URL.createObjectURL(pendingRestore.backgroundFile);
        restoredSettings = background.kind === 'image'
          ? {
              ...backupSettings,
              bgType: 'image',
              bgImage: restoredBackgroundUrl,
              bgVideo: undefined,
            }
          : {
              ...backupSettings,
              bgType: 'video',
              bgVideo: restoredBackgroundUrl,
              bgImage: undefined,
            };
      }

      // 先停止所有旧密钥写入，再以备份网格设置导入，避免布局被当前设备设置扭曲。
      resetPrivacyLock();
      if (!importData(pendingRestore.data, {
        recordHistory: false,
        settings: restoredSettings,
      })) {
        if (restoredBackgroundUrl) URL.revokeObjectURL(restoredBackgroundUrl);
        setStatusMsg({ type: 'error', msg: '云端数据无法适配备份中的桌面布局' });
        toast.error('云端数据布局无效，未覆盖本地桌面');
        return;
      }

      let backgroundSaved = true;
      if (background && pendingRestore.backgroundFile) {
        try {
          if (background.kind === 'image') {
            await saveWallpaperDB(pendingRestore.backgroundFile);
            await clearVideoDB();
          } else {
            await saveVideoDB(pendingRestore.backgroundFile);
            await clearWallpaperDB();
          }
        } catch {
          backgroundSaved = false;
          updateSettings({ bgType: 'default', bgImage: undefined, bgVideo: undefined });
          if (restoredBackgroundUrl) URL.revokeObjectURL(restoredBackgroundUrl);
        }
      } else if (backupSettings) {
        await Promise.all([clearWallpaperDB(), clearVideoDB()]);
      }

      if (pendingRestore.data.privacyVault) savePrivacyVault(pendingRestore.data.privacyVault);
      else clearPrivacyVault();
      const next = updateSyncConfig({
        lastSyncAt: new Date().toISOString(),
        lastRemoteHead: pendingRestore.remoteHead ?? config.lastRemoteHead,
        lastBackupBlobSha: pendingRestore.backupBlobSha,
        lastBackgroundSha256: pendingRestore.data.background?.sha256,
        lastBackgroundBlobSha: pendingRestore.backgroundBlobSha,
        syncStatus: 'synced',
        lastSyncError: undefined,
      }) ?? {
        ...config,
        lastSyncAt: new Date().toISOString(),
        lastRemoteHead: pendingRestore.remoteHead ?? config.lastRemoteHead,
        lastBackupBlobSha: pendingRestore.backupBlobSha,
        lastBackgroundSha256: pendingRestore.data.background?.sha256,
        lastBackgroundBlobSha: pendingRestore.backgroundBlobSha,
        syncStatus: 'synced',
        lastSyncError: undefined,
      };
      setConfig(next);
      const oldBackgroundUrls = [settings.bgImage, settings.bgVideo].filter(
        (source): source is string => Boolean(source?.startsWith('blob:')),
      );
      setTimeout(() => oldBackgroundUrls.forEach((source) => URL.revokeObjectURL(source)), 0);
      setPendingRestore(null);
      const message = backgroundSaved ? '云端备份已恢复' : '桌面已恢复，但壁纸保存失败，已回退默认背景';
      setStatusMsg({ type: 'success', msg: message });
      if (backgroundSaved) {
        toast.success(pendingRestore.data.privacyVault
          ? '已从云端恢复（隐私数据需重新解锁）'
          : '已从云端恢复');
      } else {
        toast.error(message);
      }
    } catch (error) {
      if (restoredBackgroundUrl) URL.revokeObjectURL(restoredBackgroundUrl);
      const message = error instanceof Error ? error.message : '恢复失败，请重试';
      setStatusMsg({ type: 'error', msg: message });
      toast.error(message);
    } finally {
      setSyncing(null);
    }
  }, [config, importData, pendingRestore, resetPrivacyLock, settings.bgImage, settings.bgVideo, updateSettings]);

  const handleLogout = useCallback(() => {
    clearSyncConfig(); setConfig(DEFAULT_CONFIG); setTokenInput(''); setRemember(false);
    setLoggedIn(false); setStatusMsg(null); setPendingRestore(null);
    toast.success('已断开连接');
  }, []);

  const formatDate = (iso?: string) => {
    if (!iso) return null;
    return new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const autoSyncStatusText = (() => {
    if (!config.autoSync) return '已关闭，仍可手动同步';
    switch (config.syncStatus) {
      case 'pending': return '已检测到修改，5 秒后自动保存';
      case 'syncing': return '正在保存最新数据…';
      case 'retrying': return '暂未完成，后台将自动重试';
      case 'synced': return '本地与云端已同步';
      default: return '本地修改会在 5 秒后自动保存';
    }
  })();

  if (!open) return null;

  return (
    <SystemSheet
      open={open}
      isNeu={isNeu}
      title="云同步"
      onClose={onClose}
      bodyClassName="overflow-y-auto px-4 py-3"
    >
      <div className="space-y-3">

          {/* ── 未登录状态 ── */}
          {!loggedIn && (
            <div className="space-y-3">
              {/* Token 输入 */}
              <div className="space-y-1.5">
                <label className={t.labelCls}>GitHub 个人访问令牌</label>
                <input
                  type="text"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
                  autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                  placeholder="github_pat_xxxxxxxxxxxx"
                  className={t.inputCls}
                />
              </div>

              {/* 保持登录 */}
              <div className={`flex items-center justify-between rounded-2xl ${isNeu ? 'bg-white/60 border border-gray-200' : 'bg-white/5 border border-white/10'} px-4 py-3`}>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${t.textPrimary}`}>保持登录</p>
                  <p className={`text-xs ${t.textDim} opacity-70`}>关闭浏览器后仍保持连接</p>
                </div>
                <button type="button" onClick={() => setRemember(!remember)} className="shrink-0 ml-3 transition-transform active:scale-95">
                  {remember
                    ? <ToggleRight className="w-9 h-9 text-emerald-500" />
                    : <ToggleLeft className={`w-9 h-9 ${t.textDim} opacity-40`} />}
                </button>
              </div>

              {/* 状态提示 */}
              {statusMsg && (
                <div className={`flex items-center gap-2 rounded-xl p-3 text-sm ${statusMsg.type === 'success' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-500'}`}>
                  {statusMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                  <span>{statusMsg.msg}</span>
                </div>
              )}

              <button
                type="button" onClick={handleConnect} disabled={connecting}
                className="w-full rounded-2xl bg-emerald-500 hover:bg-emerald-600 py-3.5 text-sm font-semibold text-white flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
              >
                {connecting
                  ? <><Loader2 className="w-4 h-4 animate-spin" />连接中…</>
                  : <><Github className="w-4 h-4" />一键连接</>}
              </button>
            </div>
          )}

          {/* ── 已登录状态 ── */}
          {loggedIn && (
            <div className="space-y-4">
              {/* 用户信息卡 */}
              <div className={`flex items-center gap-3 rounded-2xl ${isNeu ? 'bg-emerald-50 border border-emerald-200' : 'bg-emerald-500/10 border border-emerald-500/20'} px-4 py-3`}>
                <div className="w-9 h-9 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
                  <Github className="w-5 h-5 text-emerald-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold text-emerald-600`}>{config.owner}</p>
                  <p className={`text-xs text-emerald-500/70 truncate`}>{config.owner}/{config.repo}</p>
                </div>
                <button type="button" onClick={handleLogout}
                  className="shrink-0 flex items-center gap-1 text-xs text-emerald-500/60 hover:text-emerald-500 transition-colors"
                  title="断开连接">
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* 自动同步开关 */}
              <div className={`flex items-center justify-between rounded-2xl ${isNeu ? 'bg-white/60 border border-gray-200' : 'bg-white/5 border border-white/10'} px-4 py-3`}>
                <div className="flex w-full items-center justify-between">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${config.syncStatus === 'retrying' ? 'bg-amber-500/12 text-amber-500' : 'bg-emerald-500/12 text-emerald-500'}`}>
                      {config.syncStatus === 'syncing'
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : config.syncStatus === 'synced'
                          ? <CheckCircle2 className="h-4 w-4" />
                          : <RefreshCw className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0">
                      <p className={`text-sm font-medium ${t.textPrimary}`}>自动同步</p>
                      <p className={`text-xs ${config.syncStatus === 'retrying' ? 'text-amber-500' : `${t.textDim} opacity-70`}`}>
                        {autoSyncStatusText}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-pressed={config.autoSync}
                    aria-label={config.autoSync ? '关闭自动同步' : '开启自动同步'}
                    onClick={handleAutoSyncToggle}
                    className="shrink-0 ml-3 transition-transform active:scale-95"
                  >
                    {config.autoSync
                      ? <ToggleRight className="w-9 h-9 text-emerald-500" />
                      : <ToggleLeft className={`w-9 h-9 ${t.textDim} opacity-40`} />}
                  </button>
                </div>
              </div>

              {config.lastSyncError && (config.syncStatus === 'retrying' || config.syncStatus === 'error') && (
                <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-600">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium">{config.syncStatus === 'retrying' ? '同步将在后台重试' : '同步未完成'}</p>
                    <p className="mt-0.5 break-words text-xs opacity-80">{config.lastSyncError}</p>
                  </div>
                </div>
              )}

              {/* 状态提示 */}
              {statusMsg && (
                <div className={`flex items-center gap-2 rounded-xl p-3 text-sm ${statusMsg.type === 'success' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-500'}`}>
                  {statusMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                  <span>{statusMsg.msg}</span>
                </div>
              )}

              {pendingRestore && (
                <div className={`rounded-2xl p-4 space-y-3 ${isNeu ? 'bg-indigo-50 border border-indigo-200' : 'bg-indigo-500/10 border border-indigo-400/20'}`}>
                  <div>
                    <p className={`text-sm font-semibold ${t.textPrimary}`}>恢复前差异预览</p>
                    <p className={`text-xs mt-0.5 ${t.textDim}`}>确认后才会覆盖当前桌面；布局会自动适配当前网格。</p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className={`rounded-xl p-2.5 ${t.itemBg}`}>
                      <p className={t.textDim}>桌面页</p>
                      <p className={`font-semibold mt-0.5 ${t.textPrimary}`}>{pendingRestore.summary.beforePages} → {pendingRestore.summary.afterPages}</p>
                    </div>
                    <div className={`rounded-xl p-2.5 ${t.itemBg}`}>
                      <p className={t.textDim}>桌面项目</p>
                      <p className={`font-semibold mt-0.5 ${t.textPrimary}`}>{pendingRestore.summary.beforeItems} → {pendingRestore.summary.afterItems}</p>
                    </div>
                  </div>

                  <div className={`grid grid-cols-4 gap-1 text-center text-xs ${t.textMuted}`}>
                    <div><span className="block font-semibold text-emerald-500">+{pendingRestore.summary.added}</span>新增</div>
                    <div><span className="block font-semibold text-red-400">-{pendingRestore.summary.removed}</span>删除</div>
                    <div><span className="block font-semibold text-indigo-400">{pendingRestore.summary.moved}</span>移动</div>
                    <div><span className="block font-semibold text-amber-500">{pendingRestore.summary.changed}</span>修改</div>
                  </div>

                  <div className={`text-xs rounded-xl px-3 py-2 ${pendingRestore.summary.hasPrivacyVault ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600'}`}>
                    {pendingRestore.summary.hasPrivacyVault
                      ? '✓ 此备份包含加密隐私桌面，可继续使用原密码解锁。'
                      : '⚠ 此备份不含隐私保险库；确认恢复会清除当前浏览器中的隐私保险库。'}
                  </div>

                  {pendingRestore.data.settings && (
                    <div className={`text-xs rounded-xl px-3 py-2 ${pendingRestore.data.background ? 'bg-emerald-500/10 text-emerald-600' : `${t.itemBg} ${t.textMuted}`}`}>
                      {pendingRestore.data.background
                        ? `✓ 包含外观设置与${pendingRestore.data.background.kind === 'image' ? '图片' : '视频'}壁纸。`
                        : '✓ 包含外观设置；远程链接壁纸会随设置恢复。'}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => { setPendingRestore(null); setStatusMsg(null); }}
                      disabled={syncing === 'restore'}
                      className={`flex-1 rounded-xl py-2.5 text-xs font-medium border ${t.itemBorder} ${t.itemBg} ${t.textMuted}`}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmRestore}
                      disabled={syncing === 'restore'}
                      className="flex-1 rounded-xl py-2.5 text-xs font-semibold bg-indigo-500 hover:bg-indigo-600 text-white transition-colors disabled:opacity-50"
                    >
                      {syncing === 'restore' ? '正在恢复…' : '确认恢复'}
                    </button>
                  </div>
                </div>
              )}

              <div className={`h-px ${t.divider}`} />

              {/* 操作按钮 */}
              <div className="grid grid-cols-1 gap-2 min-[390px]:grid-cols-2">
                <button
                  type="button" onClick={handleUpload} disabled={!!syncing || !!pendingRestore}
                  className="flex items-center justify-center gap-2 rounded-2xl py-3.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium transition-colors disabled:opacity-40"
                >
                  {syncing === 'upload'
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <CloudUpload className="w-4 h-4" />}
                  立即同步
                </button>
                <button
                  type="button" onClick={handleDownload} disabled={!!syncing || !!pendingRestore}
                  className="flex items-center justify-center gap-2 rounded-2xl py-3.5 bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium transition-colors disabled:opacity-40"
                >
                  {syncing === 'download'
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <CloudDownload className="w-4 h-4" />}
                  从云端恢复
                </button>
              </div>

              {/* 同步信息 */}
              {config.lastSyncAt && (
                <div className={`flex items-center justify-center gap-1.5 text-xs ${t.textDim} opacity-60 pb-1`}>
                  <RefreshCw className="w-3 h-3" />
                  <span>上次同步：{formatDate(config.lastSyncAt)}</span>
                </div>
              )}
            </div>
          )}
      </div>
    </SystemSheet>
  );
};

export default SyncView;
