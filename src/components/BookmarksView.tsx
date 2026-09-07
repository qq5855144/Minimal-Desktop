import { ArrowLeft, Bookmark as BookmarkIcon, GripVertical, Check, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { useDesktop } from '@/contexts/DesktopContext';
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
export default function BookmarksView({ onClose }: { onClose: () => void }) {
  const { data, updateBookmarks } = useDesktop();
  const library = data.bookmarks ?? emptyBookmarks();
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('all');
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [menu, setMenu] = useState<'groups' | 'move' | null>(null);
  const [form, setForm] = useState<'group' | 'bookmark' | Bookmark | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const drag = useRef<{ id: string; target: string | null; after?: boolean } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const items = library.items.filter((item) => (group === 'all' || item.groupId === group) && `${item.name} ${item.url}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selectedItems = library.items.filter((item) => selected.includes(item.id));
  const allSelected = items.length > 0 && items.every((item) => selected.includes(item.id));
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => { if (form || deleting) root.current?.querySelector<HTMLElement>('.bookmark-sheet input, .bookmark-sheet button')?.focus(); }, [form, deleting]);
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
    if (event.key === 'Escape') { event.stopPropagation(); if (form) setForm(null); else if (deleting) setDeleting(false); else if (menu) setMenu(null); else if (editing) finish(); else onClose(); }
    if (event.key === 'Tab') {
      const scope = root.current?.querySelector('.bookmark-sheet') ?? root.current;
      const controls = Array.from(scope?.querySelectorAll<HTMLElement>('button:not(:disabled),input,a[href]') ?? []);
      const first = controls[0]; const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <header><button type="button" aria-label="返回桌面" onClick={onClose}><ArrowLeft /></button><h1>书签</h1>{group !== 'all' && <span>{library.groups.find((entry) => entry.id === group)?.name}</span>}</header>
    <div className="bookmark-search"><input aria-label="搜索书签" placeholder="搜索" value={query} onChange={(event) => { setQuery(event.target.value); setSelected([]); }} /></div>
    <div className="bookmark-list">
      {items.map((item) => <div key={item.id} data-bookmark-id={item.id} className={`bookmark-row ${dragTarget === item.id ? 'bookmark-drop' : ''}`}>
        <button type="button" className="bookmark-link" onClick={() => editing ? toggle(item.id) : openExternalUrl(item.url)} aria-pressed={editing ? selected.includes(item.id) : undefined}>
          <BookmarkImage key={`${item.url}-${item.iconUrl}`} item={item} /><span>{item.name}</span>
        </button>
        {editing && <>
          <button className="bookmark-grip" type="button" aria-label={`调整 ${item.name} 顺序，方向键上移或下移`} onKeyDown={(event) => {
            const index = items.findIndex((entry) => entry.id === item.id);
            if (event.key === 'ArrowUp' && index > 0) { event.preventDefault(); updateBookmarks({ type: 'reorder', id: item.id, beforeId: items[index - 1].id }); }
            if (event.key === 'ArrowDown' && index < items.length - 1) { event.preventDefault(); updateBookmarks({ type: 'reorder', id: items[index + 1].id, beforeId: item.id }); }
          }} onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { id: item.id, target: null }; }} onPointerMove={(event) => {
            if (!drag.current) return;
            const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-bookmark-id]');
            const target = row?.dataset.bookmarkId;
            const bounds = row?.getBoundingClientRect();
            drag.current.after = !!bounds && event.clientY > bounds.top + bounds.height / 2;
            drag.current.target = target && target !== item.id ? target : null; setDragTarget(drag.current.target);
            const list = root.current?.querySelector('.bookmark-list');
            const rect = list?.getBoundingClientRect();
            if (list && rect) { if (event.clientY < rect.top + 40) list.scrollTop -= 16; else if (event.clientY > rect.bottom - 40) list.scrollTop += 16; }
          }} onPointerUp={() => {
            if (drag.current?.target) updateBookmarks({ type: 'reorder', id: drag.current.id, beforeId: drag.current.target, after: drag.current.after });
            drag.current = null; setDragTarget(null);
          }} onPointerCancel={() => { drag.current = null; setDragTarget(null); }}><GripVertical size={20} /></button>
          <button type="button" className="bookmark-select" aria-label={`选择 ${item.name}`} aria-pressed={selected.includes(item.id)} onClick={() => toggle(item.id)}><span>{selected.includes(item.id) && <Check size={17} />}</span></button>
        </>}
      </div>)}
      {!items.length && <p className="bookmark-empty">{query ? '没有匹配的书签' : '暂无书签'}</p>}
    </div>
    {menu && <div className="bookmark-menu">
      <div className="bookmark-menu-title">{menu === 'move' ? '移动到分组' : '分组'}<button type="button" aria-label="关闭菜单" onClick={() => setMenu(null)}><X size={18} /></button></div>
      {menu === 'groups' && <button type="button" onClick={() => { setGroup('all'); setSelected([]); setMenu(null); }}>全部书签{group === 'all' && <Check size={16} />}</button>}
      {library.groups.map((entry) => <button type="button" key={entry.id} onClick={() => {
        if (menu === 'move') { updateBookmarks({ type: 'move', ids: selectedItems.map((item) => item.id), groupId: entry.id }); setSelected([]); }
        else { setGroup(entry.id); setSelected([]); }
        setMenu(null);
      }}>{entry.name}{menu === 'groups' && group === entry.id && <Check size={16} />}</button>)}
      {menu === 'groups' && <><button type="button" onClick={() => openForm('group')}>新建分组</button><button type="button" onClick={() => openForm('bookmark')}>添加书签</button></>}
    </div>}
    <footer>{editing ? <>
      <button type="button" onClick={() => setSelected(allSelected ? [] : items.map((item) => item.id))}>{allSelected ? '取消全选' : '全选'}</button>
      <button type="button" disabled={!selectedItems.length} onClick={() => setMenu(menu === 'move' ? null : 'move')}>移动</button>
      <button type="button" disabled={!selectedItems.length} onClick={() => setDeleting(true)}>删除</button>
      <button type="button" disabled={!selectedItems.length} onClick={openSelected}>打开</button>
      {selectedItems.length === 1 && <button type="button" onClick={() => openForm(selectedItems[0])}>修改</button>}
      <button type="button" onClick={finish}>完成</button>
    </> : <><button type="button" onClick={() => setMenu(menu === 'groups' ? null : 'groups')}>更多</button><button type="button" onClick={() => { setEditing(true); setMenu(null); }}>编辑</button></>}</footer>
    {(form || deleting) && <div className="bookmark-shade"><form className="bookmark-sheet" onSubmit={(event) => {
      event.preventDefault();
      if (deleting) { updateBookmarks({ type: 'delete', ids: selectedItems.map((item) => item.id) }); setSelected([]); setDeleting(false); return; }
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
      <h2>{deleting ? `删除选中的 ${selectedItems.length} 个书签？` : form === 'group' ? '新建分组' : typeof form === 'object' ? '修改书签' : '添加书签'}</h2>
      {!deleting && <><input autoFocus aria-label="名称" placeholder="名称" maxLength={form === 'group' ? 80 : 256} required value={name} onChange={(event) => setName(event.target.value)} />{form !== 'group' && <input aria-label="网址" placeholder="https://" required value={url} onChange={(event) => setUrl(event.target.value)} />}</>}
      <div><button type="button" onClick={() => { setForm(null); setDeleting(false); }}>取消</button><button type="submit">{deleting ? '删除' : '保存'}</button></div>
    </form></div>}
  </div>, document.body);
}
