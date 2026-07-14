import React, { useState, useCallback, useEffect } from 'react';
import { useDesktop } from '@/contexts/DesktopContext';
import { loadSyncConfig, saveSyncConfig, clearSyncConfig, loadPrivacyVault, savePrivacyVault } from '@/lib/storage';
import { verifyToken, ensureRepo, uploadToGithub, downloadFromGithub } from '@/lib/github';
import type { SyncConfig } from '@/types';
import {
  LogOut, Loader2, CheckCircle2, AlertCircle, Github, X,
  CloudUpload, CloudDownload, RefreshCw, ToggleLeft, ToggleRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { getPanelTheme } from '@/lib/panelTheme';

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
};

const SyncView: React.FC<SyncViewProps> = ({ open, onClose }) => {
  const { data, importData, settings } = useDesktop();
  const isNeu = settings.style === 'neumorphism';
  const t = getPanelTheme(isNeu);

  const [config, setConfig] = useState<SyncConfig>(DEFAULT_CONFIG);
  const [tokenInput, setTokenInput] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState<'upload' | 'download' | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  useEffect(() => {
    if (open) {
      const saved = loadSyncConfig();
      if (saved?.token && saved?.owner) {
        setConfig(saved);
        setTokenInput(saved.token);
        setLoggedIn(true);
      } else {
        setConfig(DEFAULT_CONFIG);
        setTokenInput(saved?.token ?? '');
        setLoggedIn(false);
      }
      setStatusMsg(null);
    }
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
      const next: SyncConfig = {
        ...DEFAULT_CONFIG, token: tok, owner: user.login,
        repo: DEFAULT_REPO, path: DEFAULT_FILE, fileName: DEFAULT_FILE,
      };
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
  }, [tokenInput]);

  const handleAutoSyncToggle = useCallback(() => {
    const next = { ...config, autoSync: !config.autoSync };
    setConfig(next);
    saveSyncConfig(next);
    toast.success(next.autoSync ? '已开启自动同步' : '已关闭自动同步');
  }, [config]);

  const handleUpload = useCallback(async () => {
    setSyncing('upload'); setStatusMsg(null);
    try {
      const syncCfg = { ...config, path: DEFAULT_FILE };
      // 上传时携带加密 vault（包含密码和隐私数据）
      const vault = loadPrivacyVault();
      const uploadData = { ...data, privacyVault: vault ?? undefined };
      const result = await uploadToGithub(syncCfg, uploadData);
      setStatusMsg({ type: result.ok ? 'success' : 'error', msg: result.message });
      if (result.ok) {
        const next = { ...config, lastSyncAt: new Date().toISOString() };
        setConfig(next); saveSyncConfig(next);
        toast.success(vault ? '已上传到云端（含加密隐私数据）' : '已上传到云端');
      } else { toast.error(result.message); }
    } catch { setStatusMsg({ type: 'error', msg: '上传失败，请检查网络' }); }
    finally { setSyncing(null); }
  }, [config, data]);

  const handleDownload = useCallback(async () => {
    setSyncing('download'); setStatusMsg(null);
    try {
      const syncCfg = { ...config, path: DEFAULT_FILE };
      const result = await downloadFromGithub(syncCfg);
      setStatusMsg({ type: result.ok ? 'success' : 'error', msg: result.message });
      if (result.ok && result.data) {
        importData(result.data);
        // 恢复加密 vault（隐私数据需重新输入密码才能解锁）
        if (result.data.privacyVault) {
          savePrivacyVault(result.data.privacyVault);
        }
        const next = { ...config, lastSyncAt: new Date().toISOString() };
        setConfig(next); saveSyncConfig(next);
        toast.success(result.data.privacyVault ? '已从云端恢复（隐私数据需重新解锁）' : '已从云端恢复');
      } else { toast.error(result.message); }
    } catch { setStatusMsg({ type: 'error', msg: '下载失败，请检查网络' }); }
    finally { setSyncing(null); }
  }, [config, importData]);

  const handleLogout = useCallback(() => {
    clearSyncConfig(); setConfig(DEFAULT_CONFIG); setTokenInput('');
    setLoggedIn(false); setStatusMsg(null);
    toast.success('已断开连接');
  }, []);

  const formatDate = (iso?: string) => {
    if (!iso) return null;
    return new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-x-0 top-0 h-[100dvh] z-[80] flex items-end justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className={`w-full max-w-lg rounded-t-3xl pb-[env(safe-area-inset-bottom,0px)] ${t.sheetBg} ${t.sheetBorder} animate-slide-up`}
        style={isNeu ? { boxShadow: '0 -8px 32px rgba(0,0,0,0.08), 0 -2px 8px rgba(0,0,0,0.04)' } : t.sheetStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 拖拽条 */}
        <div className="flex justify-center pt-3 pb-1">
          <div className={`w-10 h-1 rounded-full ${t.handle}`} />
        </div>

        <div className="px-5 py-4 space-y-4 max-h-[85vh] overflow-y-auto">
          {/* 头部 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                <Github className="w-4 h-4 text-emerald-500" />
              </div>
              <div>
                <h2 className={`text-base font-semibold ${t.textPrimary}`}>云同步</h2>
                <p className={`text-xs ${t.textDim} opacity-70`}>基于 GitHub 存储桌面数据</p>
              </div>
            </div>
            <button
              type="button" onClick={onClose}
              className={`w-8 h-8 rounded-full ${t.closeBtn} ${t.closeBtnHover} flex items-center justify-center transition-colors`}
            >
              <X className={`w-4 h-4 ${t.textMuted}`} />
            </button>
          </div>

          {/* ── 未登录状态 ── */}
          {!loggedIn && (
            <div className="space-y-3">
              {/* 说明卡片 */}
              <div className={`rounded-2xl ${isNeu ? 'bg-white/60 border border-gray-200' : 'bg-white/5 border border-white/10'} p-4 space-y-2`}>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-emerald-500/20 flex items-center justify-center shrink-0">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  </div>
                  <span className={`text-xs font-medium ${t.textPrimary}`}>输入 Token 即可完成所有配置</span>
                </div>
                <ul className={`text-xs ${t.textDim} space-y-1 ml-8`}>
                  <li>✦ 自动验证账号</li>
                  <li>✦ 自动创建私有备份仓库</li>
                  <li>✦ 即刻开始同步桌面数据</li>
                </ul>
              </div>

              {/* Token 输入 */}
              <div className="space-y-1.5">
                <label className={t.labelCls}>GitHub 个人访问令牌</label>
                <input
                  type="text"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
                  autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                  placeholder="ghp_xxxxxxxxxxxx"
                  className={t.inputCls}
                />
                <p className={`text-xs ${t.textDim} opacity-60`}>
                  需要 repo 权限 · <span className="underline opacity-80">github.com/settings/tokens</span>
                </p>
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
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${t.textPrimary}`}>自动同步</p>
                  <p className={`text-xs ${t.textDim} opacity-70`}>数据变更后自动上传到云端</p>
                </div>
                <button type="button" onClick={handleAutoSyncToggle} className="shrink-0 ml-3 transition-transform active:scale-95">
                  {config.autoSync
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

              <div className={`h-px ${t.divider}`} />

              {/* 操作按钮 */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button" onClick={handleUpload} disabled={!!syncing}
                  className="flex items-center justify-center gap-2 rounded-2xl py-3.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium transition-colors disabled:opacity-40"
                >
                  {syncing === 'upload'
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <CloudUpload className="w-4 h-4" />}
                  上传备份
                </button>
                <button
                  type="button" onClick={handleDownload} disabled={!!syncing}
                  className="flex items-center justify-center gap-2 rounded-2xl py-3.5 bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium transition-colors disabled:opacity-40"
                >
                  {syncing === 'download'
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <CloudDownload className="w-4 h-4" />}
                  恢复数据
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
        <div className="pb-8" />
      </div>
    </div>
  );
};

export default SyncView;

