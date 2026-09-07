import { ArrowLeft, ChevronDown, Bookmark as BookmarkIcon, Check, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { useDesktop } from '@/contexts/DesktopContext';
import { copyLink } from '@/lib/clipboard';
import { emptyBookmarks, type Bookmark } from '@/lib/bookmarks';
import { getDirectFaviconUrl } from '@/lib/favicon';
import { normalizeHttpUrl } from '@/lib/urlSafety';
import { openExternalUrl } from '@/lib/openExternal';
import './bookmarks.css';

function BookmarkImage({ item }: { item: Bookmark }) {
  const [failed, setFailed] = useState(false);
  const src = item.iconUrl || getDirectFaviconUrl(item.url);
  return <span className="bookmark-icon">{!failed && src ? <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <BookmarkIcon size={24} />}</span>;
}
function BookmarkLink({ item, editing, selected, onClick, onMenu }: { item: Bookmark; editing: boolean; selected: boolean; onClick: () => void; onMenu: (x: number, y: number) => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; start.current = null; };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return <button type="button" className="bookmark-link" aria-pressed={editing ? selected : undefined}
    onPointerDown={(event) => {
      clear(); suppressClick.current = false;
      if (editing || !event.isPrimary || event.button !== 0) return;
      const x = event.clientX; const y = event.clientY; start.current = { x, y };
      timer.current = setTimeout(() => { suppressClick.current = true; onMenu(x, y); clear(); }, 500);
    }}
    onPointerMove={(event) => { if (start.current && Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > 10) clear(); }}
    onPointerUp={clear} onPointerCancel={clear} onPointerLeave={clear}
    onContextMenu={(event) => { if (editing) return; event.preventDefault(); clear(); suppressClick.current = true; const rect = event.currentTarget.getBoundingClientRect(); onMenu(event.clientX || rect.left + 30, event.clientY || rect.bottom); }}
    onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } onClick(); }}>
    <BookmarkImage key={`${item.url}-${item.iconUrl}`} item={item} /><span>{item.name}</span>
  </button>;
}
export default function BookmarksView({ onClose }: { onClose: () => void }) {
  const { data, updateBookmarks } = useDesktop();
  const library = data.bookmarks ?? emptyBookmarks();
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('all');
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [groupMenuTop, setGroupMenuTop] = useState(false);
  const [context, setContext] = useState<{ item: Bookmark; x: number; y: number } | null>(null);
  const [menu, setMenu] = useState<'groups' | 'move' | null>(null);
  const [form, setForm] = useState<'group' | 'bookmark' | Bookmark | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [dragVisual, setDragVisual] = useState<{ item: Bookmark; x: number; y: number; width: number; offsetX: number; offsetY: number } | null>(null);
  type GesturePhase = 'pending' | 'scrolling' | 'dragging';
  type DragState = {
    id: string; sourceIndex: number; dropIndex: number; pointerId: number; pointerType: string;
    phase: GesturePhase; timer: ReturnType<typeof setTimeout> | null;
    start: { x: number; y: number }; latest: { x: number; y: number };
    rows: { id: string; center: number }[]; rowHeight: number; startScrollTop: number;
  };
  const drag = useRef<DragState | null>(null);
  const suppressRowClick = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const getList = () => root.current?.querySelector<HTMLElement>('.bookmark-list') ?? null;
  const clearTimer = (current: DragState) => {
    if (current.timer) clearTimeout(current.timer);
    current.timer = null;
  };
  const resetGesture = () => {
    if (drag.current) clearTimer(drag.current);
    drag.current = null;
    setDropIndex(null);
    setDraggingId(null);
    setDragVisual(null);
  };
  const updateDropIndex = (current: DragState) => {
    const list = getList();
    const scrollOffset = (list?.scrollTop ?? current.startScrollTop) - current.startScrollTop;
    const remaining = current.rows.filter((entry) => entry.id !== current.id);
    const nextIndex = remaining.reduce(
      (index, entry) => index + (current.latest.y > entry.center - scrollOffset ? 1 : 0), 0,
    );
    if (nextIndex !== current.dropIndex) {
      current.dropIndex = nextIndex;
      setDropIndex(nextIndex);
    }
    const rect = list?.getBoundingClientRect();
    if (!list || !rect) return;
    if (current.latest.y < rect.top + 48) list.scrollTop -= 14;
    else if (current.latest.y > rect.bottom - 48) list.scrollTop += 14;
  };
  const activateDrag = (item: Bookmark, row: HTMLDivElement) => {
    const current = drag.current;
    if (!current || current.phase !== 'pending') return;
    const bounds = row.getBoundingClientRect();
    const rows = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-bookmark-id]') ?? []).map((entry) => {
      const rect = entry.getBoundingClientRect();
      return { id: entry.dataset.bookmarkId ?? '', center: rect.top + rect.height / 2 };
    });
    current.phase = 'dragging';
    clearTimer(current);
    current.rows = rows;
    current.startScrollTop = getList()?.scrollTop ?? 0;
    current.sourceIndex = rows.findIndex((entry) => entry.id === item.id);
    current.dropIndex = current.sourceIndex;
    current.rowHeight = bounds.height;
    suppressRowClick.current = true;
    setDraggingId(item.id);
    setDropIndex(current.sourceIndex);
    setDragVisual({
      item, x: bounds.left, y: bounds.top, width: bounds.width,
      offsetX: current.latest.x - bounds.left, offsetY: current.latest.y - bounds.top,
    });
  };
  const startDrag = (item: Bookmark, event: React.PointerEvent<HTMLDivElement>) => {
    if (!editing || !event.isPrimary || event.button !== 0) return;
    resetGesture();
    const current: DragState = {
      id: item.id, sourceIndex: -1, dropIndex: -1, pointerId: event.pointerId,
      pointerType: event.pointerType, phase: 'pending', timer: null,
      start: { x: event.clientX, y: event.clientY }, latest: { x: event.clientX, y: event.clientY },
      rows: [], rowHeight: 0, startScrollTop: getList()?.scrollTop ?? 0,
    };
    drag.current = current;
    // Capture immediately: delaying capture allows native panning to cancel the stream.
    event.currentTarget.setPointerCapture(event.pointerId);
    const row = event.currentTarget;
    current.timer = setTimeout(() => activateDrag(item, row), 400);
  };
  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    current.latest = { x: event.clientX, y: event.clientY };
    if (current.phase === 'dragging') {
      setDragVisual((visual) => visual ? {
        ...visual, x: event.clientX - visual.offsetX, y: event.clientY - visual.offsetY,
      } : visual);
      updateDropIndex(current);
      return;
    }
    const deltaX = event.clientX - current.start.x;
    const deltaY = event.clientY - current.start.y;
    // Scrolling and sorting are exclusive. Clear vertical intent claims scrolling;
    // ordinary hold jitter remains pending and can still become a drag.
    if (current.phase === 'pending' && current.pointerType !== 'mouse'
      && Math.abs(deltaY) >= 18 && Math.abs(deltaY) > Math.abs(deltaX) * 1.15) {
      current.phase = 'scrolling';
      clearTimer(current);
      suppressRowClick.current = true;
    }
    if (current.phase === 'scrolling') {
      const list = getList();
      if (list) list.scrollTop = current.startScrollTop - deltaY;
    }
  };
  const finishDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.phase === 'dragging' && current.dropIndex !== current.sourceIndex) {
      const remaining = current.rows.filter((entry) => entry.id !== current.id);
      const target = current.dropIndex === remaining.length ? remaining[remaining.length - 1] : remaining[current.dropIndex];
      if (target) updateBookmarks({ type: 'reorder', id: current.id, beforeId: target.id, after: current.dropIndex === remaining.length });
    }
    resetGesture();
    // Keep suppression through the synthetic click generated after pointerup, but
    // never let it leak into the next intentional click when scrolling produced none.
    if (suppressRowClick.current) window.setTimeout(() => { suppressRowClick.current = false; }, 100);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const cancelDrag = (event?: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (event && current && current.pointerId !== event.pointerId) return;
    resetGesture();
    if (suppressRowClick.current) window.setTimeout(() => { suppressRowClick.current = false; }, 100);
  };
  const rowShift = (index: number) => {
    const current = drag.current;
    if (current?.phase !== 'dragging' || dropIndex === null || index === current.sourceIndex) return 0;
    if (dropIndex > current.sourceIndex && index > current.sourceIndex && index <= dropIndex) return -current.rowHeight;
    if (dropIndex < current.sourceIndex && index >= dropIndex && index < current.sourceIndex) return current.rowHeight;
    return 0;
  };
  const items = library.items.filter((item) => (group === 'all' || item.groupId === group) && `${item.name} ${item.url}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selectedItems = library.items.filter((item) => selected.includes(item.id));
  const allSelected = items.length > 0 && items.every((item) => selected.includes(item.id));
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => { if (form || deleting) root.current?.querySelector<HTMLElement>('.bookmark-sheet input, .bookmark-sheet button')?.focus(); }, [form, deleting]);
  useEffect(() => { if (context) root.current?.querySelector<HTMLElement>('.bookmark-context button')?.focus(); }, [context]);
  const toggle = (id: string) => setSelected((ids) => ids.includes(id) ? ids.filter((candidate) => candidate !== id) : [...ids, id]);
  const finish = () => { setEditing(false); setSelected([]); setMenu(null); };
  const openForm = (next: 'group' | 'bookmark' | Bookmark) => {
    setForm(next); setName(typeof next === 'object' ? next.name : ''); setUrl(typeof next === 'object' ? next.url : ''); setMenu(null);
  };
  const openSelected = () => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.id && chrome.tabs?.create) {
      selectedItems.forEach((item) => { void chrome.tabs.create({ url: item.url, active: false }).catch(() => toast.error('无法打开书签')); });
    } else {
      let blocked = 0;
      selectedItems.forEach((item) => {
        const tab = window.open('about:blank', '_blank');
        if (!tab) { blocked++; return; }
        tab.opener = null; tab.location.href = item.url;
      });
      if (blocked) toast.error(`${blocked} 个页面被浏览器拦截，请允许弹出窗口`);
    }
  };
  return createPortal(<div ref={root} className="bookmarks-view" role="dialog" aria-modal="true" aria-label="书签" tabIndex={-1} onKeyDown={(event) => {
    if (event.key === 'Escape') { event.stopPropagation(); if (context) setContext(null); else if (form) setForm(null); else if (deleting || deletingGroup) { setDeleting(false); setDeletingGroup(null); } else if (menu) setMenu(null); else if (editing) finish(); else onClose(); }
    if (event.key === 'Tab') {
      const scope = root.current?.querySelector('.bookmark-sheet, .bookmark-context') ?? root.current;
      const controls = Array.from(scope?.querySelectorAll<HTMLElement>('button:not(:disabled),input,a[href]') ?? []);
      const first = controls[0]; const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <header><button type="button" aria-label="返回桌面" onClick={onClose}><ArrowLeft /></button><h1>书签</h1><button type="button" className="bookmark-group-picker" aria-label="切换书签分组" aria-expanded={menu === 'groups'} onClick={() => { setGroupMenuTop(true); setMenu(menu === 'groups' ? null : 'groups'); }}><span>{group === 'all' ? '全部书签' : library.groups.find((entry) => entry.id === group)?.name ?? '默认分组'}</span><ChevronDown size={16} /></button></header>
    <div className="bookmark-search"><input aria-label="搜索书签" placeholder="搜索" value={query} onChange={(event) => { setQuery(event.target.value); setSelected([]); }} /></div>
    <div className={`bookmark-list ${editing ? 'bookmark-list-sorting' : ''}`}>
      {items.map((item, index) => <div key={item.id} data-bookmark-id={item.id} className={`bookmark-row ${draggingId === item.id ? 'bookmark-dragging' : ''}`}
        style={{ transform: `translateY(${rowShift(index)}px)` }}
        onPointerDown={(event) => startDrag(item, event)} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={cancelDrag} onLostPointerCapture={() => { if (drag.current) resetGesture(); }}
        onClickCapture={(event) => { if (suppressRowClick.current) { event.preventDefault(); event.stopPropagation(); suppressRowClick.current = false; } }}>
        <BookmarkLink item={item} editing={editing} selected={selected.includes(item.id)} onClick={() => editing ? toggle(item.id) : openExternalUrl(item.url)} onMenu={(x, y) => {
          setMenu(null); setContext({ item, x: Math.max(12, Math.min(x, window.innerWidth - 180)), y: Math.max(12, Math.min(y, window.innerHeight - 124)) });
        }} />
        {editing && <button type="button" className="bookmark-select" aria-label={`选择 ${item.name}`} aria-pressed={selected.includes(item.id)} onClick={() => toggle(item.id)}><span>{selected.includes(item.id) && <Check size={17} />}</span></button>}
      </div>)}
      {!items.length && <p className="bookmark-empty">{query ? '没有匹配的书签' : '暂无书签'}</p>}
    </div>
    {menu && <div className={`bookmark-menu ${groupMenuTop && menu === 'groups' ? 'bookmark-menu-top' : ''}`}>
      <div className="bookmark-menu-title">{menu === 'move' ? '移动到分组' : '分组'}<button type="button" aria-label="关闭菜单" onClick={() => setMenu(null)}><X size={18} /></button></div>
      {menu === 'groups' && groupMenuTop && <button type="button" onClick={() => { setGroup('all'); setSelected([]); setMenu(null); }}>全部书签{group === 'all' && <Check size={16} />}</button>}
      {menu === 'move' && library.groups.map((entry) => <button type="button" key={entry.id} onClick={() => { updateBookmarks({ type: 'move', ids: selectedItems.map((item) => item.id), groupId: entry.id }); setSelected([]); setMenu(null); }}>{entry.name}</button>)}
      {menu === 'groups' && groupMenuTop && library.groups.filter((entry) => entry.id !== 'default').map((entry) => <div className="bookmark-group-menu-row" key={entry.id}><button type="button" onClick={() => { setGroup(entry.id); setSelected([]); setMenu(null); }}>{entry.name}{group === entry.id && <Check size={16} />}</button><button type="button" className="bookmark-delete-group" aria-label={`删除分组 ${entry.name}`} onClick={() => { setDeletingGroup(entry.id); setMenu(null); }}>删除</button></div>)}
      {menu === 'groups' && !groupMenuTop && <><button type="button" onClick={() => openForm('group')}>新建分组</button><button type="button" onClick={() => openForm('bookmark')}>添加书签</button></>}
    </div>}
    <footer>{editing ? <>
      <button type="button" onClick={() => setSelected(allSelected ? [] : items.map((item) => item.id))}>{allSelected ? '取消全选' : '全选'}</button>
      <button type="button" disabled={!selectedItems.length} onClick={() => setMenu(menu === 'move' ? null : 'move')}>移动</button>
      <button type="button" disabled={!selectedItems.length} onClick={() => setDeleting(true)}>删除</button>
      <button type="button" disabled={!selectedItems.length} onClick={openSelected}>打开</button>
      {selectedItems.length === 1 && <button type="button" onClick={() => openForm(selectedItems[0])}>修改</button>}
      <button type="button" onClick={finish}>完成</button>
    </> : <><button type="button" onClick={() => { setGroupMenuTop(false); setMenu(menu === 'groups' ? null : 'groups'); }}>更多</button><button type="button" onClick={() => { setEditing(true); setMenu(null); }}>编辑</button></>}</footer>
    {context && <div className="bookmark-context-shade" onPointerDown={(event) => { if (event.target === event.currentTarget) setContext(null); }}>
      <div className="bookmark-context" role="menu" aria-label="书签操作" style={{ left: context.x, top: context.y }}>
        <button type="button" role="menuitem" onClick={async () => {
          try { await copyLink(context.item.url); toast.success('链接已复制'); } catch { toast.error('复制失败，请检查浏览器权限'); }
          setContext(null);
        }}>复制链接</button>
        <button type="button" role="menuitem" onClick={() => { setSelected([context.item.id]); setContext(null); setDeleting(true); }}>删除</button>
      </div>
    </div>}
    {dragVisual && <div className="bookmark-drag-mirror" style={{ left: dragVisual.x, top: dragVisual.y, width: dragVisual.width }}><BookmarkImage item={dragVisual.item} /><span>{dragVisual.item.name}</span></div>}
    {(form || deleting || deletingGroup) && <div className="bookmark-shade"><form className="bookmark-sheet" onSubmit={(event) => {
      event.preventDefault();
      if (deleting) { updateBookmarks({ type: 'delete', ids: selectedItems.map((item) => item.id) }); setSelected([]); setDeleting(false); return; }
       if (deletingGroup) { updateBookmarks({ type: 'deleteGroup', id: deletingGroup }); if (group === deletingGroup) setGroup('all'); setDeletingGroup(null); return; }
      if (!name.trim()) return;
      if (form === 'group') {
        if (!updateBookmarks({ type: 'createGroup', id: crypto.randomUUID(), name })) { toast.error('分组名称重复或数量已达上限'); return; }
      } else {
        if (!normalizeHttpUrl(url)) { toast.error('请输入有效的网址'); return; }
        const changed = typeof form === 'object' && form
          ? updateBookmarks({ type: 'update', id: form.id, name, url })
          : updateBookmarks({ type: 'add', item: { id: crypto.randomUUID(), name, url, groupId: group === 'all' ? library.groups[0].id : group } });
        if (!changed) { toast.error('无法保存书签'); return; }
      }
      setForm(null);
    }}>
      <h2>{deletingGroup ? `删除分组“${library.groups.find((entry) => entry.id === deletingGroup)?.name ?? ''}”？书签将移到默认分组。` : deleting ? `删除选中的 ${selectedItems.length} 个书签？` : form === 'group' ? '新建分组' : typeof form === 'object' ? '修改书签' : '添加书签'}</h2>
      {!deleting && !deletingGroup && <><input autoFocus aria-label="名称" placeholder="名称" maxLength={form === 'group' ? 80 : 256} required value={name} onChange={(event) => setName(event.target.value)} />{form !== 'group' && <input aria-label="网址" placeholder="https://" required value={url} onChange={(event) => setUrl(event.target.value)} />}</>}
      <div><button type="button" onClick={() => { setForm(null); setDeleting(false); setDeletingGroup(null); }}>取消</button><button type="submit">{deleting || deletingGroup ? '删除' : '保存'}</button></div>
    </form></div>}
  </div>, document.body);
}
