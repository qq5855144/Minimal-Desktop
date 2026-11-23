import { Cloud, Download, ExternalLink, File, Loader2, RefreshCw, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import SystemSheet from '@/components/SystemSheet';
import { useDesktop } from '@/contexts/DesktopContext';
import {
  CLOUD_DRIVE_MAX_BYTES, CLOUD_DRIVE_REPO, type CloudDriveFile, type CloudDriveListing, type CloudDriveSession,
  connectCloudDrive, downloadCloudDriveFile, listCloudDrive, removeCloudDriveFile, uploadCloudDriveFile,
} from '@/lib/cloudDrive';
import { getPanelTheme } from '@/lib/panelTheme';
import { loadSyncConfig } from '@/lib/storage';

const ACCELERATION_KEY = 'minimal_desktop_drive_acceleration';

function isAccelerationEnabled(): boolean {
  try { return localStorage.getItem(ACCELERATION_KEY) === 'true'; } catch { return false; }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function getMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '操作失败，请重试';
}

function saveDownload(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export default function CloudDriveView({ onClose }: { onClose: () => void }) {
  const { settings } = useDesktop();
  const isNeu = settings.style === 'neumorphism';
  const t = getPanelTheme(isNeu);
  const [syncToken] = useState(() => loadSyncConfig()?.token ?? '');
  const [tokenInput, setTokenInput] = useState('');
  const [session, setSession] = useState<CloudDriveSession | null>(null);
  const [listing, setListing] = useState<CloudDriveListing | null>(null);
  const [accelerate, setAccelerate] = useState(isAccelerationEnabled);
  const [working, setWorking] = useState<string | null>(null);
  const [message, setMessage] = useState<{ error?: boolean; text: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CloudDriveFile | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  const busy = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function run(label: string, task: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    setMessage(null);
    setWorking(label);
    try {
      await task();
    } catch (error) {
      if (mounted.current) setMessage({ error: true, text: getMessage(error) });
    } finally {
      busy.current = false;
      if (mounted.current) setWorking(null);
    }
  }

  async function connect() {
    const token = tokenInput.trim() || syncToken;
    if (!token) {
      setMessage({ error: true, text: '请输入 GitHub Token' });
      return;
    }
    await run('正在连接…', async () => {
      const connected = await connectCloudDrive(token);
      const files = await listCloudDrive(connected);
      if (!mounted.current) return;
      setTokenInput('');
      setSession(connected);
      setListing(files);
    });
  }

  function toggleAcceleration() {
    const next = !accelerate;
    try { localStorage.setItem(ACCELERATION_KEY, String(next)); } catch { /* session-only setting */ }
    setAccelerate(next);
  }

  async function upload(files: File[]) {
    if (!session || !files.length) return;
    await run('正在上传…', async () => {
      const failures: string[] = [];
      let uploaded = 0;
      for (const file of files) {
        if (!mounted.current) break;
        try {
          setWorking(`正在上传 ${uploaded + failures.length + 1}/${files.length}`);
          setListing(await uploadCloudDriveFile(session, file));
          uploaded++;
        } catch (error) {
          failures.push(`${file.name}：${getMessage(error)}`);
        }
      }
      if (!mounted.current) return;
      if (failures.length) {
        setMessage({ error: true, text: [uploaded ? `已上传 ${uploaded} 个文件` : '', ...failures].filter(Boolean).join('。') });
      } else {
        toast.success(`已上传 ${uploaded} 个文件`, { position: 'top-center' });
      }
    });
  }

  async function download(file: CloudDriveFile) {
    if (!session || !listing) return;
    await run(accelerate ? '正在测速并下载…' : '正在下载…', async () => {
      const result = await downloadCloudDriveFile(session, file, listing.revision, accelerate);
      if (!mounted.current) return;
      saveDownload(file.name, result.contents);
      toast.success(`文件已下载 · ${result.route}`, { position: 'top-center' });
    });
  }

  async function remove(file: CloudDriveFile) {
    if (!session) return;
    await run('正在删除…', async () => {
      const files = await removeCloudDriveFile(session, file);
      if (!mounted.current) return;
      setListing(files);
      setPendingDelete(null);
      toast.success('已从云盘移除', { position: 'top-center' });
    });
  }

  const button = `inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-3 text-sm font-medium transition-colors disabled:opacity-40`;
  const neutral = `${button} border ${t.itemBg} ${t.itemBorder} ${t.itemBgHover} ${t.textPrimary}`;
  const primary = `${button} bg-indigo-600 text-white hover:bg-indigo-500`;

  return (
    <SystemSheet open isNeu={isNeu} title="云盘" onClose={onClose} bodyClassName="overflow-y-auto px-4 py-3">
      <div className="space-y-3">
        {message && <p role={message.error ? 'alert' : 'status'} className={`break-words rounded-xl px-3 py-2 text-sm ${message.error ? 'bg-red-500/10 text-red-500' : t.textPrimary}`}>{message.text}</p>}
        {!session ? (
          <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void connect(); }}>
            <label className="block space-y-1.5">
              <span className={t.labelCls}>GitHub 个人访问令牌</span>
              <input
                type="password" autoComplete="off" value={tokenInput}
                onChange={(event) => setTokenInput(event.target.value)}
                placeholder={syncToken ? '留空使用云同步的登录令牌' : '输入有仓库创建和读写权限的 Token'}
                className={t.inputCls}
              />
            </label>
            <p className={`text-xs ${t.textDim}`}>首次连接将创建独立的 GitHub 私有仓库。</p>
            <button type="submit" className={`${primary} w-full`} disabled={!!working}>
              {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
              {working ?? '连接 GitHub 云盘'}
            </button>
          </form>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <a href={`https://github.com/${encodeURIComponent(session.owner)}/${CLOUD_DRIVE_REPO}`} target="_blank" rel="noreferrer"
                className={`flex min-w-0 flex-1 items-center gap-1.5 text-xs ${t.textMuted}`}>
                <span className="truncate">{session.owner}/{CLOUD_DRIVE_REPO}</span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
              </a>
              <button type="button" className={neutral} aria-label="刷新云盘" disabled={!!working} onClick={() => {
                void run('正在刷新…', async () => { setListing(await listCloudDrive(session)); });
              }}><RefreshCw className="h-4 w-4" /></button>
              <button type="button" className={primary} disabled={!!working} onClick={() => inputRef.current?.click()}>
                <Upload className="h-4 w-4" /> 上传
              </button>
              <input ref={inputRef} type="file" multiple aria-label="选择上传文件" className="hidden" onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = '';
                void upload(files);
              }} />
            </div>
            <div className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 ${t.itemBg} ${t.itemBorder}`}>
              <div className="min-w-0">
                <p id="drive-acceleration-label" className={`text-sm font-medium ${t.textPrimary}`}>代理加速</p>
                <p className={`text-xs ${t.textDim}`}>测量直连和两条代理线路，自动选择最快线路。</p>
              </div>
              <button
                type="button" role="switch" aria-labelledby="drive-acceleration-label" aria-checked={accelerate}
                onClick={toggleAcceleration} disabled={!!working}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${accelerate ? 'bg-indigo-600' : 'bg-slate-500/60'}`}
              >
                <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${accelerate ? 'translate-x-5' : ''}`} />
              </button>
            </div>
            <div className={`flex items-center justify-between gap-2 text-xs ${t.textDim}`}>
              <span role="status">{working ?? `${listing?.files.length ?? 0} 个文件`}</span>
              <span>单文件 ≤ {formatBytes(CLOUD_DRIVE_MAX_BYTES)}</span>
            </div>
            {listing?.files.length ? (
              <ul className="space-y-2">
                {listing.files.map((file) => (
                  <li key={file.id} className={`rounded-xl border px-3 py-2 ${t.itemBg} ${t.itemBorder}`}>
                    <div className="flex items-center gap-2">
                      <File className={`h-5 w-5 shrink-0 ${t.textMuted}`} aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className={`truncate text-sm ${t.textPrimary}`} title={file.name}>{file.name}</p>
                        <p className={`text-xs ${t.textDim}`}>{formatBytes(file.size)}</p>
                      </div>
                      <button type="button" className={neutral} aria-label={`下载 ${file.name}`} disabled={!!working} onClick={() => void download(file)}><Download className="h-4 w-4" /></button>
                      <button type="button" className={neutral} aria-label={`删除 ${file.name}`} disabled={!!working} onClick={() => setPendingDelete(file)}><Trash2 className="h-4 w-4" /></button>
                    </div>
                    {pendingDelete?.id === file.id && (
                      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                        <span className={`mr-auto text-xs ${t.textDim}`}>从云盘移除？Git 历史会保留此文件。</span>
                        <button type="button" className={neutral} disabled={!!working} onClick={() => setPendingDelete(null)}>取消</button>
                        <button type="button" className={`${button} bg-red-600 text-white`} disabled={!!working} onClick={() => void remove(file)}>确认删除</button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={`rounded-xl border px-3 py-5 text-center text-sm ${t.itemBorder} ${t.textDim}`}>云盘为空</p>
            )}
          </>
        )}
      </div>
    </SystemSheet>
  );
}
