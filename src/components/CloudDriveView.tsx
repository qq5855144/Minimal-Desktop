import {
  ArrowLeft, ChevronRight, CircleAlert, Cloud, Download, ExternalLink, FileText, Folder,
  FolderOpen, FolderPlus, HardDrive, Loader2, MoreHorizontal, Pencil, RefreshCw, Settings2, Share2, Trash2, Upload,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import SystemSheet from '@/components/SystemSheet';
import { useDesktop } from '@/contexts/DesktopContext';
import {
  CLOUD_DRIVE_REPO, type CloudDriveDownload, type CloudDriveFile, type CloudDriveFolder,
  type CloudDriveListing, type CloudDriveSession, type CloudDriveTransfer,
  connectCloudDrive, createCloudDriveFolder, downloadCloudDriveFile, editCloudDriveEntry,
  listCloudDrive, openSharedCloudDrive, removeCloudDriveFile, removeCloudDriveFolder, uploadCloudDriveFile,
} from '@/lib/cloudDrive';
import { driveFolderSubtree } from '@/lib/cloudDriveModel';
import { getPanelTheme } from '@/lib/panelTheme';
import { loadSyncConfig, SYNC_CONFIG_CHANGED_EVENT } from '@/lib/storage';
import './CloudDriveView.css';

const ACCELERATION_KEY = 'minimal_desktop_drive_acceleration';

type Entry = CloudDriveFile | CloudDriveFolder;
type Action =
  | { kind: 'create' }
  | { kind: 'preferences' }
  | { kind: 'menu'; entry: Entry }
  | { kind: 'edit'; entry: Entry }
  | { kind: 'remove'; entry: Entry }
  | { kind: 'share'; entry: CloudDriveFile };
type Work = { label: string; cancel: boolean; completed?: number; total?: number };

function isFile(entry: Entry): entry is CloudDriveFile {
  return 'size' in entry;
}

function syncToken(): string {
  return loadSyncConfig()?.token ?? '';
}

function storedAcceleration(): boolean {
  try { return localStorage.getItem(ACCELERATION_KEY) === 'true'; } catch { return false; }
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return (unit ? value.toFixed(1) : String(value)) + ' ' + units[unit];
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '操作失败，请重试';
}

function pathTo(folders: CloudDriveFolder[], id: string | null): CloudDriveFolder[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const chain: CloudDriveFolder[] = [];
  let current = id ? byId.get(id) : undefined;
  while (current) {
    chain.unshift(current);
    current = current.folderId ? byId.get(current.folderId) : undefined;
  }
  return chain;
}

function saveDownload(name: string, result: CloudDriveDownload): void {
  const url = URL.createObjectURL(result.contents);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
    void result.release?.();
  }, 300_000);
}

function sharedUrl(owner: string, file: CloudDriveFile): string {
  const isExtension = import.meta.env.VITE_IS_EXTENSION === 'true';
  const root = isExtension ? 'https://qq5855144.github.io/Minimal-Desktop/' : new URL(import.meta.env.BASE_URL, location.origin);
  const url = new URL('drive', root);
  url.searchParams.set('owner', owner);
  url.searchParams.set('file', file.id);
  return url.href;
}

export default function CloudDriveView() {
  const { settings } = useDesktop();
  const isNeu = settings.style === 'neumorphism';
  const t = getPanelTheme(isNeu);
  const [params, setParams] = useSearchParams();
  const folderId = params.get('folder');
  const sharedOwner = params.get('owner');
  const sharedId = params.get('file');
  const readonly = !!(sharedOwner || sharedId);
  const [token, setToken] = useState(syncToken);
  const [session, setSession] = useState<CloudDriveSession | null>(null);
  const [listing, setListing] = useState<CloudDriveListing | null>(null);
  const [connection, setConnection] = useState(0);
  const [connecting, setConnecting] = useState(false);
  const [accelerate, setAccelerate] = useState(storedAcceleration);
  const [work, setWork] = useState<Work | null>(null);
  const [notice, setNotice] = useState('');
  const [action, setAction] = useState<Action | null>(null);
  const [name, setName] = useState('');
  const [destination, setDestination] = useState('');
  const [prepared, setPrepared] = useState<CloudDriveDownload | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const transferRef = useRef<AbortController | null>(null);
  const preparedRef = useRef<CloudDriveDownload | null>(null);
  const running = useRef(false);

  useEffect(() => {
    const update = () => setToken(syncToken());
    window.addEventListener(SYNC_CONFIG_CHANGED_EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(SYNC_CONFIG_CHANGED_EVENT, update);
      window.removeEventListener('storage', update);
      transferRef.current?.abort();
      void preparedRef.current?.release?.();
    };
  }, []);

  useEffect(() => {
    let active = true;
    setNotice('');
    setSession(null);
    setListing(null);
    setConnecting(!!token);
    if (token) {
      if (readonly && (!sharedOwner || !sharedId)) {
        setNotice('云盘分享链接无效');
        setConnecting(false);
        return () => { active = false; };
      }
      const pending = sharedOwner ? openSharedCloudDrive(token, sharedOwner) : connectCloudDrive(token);
      void pending.then(async (ready) => {
        const files = await listCloudDrive(ready);
        if (!active) return;
        setSession(ready);
        setListing(files);
      }).catch((error: unknown) => { if (active) setNotice(messageOf(error)); }).finally(() => {
        if (active) setConnecting(false);
      });
    }
    return () => { active = false; transferRef.current?.abort(); };
  }, [connection, readonly, sharedId, sharedOwner, token]);

  const folders = listing?.folders ?? [];
  const files = listing?.files ?? [];
  const chain = pathTo(folders, folderId);
  const currentFolderId = chain[chain.length - 1]?.id ?? null;
  const activeFiles = readonly ? files.filter((file) => file.id === sharedId) : files
    .filter((file) => (file.folderId ?? null) === currentFolderId).sort((a, b) => a.name.localeCompare(b.name));
  const activeFolders = readonly ? [] : folders
    .filter((folder) => (folder.folderId ?? null) === currentFolderId).sort((a, b) => a.name.localeCompare(b.name));

  async function run(label: string, cancel: boolean, task: (transfer: CloudDriveTransfer) => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setNotice('');
    const controller = new AbortController();
    transferRef.current = controller;
    setWork({ label, cancel });
    try {
      await task({
        signal: controller.signal,
        onProgress: (completed, total) => setWork((current) => current ? { ...current, completed, total } : current),
      });
    } catch (error) {
      setNotice(controller.signal.aborted ? '传输已取消' : messageOf(error));
    } finally {
      transferRef.current = null;
      running.current = false;
      setWork(null);
    }
  }

  function goTo(id: string | null) {
    setParams(id ? { folder: id } : {});
  }

  function toggleAcceleration() {
    const next = !accelerate;
    try { localStorage.setItem(ACCELERATION_KEY, String(next)); } catch { /* session-only preference */ }
    setAccelerate(next);
  }

  async function upload(selected: File[]) {
    if (!session || !selected.length) return;
    await run('上传中', true, async (transfer) => {
      const errors: string[] = [];
      for (const [index, file] of selected.entries()) {
        transfer.signal?.throwIfAborted();
        setWork({ label: '上传 ' + (index + 1) + '/' + selected.length + ' · ' + file.name, cancel: true });
        try {
          const next = await uploadCloudDriveFile(session, file, currentFolderId, transfer);
          setListing(next);
        } catch (error) {
          transfer.signal?.throwIfAborted();
          errors.push(file.name + '：' + messageOf(error));
        }
      }
      if (errors.length) setNotice(errors.join('。'));
      else toast.success('上传完成', { position: 'top-center' });
    });
  }

  async function download(file: CloudDriveFile, share = false) {
    if (!session || !listing) return;
    await run(share ? '准备分享文件' : '下载中', true, async (transfer) => {
      const result = await downloadCloudDriveFile(session, file, listing.revision, accelerate, transfer);
      if (transfer.signal?.aborted) {
        await result.release?.();
        transfer.signal.throwIfAborted();
      }
      if (share) {
        preparedRef.current = result;
        setPrepared(result);
      } else {
        saveDownload(file.name, result);
        toast.success('已下载 · ' + result.route, { position: 'top-center' });
      }
    });
  }

  function clearAction() {
    if (running.current) return;
    void preparedRef.current?.release?.();
    preparedRef.current = null;
    setPrepared(null);
    setAction(null);
  }

  function showAction(next: Action) {
    setNotice('');
    if (next.kind === 'create') setName('');
    if (next.kind === 'edit') {
      setName(next.entry.name);
      setDestination(next.entry.folderId ?? '');
    }
    setAction(next);
  }

  async function saveAction() {
    if (!session || !action || action.kind === 'menu' || action.kind === 'share' || action.kind === 'preferences') return;
    await run('正在保存', false, async () => {
      let next: CloudDriveListing;
      if (action.kind === 'create') next = await createCloudDriveFolder(session, name, currentFolderId);
      else if (action.kind === 'edit') next = await editCloudDriveEntry(session, action.entry.id, name, destination || null);
      else next = isFile(action.entry)
        ? await removeCloudDriveFile(session, action.entry)
        : await removeCloudDriveFolder(session, action.entry.id);
      setListing(next);
      setAction(null);
      toast.success(action.kind === 'remove' ? '已删除' : '已保存', { position: 'top-center' });
    });
  }

  async function sendPrepared(file: CloudDriveFile) {
    if (!prepared) return;
    const shareFile = new File([prepared.contents], file.name, { type: file.mime || prepared.contents.type });
    if (!navigator.share || !navigator.canShare?.({ files: [shareFile] })) {
      saveDownload(file.name, prepared);
      preparedRef.current = null;
      setPrepared(null);
      setAction(null);
      toast.info('文件已保存，可在其他应用中分享');
      return;
    }
    try {
      await navigator.share({ files: [shareFile], title: file.name });
      clearAction();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) toast.error(messageOf(error));
    }
  }

  async function copyLink(file: CloudDriveFile) {
    if (!session) return;
    const url = sharedUrl(session.owner, file);
    try {
      await navigator.clipboard.writeText(url);
      toast.success('已复制私有链接', { position: 'top-center' });
    } catch {
      window.prompt('复制私有链接', url);
    }
  }

  const control = 'drive-control';
  const neutral = control + ' drive-neutral';
  const primary = control + ' drive-primary';
  const iconButton = control + ' drive-icon-button';
  const actionTitle = action?.kind === 'create' ? '新建文件夹'
    : action?.kind === 'edit' ? '重命名或移动'
    : action?.kind === 'remove' ? '删除确认'
    : action?.kind === 'share' ? '分享文件'
    : action?.kind === 'preferences' ? '云盘设置' : '文件操作';
  const excluded = action?.kind === 'edit' && !isFile(action.entry)
    ? driveFolderSubtree(folders, action.entry.id) : new Set<string>();
  const entries = [...activeFolders, ...activeFiles];
  const menuFile = action?.kind === 'menu' && isFile(action.entry) ? action.entry : null;
  const repoUrl = session ? 'https://github.com/' + encodeURIComponent(session.owner) + '/' + CLOUD_DRIVE_REPO : '';
  const alert = notice && (
    <p role="alert" className="drive-alert">
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="min-w-0 break-words">{notice}</span>
    </p>
  );

  return (
    <main className="drive-page" data-theme={isNeu ? 'light' : 'dark'}>
      <header className="drive-header">
        <div className="drive-shell drive-header-inner">
          <Link to="/" className={iconButton + ' drive-back'} aria-label="返回桌面" title="返回桌面">
            <ArrowLeft className="size-[18px]" aria-hidden />
            <span className="hidden sm:inline">桌面</span>
          </Link>
          <div className="flex min-w-0 items-center justify-center gap-2.5">
            <span className="drive-brand" aria-hidden>
              <Cloud className="size-5" />
            </span>
            <h1 className="truncate text-lg font-semibold tracking-tight">{readonly ? '分享文件' : '云盘'}</h1>
          </div>
          {session && (
            <button type="button" className={neutral + ' drive-settings-button'} aria-label="云盘设置"
              title="云盘设置" disabled={!!work} onClick={() => showAction({ kind: 'preferences' })}>
              <Settings2 className="size-[18px]" aria-hidden />
              <span className="hidden sm:inline">设置</span>
            </button>
          )}
        </div>
      </header>

      <div className="drive-shell drive-content">
        {!action && alert}

        {!token && (
          <section className="drive-panel drive-state drive-login" aria-labelledby="drive-login-title">
            <span className="drive-state-icon" aria-hidden><Cloud className="size-8" strokeWidth={1.65} /></span>
            <h2 id="drive-login-title" className="text-xl font-semibold tracking-tight">登录后{readonly ? '查看分享' : '使用云盘'}</h2>
            <p className="drive-muted text-sm">使用现有的云同步登录访问文件。</p>
            <Link to="/?panel=sync" className={primary + ' mt-2'}>去云同步登录 <ChevronRight className="size-4" aria-hidden /></Link>
          </section>
        )}
        {connecting && (
          <div className="drive-panel drive-state drive-muted" role="status">
            <Loader2 className="size-6 animate-spin" aria-hidden />
            <span className="text-sm">正在连接云盘…</span>
          </div>
        )}
        {token && !session && !connecting && notice && (
          <button type="button" className={neutral} onClick={() => setConnection((current) => current + 1)}>
            <RefreshCw className="size-4" aria-hidden />重试连接
          </button>
        )}

        {session && listing && (
          <section className="drive-panel" aria-label={readonly ? '文件分享' : '文件列表'}>
            <div className="drive-toolbar">
              {readonly ? <span className="text-sm font-semibold">共享内容</span> : (
                <nav aria-label="当前目录" className="drive-path">
                  <button type="button" className={control + ' drive-crumb'} onClick={() => goTo(null)} disabled={!!work}
                    aria-current={!chain.length ? 'location' : undefined}>
                    <HardDrive className="size-4 shrink-0" aria-hidden /><span className="truncate">全部文件</span>
                  </button>
                  {chain.map((folder) => (
                    <span key={folder.id} className="flex min-w-0 items-center gap-0.5">
                      <ChevronRight className="drive-muted size-3.5 shrink-0" aria-hidden />
                      <button type="button" className={control + ' drive-crumb'} title={folder.name} onClick={() => goTo(folder.id)}
                        disabled={!!work} aria-current={folder.id === currentFolderId ? 'location' : undefined}>
                        <span className="truncate">{folder.name}</span>
                      </button>
                    </span>
                  ))}
                </nav>
              )}
              <div className="drive-toolbar-actions">
                {!readonly && <>
                  <button type="button" className={primary} disabled={!!work} onClick={() => inputRef.current?.click()}>
                    <Upload className="size-4" aria-hidden />上传文件
                  </button>
                  <button type="button" className={neutral} disabled={!!work} onClick={() => showAction({ kind: 'create' })}>
                    <FolderPlus className="size-4" aria-hidden />新建文件夹
                  </button>
                  <input ref={inputRef} type="file" multiple className="hidden" aria-label="选择上传文件" onChange={(event) => {
                    const selected = Array.from(event.target.files ?? []);
                    event.target.value = '';
                    void upload(selected);
                  }} />
                </>}
                <button type="button" className={neutral + ' drive-icon-button'} aria-label="刷新云盘" title="刷新云盘"
                  disabled={!!work} onClick={() => {
                    void run('正在刷新', false, async () => { setListing(await listCloudDrive(session)); });
                  }}>
                  <RefreshCw className="size-4" aria-hidden />
                </button>
              </div>
            </div>
            {work && !action && (
              <div className="drive-transfer" role="status">
                <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
                <span className="min-w-0 flex-1 break-words">{work.label}{work.total ? ' · ' + formatBytes(work.completed ?? 0) + ' / ' + formatBytes(work.total) : '…'}</span>
                {work.cancel && <button type="button" className={neutral} onClick={() => transferRef.current?.abort()}>取消传输</button>}
                {!!work.total && <progress aria-label="传输进度" max={work.total} value={work.completed ?? 0} />}
              </div>
            )}
            {entries.length ? <>
              <div className="drive-list-heading" aria-hidden><span>名称</span><span>{entries.length} 项</span></div>
              <ul className="drive-list">
                {entries.map((entry) => {
                  const file = isFile(entry) ? entry : null;
                  return (
                    <li key={entry.id} className="drive-row">
                      {file ? (
                        <div className="drive-entry">
                          <span className="drive-entry-icon" aria-hidden><FileText className="size-[19px]" /></span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium" title={file.name}>{file.name}</span>
                            <span className="drive-muted mt-0.5 block text-xs">{formatBytes(file.size)}</span>
                          </span>
                        </div>
                      ) : (
                        <button type="button" className="drive-entry drive-folder" disabled={!!work} onClick={() => goTo(entry.id)}>
                          <span className="drive-entry-icon drive-folder-icon" aria-hidden><Folder className="size-[19px]" /></span>
                          <span className="min-w-0 truncate text-sm font-medium" title={entry.name}>{entry.name}</span>
                          <ChevronRight className="drive-muted ml-0.5 size-4 shrink-0" aria-hidden />
                        </button>
                      )}
                      <div className="flex shrink-0 items-center">
                        {file && (
                          <button type="button" disabled={!!work} className={iconButton} aria-label={'下载 ' + entry.name} title="下载"
                            onClick={() => void download(file)}>
                            <Download className="size-[18px]" aria-hidden />
                          </button>
                        )}
                        {!readonly && (
                          <button type="button" disabled={!!work} className={iconButton} aria-label={'更多操作 ' + entry.name} title="更多操作"
                            onClick={() => showAction({ kind: 'menu', entry })}>
                            <MoreHorizontal className="size-5" aria-hidden />
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </> : (
              <div className="drive-state">
                <span className="drive-state-icon" aria-hidden><FolderOpen className="size-7" strokeWidth={1.65} /></span>
                <p className="text-sm font-medium">{readonly ? '分享文件已删除或不可访问' : '此文件夹为空'}</p>
              </div>
            )}
          </section>
        )}
      </div>

      <SystemSheet open={!!action} isNeu={isNeu} title={actionTitle} onClose={clearAction} bodyClassName="overflow-y-auto p-4">
        {action?.kind === 'preferences' && (
          <div className="drive-sheet-list">
            <button type="button" role="switch" aria-checked={accelerate} disabled={!!work}
              onClick={toggleAcceleration} className="drive-sheet-option">
              <span className="font-medium">下载代理加速</span>
              <span className="drive-switch" aria-hidden><span /></span>
            </button>
            {!readonly && repoUrl && (
              <a href={repoUrl} className="drive-sheet-option" target="_blank" rel="noreferrer">
                <span>打开 GitHub 仓库</span><ExternalLink className="size-4" aria-hidden />
              </a>
            )}
          </div>
        )}
        {action?.kind === 'menu' && (
          <div className="drive-sheet-list">
            <p className="drive-muted truncate px-2 pb-1 text-sm" title={action.entry.name}>{action.entry.name}</p>
            {menuFile && (
              <button type="button" className="drive-sheet-option" onClick={() => showAction({ kind: 'share', entry: menuFile })}>
                <span className="flex items-center gap-3"><Share2 className="size-4" aria-hidden />分享文件</span>
                <ChevronRight className="size-4" aria-hidden />
              </button>
            )}
            <button type="button" className="drive-sheet-option" onClick={() => showAction({ kind: 'edit', entry: action.entry })}>
              <span className="flex items-center gap-3"><Pencil className="size-4" aria-hidden />重命名或移动</span>
              <ChevronRight className="size-4" aria-hidden />
            </button>
            <button type="button" className="drive-sheet-option drive-danger-text" onClick={() => showAction({ kind: 'remove', entry: action.entry })}>
              <span className="flex items-center gap-3"><Trash2 className="size-4" aria-hidden />删除</span>
            </button>
          </div>
        )}
        {(action?.kind === 'create' || action?.kind === 'edit') && (
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void saveAction(); }}>
            <label className="block space-y-1.5 text-sm"><span className={t.textPrimary}>名称</span>
              <input className={t.inputCls} value={name} onChange={(event) => setName(event.target.value)} maxLength={255} required autoFocus />
            </label>
            {action.kind === 'edit' && <label className="block space-y-1.5 text-sm"><span className={t.textPrimary}>所在目录</span>
              <select className={t.inputCls} value={destination} onChange={(event) => setDestination(event.target.value)}>
                <option value="">根目录</option>
                {folders.filter((folder) => !excluded.has(folder.id)).map((folder) => (
                  <option key={folder.id} value={folder.id}>{pathTo(folders, folder.id).map((part) => part.name).join(' / ')}</option>
                ))}
              </select>
            </label>}
            {alert}
            <div className="flex justify-end gap-2">
              <button type="button" className={neutral} disabled={!!work} onClick={clearAction}>取消</button>
              <button type="submit" className={primary} disabled={!!work || !name.trim()}>{work ? '正在保存…' : '保存'}</button>
            </div>
          </form>
        )}
        {action?.kind === 'remove' && <div className="space-y-3">
          <p className="break-words">删除「{action.entry.name}」{isFile(action.entry) ? '？' : '及其全部内容？'}</p>
          <p className="drive-muted text-sm">旧版本仍保留在 Git 历史中。</p>
          {alert}
          <div className="flex justify-end gap-2">
            <button type="button" className={neutral} disabled={!!work} onClick={clearAction}>取消</button>
            <button type="button" className={control + ' bg-red-600 text-white hover:bg-red-700'} disabled={!!work}
              onClick={() => void saveAction()}>{work ? '正在删除…' : '确认删除'}</button>
          </div>
        </div>}
        {action?.kind === 'share' && <div className="space-y-3">
          <p className="truncate text-sm font-medium" title={action.entry.name}>{action.entry.name}</p>
          <p className="drive-muted text-sm">私有链接仅供有此 GitHub 仓库读取权限的用户使用。</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={neutral} disabled={!!work} onClick={() => void copyLink(action.entry)}>复制私有链接</button>
            <button type="button" className={primary} disabled={!!work} onClick={() => {
              if (prepared) void sendPrepared(action.entry);
              else void download(action.entry, true);
            }}>{prepared ? '发送文件' : '准备文件分享'}</button>
            {work?.cancel && <button type="button" className={neutral} onClick={() => transferRef.current?.abort()}>取消传输</button>}
          </div>
          {work && <p role="status" className="drive-muted break-words text-xs">{work.label}{work.total ? ' · ' + formatBytes(work.completed ?? 0) + ' / ' + formatBytes(work.total) : '…'}</p>}
          {alert}
        </div>}
      </SystemSheet>
    </main>
  );
}
