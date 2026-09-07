import { normalizeHttpUrl } from './urlSafety';
export interface Bookmark { id: string; name: string; url: string; iconUrl?: string; groupId: string }
export interface BookmarkGroup { id: string; name: string }
export interface BookmarkCollection { groups: BookmarkGroup[]; items: Bookmark[] }
export const emptyBookmarks = (): BookmarkCollection => ({ groups: [{ id: 'default', name: '默认分组' }], items: [] });
export type BookmarkAction =
  | { type: 'add'; item: Bookmark }
  | { type: 'update'; id: string; name: string; url: string }
  | { type: 'delete'; ids: string[] }
  | { type: 'move'; ids: string[]; groupId: string }
  | { type: 'reorder'; id: string; beforeId: string; after?: boolean }
  | { type: 'createGroup'; id: string; name: string };
export function changeBookmarks(current: BookmarkCollection | undefined, action: BookmarkAction): BookmarkCollection {
  const state = current ?? emptyBookmarks();
  const selected = new Set('ids' in action ? action.ids : []);
  switch (action.type) {
    case 'add': {
      const url = normalizeHttpUrl(action.item.url);
      if (!url || !action.item.name.trim() || state.items.length >= 10000 || state.items.some((item) => item.id === action.item.id)) return state;
      const groupId = state.groups.some((group) => group.id === action.item.groupId) ? action.item.groupId : state.groups[0].id;
      return { ...state, items: [...state.items, { ...action.item, url, name: action.item.name.trim().slice(0, 256), groupId }] };
    }
    case 'update': {
      const url = normalizeHttpUrl(action.url);
      if (!url || !action.name.trim()) return state;
      return { ...state, items: state.items.map((item) => item.id === action.id ? { ...item, name: action.name.trim().slice(0, 256), url, iconUrl: item.url === url ? item.iconUrl : undefined } : item) };
    }
    case 'delete': return { ...state, items: state.items.filter((item) => !selected.has(item.id)) };
    case 'move':
      if (!state.groups.some((group) => group.id === action.groupId)) return state;
      return { ...state, items: state.items.map((item) => selected.has(item.id) ? { ...item, groupId: action.groupId } : item) };
    case 'reorder': {
      const moving = state.items.find((item) => item.id === action.id);
      if (!moving || action.id === action.beforeId || !state.items.some((item) => item.id === action.beforeId)) return state;
      const items = state.items.filter((item) => item.id !== action.id);
      items.splice(items.findIndex((item) => item.id === action.beforeId) + (action.after ? 1 : 0), 0, moving);
      return { ...state, items };
    }
    case 'createGroup': {
      const name = action.name.trim().slice(0, 80);
      if (!name || state.groups.length >= 100 || state.groups.some((group) => group.id === action.id || group.name === name)) return state;
      return { ...state, groups: [...state.groups, { id: action.id, name }] };
    }
  }
}
