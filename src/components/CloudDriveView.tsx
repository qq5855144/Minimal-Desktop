import { ArrowLeft, Cloud, Download, Edit3, ExternalLink, File, Folder, FolderPlus, Loader2, RefreshCw, Share2, Trash2, Upload } from 'lucide-react';
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

const ACCELERATION_KEY = 'minimal_desktop_drive_acceleration';

type Entry = CloudDriveFile | CloudDriveFolder;
type Action = { kind: 'create' } | { kind: 'edit' | 'remove'; entry: Entry } | { kind: 'share'; entry: CloudDriveFile };
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
    setName(next.kind === 'create' ? '' : next.entry.name);
    setDestination(next.kind === 'create' ? '' : (next.entry.folderId ?? ''));
    setAction(next);
  }

  async function saveAction() {
    if (!session || !action || action.kind === 'share') return;
    await run('正在保存', false, async () => {
      let next: CloudDriveListing;
      if (action.kind === 'create') next = await createCloudDriveFolder(session, name, currentFolderId);
      else if (action.kind === 'edit') next = await editCloudDriveEntry(session, action.entry.id, name, destination || null);
      else if (isFile(action.entry)) next = await removeCloudDriveFile(session, action.entry);
      else next = await removeCloudDriveFolder(session, action.entry.id);
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

  const block = 'rounded-2xl border ' + t.itemBg + ' ' + t.itemBorder;
  const button = 'inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-medium transition-colors disabled:opacity-40';
  const neutral = button + ' border ' + t.itemBorder + ' ' + t.itemBgHover + ' ' + t.textPrimary;
  const primary = button + ' bg-indigo-600 text-white hover:bg-indigo-500';
  const main = isNeu ? 'bg-slate-100 text-slate-800' : 'bg-slate-950 text-slate-50';
  const actionTitle = action?.kind === 'create' ? '新建文件夹'
    : action?.kind === 'edit' ? '重命名或移动'
    : action?.kind === 'remove' ? '删除' : '分享文件';
  const excluded = action?.kind === 'edit' && !isFile(action.entry)
    ? driveFolderSubtree(folders, action.entry.id) : new Set<string>();

  return (
    <main className={'h-[100dvh] overflow-y-auto ' + main}>
      <div className="mx-auto max-w-4xl px-3 pb-8 pt-[max(env(safe-area-inset-top),12px)] sm:px-6">
        <header className="mb-4 flex items-center gap-3">
          <Link to="/" className={neutral} aria-label="返回桌面"><ArrowLeft className="h-4 w-4" /></Link>
          <Cloud className="h-5 w-5 shrink-0 text-indigo-500" aria-hidden />
          <h1 className="min-w-0 flex-1 text-xl font-semibold">{readonly ? '分享文件' : '云盘'}</h1>
          {session && !readonly && <a href={'https://github.com/' + encodeURIComponent(session.owner) + '/' + CLOUD_DRIVE_REPO}
            className={neutral} target="_blank" rel="noreferrer" aria-label="打开 GitHub 仓库"><ExternalLink className="h-4 w-4" /></a>}
        </header>

        {!token && <div className={block + ' space-y-3 p-4'}>
          <p>登录云同步后即可使用云盘。</p>
          <Link to="/?panel=sync" className={primary}>去云同步登录</Link>
        </div>}
        {connecting && <p role="status" className="flex items-center gap-2 px-2 py-4"><Loader2 className="h-4 w-4 animate-spin" />正在连接 GitHub 云盘…</p>}
        {notice && <p role="alert" className="mb-3 break-words rounded-xl bg-red-500/10 p-3 text-sm text-red-500">{notice}</p>}
        {token && !session && !connecting && notice && <button type="button" className={neutral} onClick={() => setConnection((current) => current + 1)}>重试连接</button>}

        {session && listing && <div className="space-y-3">
          {!readonly && <nav aria-label="当前目录" className="flex flex-wrap items-center gap-1.5 text-sm">
            <button type="button" className={neutral} onClick={() => goTo(null)} disabled={!!work}>全部文件</button>
            {chain.map((folder) => <span key={folder.id} className="flex min-w-0 items-center gap-1.5">
              <span aria-hidden>/</span><button type="button" className={neutral + ' max-w-48 truncate'} onClick={() => goTo(folder.id)} disabled={!!work}>{folder.name}</button>
            </span>)}
          </nav>}
          <div className="flex flex-wrap items-center gap-2">
            {!readonly && <>
              <button type="button" className={primary} disabled={!!work} onClick={() => inputRef.current?.click()}>
                <Upload className="h-4 w-4" />上传到当前目录
              </button>
              <button type="button" className={neutral} disabled={!!work} onClick={() => showAction({ kind: 'create' })}>
                <FolderPlus className="h-4 w-4" />新建文件夹
              </button>
              <input ref={inputRef} type="file" multiple className="hidden" aria-label="选择上传文件" onChange={(event) => {
                const selected = Array.from(event.target.files ?? []);
                event.target.value = '';
                void upload(selected);
              }} />
            </>}
            <button type="button" className={neutral} aria-label="刷新云盘" disabled={!!work} onClick={() => {
              void run('正在刷新', false, async () => { setListing(await listCloudDrive(session)); });
            }}><RefreshCw className="h-4 w-4" /></button>
            <div className="ml-auto flex min-h-10 items-center gap-2 px-1 text-sm">
              <span id="drive-acceleration-label">代理加速</span>
              <button type="button" role="switch" aria-labelledby="drive-acceleration-label" aria-checked={accelerate}
                disabled={!!work} onClick={toggleAcceleration}
                className={'relative h-6 w-11 rounded-full transition-colors ' + (accelerate ? 'bg-indigo-600' : 'bg-slate-500/60')}>
                <span className={'absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ' + (accelerate ? 'translate-x-5' : '')} />
              </button>
            </div>
          </div>
          {work && <div className={block + ' flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm'} role="status">
            <span className="min-w-0 flex-1 break-words">{work.label}{work.total ? ' · ' + formatBytes(work.completed ?? 0) + ' / ' + formatBytes(work.total) : '…'}</span>
            {work.cancel && <button type="button" className={neutral} onClick={() => transferRef.current?.abort()}>取消传输</button>}
            {!!work.total && <progress className="h-2 w-full accent-indigo-600" max={work.total} value={work.completed ?? 0} />}
          </div>}
          {activeFolders.length + activeFiles.length === 0 && (
            <p className={block + ' p-6 text-center text-sm ' + t.textMuted}>{readonly ? '分享文件已删除或不可访问' : '此目录为空'}</p>
          )}
          <ul className="space-y-2">
            {[...activeFolders, ...activeFiles].map((entry) => {
              const file = isFile(entry) ? entry : null;
              const Icon = file ? File : Folder;
              return <li key={entry.id} className={block + ' flex flex-wrap items-center gap-1.5 px-3 py-2'}>
                {file ? <div className="flex min-w-0 flex-1 items-center gap-2">
                  <Icon className="h-5 w-5 shrink-0 text-indigo-500" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm" title={entry.name}>{entry.name}</span>
                    <span className={'block text-xs ' + t.textMuted}>{formatBytes(file.size)}</span>
                  </span>
                </div> : <button type="button" disabled={!!work} onClick={() => goTo(entry.id)} className="flex min-h-10 min-w-0 flex-1 items-center gap-2 text-left text-sm">
                  <Icon className="h-5 w-5 shrink-0 text-indigo-500" aria-hidden />
                  <span className="truncate">{entry.name}</span>
                </button>}
                {file && <button type="button" disabled={!!work} className={neutral} aria-label={'下载 ' + entry.name} onClick={() => void download(file)}><Download className="h-4 w-4" /></button>}
                {!readonly && file && <button type="button" disabled={!!work} className={neutral} aria-label={'分享 ' + entry.name} onClick={() => showAction({ kind: 'share', entry: file })}><Share2 className="h-4 w-4" /></button>}
                {!readonly && <button type="button" disabled={!!work} className={neutral} aria-label={'管理 ' + entry.name} onClick={() => showAction({ kind: 'edit', entry })}><Edit3 className="h-4 w-4" /></button>}
              </li>;
            })}
          </ul>
        </div>}
      </div>

      <SystemSheet open={!!action} isNeu={isNeu} title={actionTitle} onClose={clearAction} bodyClassName="overflow-y-auto p-4">
        {(action?.kind === 'create' || action?.kind === 'edit') && (
          <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void saveAction(); }}>
            <label className="block space-y-1.5"><span>名称</span>
              <input className={t.inputCls} value={name} onChange={(event) => setName(event.target.value)} maxLength={255} required autoFocus />
            </label>
            {action.kind === 'edit' && <label className="block space-y-1.5"><span>所在目录</span>
              <select className={t.inputCls} value={destination} onChange={(event) => setDestination(event.target.value)}>
                <option value="">根目录</option>
                {folders.filter((folder) => !excluded.has(folder.id)).map((folder) => (
                  <option key={folder.id} value={folder.id}>{pathTo(folders, folder.id).map((part) => part.name).join(' / ')}</option>
                ))}
              </select>
            </label>}
            {notice && <p role="alert" className="text-sm text-red-500">{notice}</p>}
            <div className="flex justify-end gap-2">
              {action.kind === 'edit' && <button type="button" className={neutral + ' mr-auto text-red-500'} disabled={!!work}
                onClick={() => showAction({ kind: 'remove', entry: action.entry })}><Trash2 className="h-4 w-4" />删除</button>}
              <button type="submit" className={primary} disabled={!!work || !name.trim()}>保存</button>
            </div>
          </form>
        )}
        {action?.kind === 'remove' && <div className="space-y-3">
          <p className={t.textPrimary}>删除「{action.entry.name}」{isFile(action.entry) ? '？' : '及其全部内容？'}</p>
          <p className={'text-sm ' + t.textMuted}>旧版本仍保留在 Git 历史中。</p>
          {notice && <p role="alert" className="text-sm text-red-500">{notice}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className={neutral} disabled={!!work} onClick={clearAction}>取消</button>
            <button type="button" className={button + ' bg-red-600 text-white'} disabled={!!work} onClick={() => void saveAction()}>确认删除</button>
          </div>
        </div>}
        {action?.kind === 'share' && <div className="space-y-3">
          <p className={'truncate text-sm ' + t.textPrimary}>{action.entry.name}</p>
          <p className={'text-sm ' + t.textMuted}>私有链接仅供有此 GitHub 仓库读取权限的用户使用。</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={neutral} disabled={!!work} onClick={() => void copyLink(action.entry)}>复制私有链接</button>
            <button type="button" className={primary} disabled={!!work} onClick={() => {
              if (prepared) void sendPrepared(action.entry);
              else void download(action.entry, true);
            }}>{prepared ? '发送文件' : '准备文件分享'}</button>
            {work?.cancel && <button type="button" className={neutral} onClick={() => transferRef.current?.abort()}>取消传输</button>}
          </div>
          {work && <p role="status" className={'text-xs ' + t.textMuted}>{work.label}{work.total ? ' · ' + formatBytes(work.completed ?? 0) + ' / ' + formatBytes(work.total) : '…'}</p>}
          {notice && <p role="alert" className="text-sm text-red-500">{notice}</p>}
        </div>}
      </SystemSheet>
    </main>
  );
}
