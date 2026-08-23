import { deepClone } from '@/lib/utils/deepClone';
import type { DesktopItem } from '@/types';
import {
  canPlaceItem,
  compactPrivacyPages,
  findItemCoveringCell,
  findFirstAvailablePrivacySlot,
  getPrivacyPageCount,
  isItemWithinBounds,
  LAYOUT_LIMITS,
} from './layoutEngine';

export interface PrivacyWorkspaceMutation {
  ok: boolean;
  items: DesktopItem[];
}

function positionItem(
  item: DesktopItem,
  page: number,
  row: number,
  col: number,
): DesktopItem {
  return {
    ...item,
    page,
    row,
    col,
    children: item.children?.map((child) => ({ ...child, page, row, col })),
  };
}

function collapseFolder(items: DesktopItem[], folderId: string): void {
  const folderIndex = items.findIndex((item) => item.id === folderId);
  if (folderIndex < 0) return;
  const folder = items[folderIndex];
  if (folder.type !== 'folder' || !folder.children) return;
  if (folder.children.length === 0) {
    items.splice(folderIndex, 1);
  } else if (folder.children.length === 1) {
    items[folderIndex] = positionItem(
      folder.children[0],
      folder.page,
      folder.row,
      folder.col,
    );
  }
}

/** 隐私桌面内悬停合并：支持顶层应用或文件夹子项加入/创建文件夹。 */
export function mergePrivacyItemsToFolder(
  privacyItems: DesktopItem[],
  sourceId: string,
  targetId: string,
  createFolderId: () => string,
  sourceFolderId?: string,
): PrivacyWorkspaceMutation {
  const next = deepClone(privacyItems);
  const targetIndex = next.findIndex((item) => item.id === targetId);
  if (targetIndex < 0) return { ok: false, items: privacyItems };
  const target = next[targetIndex];
  let source: DesktopItem | null = null;
  let sourceIndex = -1;
  let sourceFolder: DesktopItem | null = null;
  let sourceChildIndex = -1;

  if (sourceFolderId) {
    sourceFolder = next.find((item) => item.id === sourceFolderId) ?? null;
    sourceChildIndex = sourceFolder?.children?.findIndex((child) => child.id === sourceId) ?? -1;
    if (sourceChildIndex >= 0) source = sourceFolder?.children?.[sourceChildIndex] ?? null;
  } else {
    sourceIndex = next.findIndex((item) => item.id === sourceId);
    if (sourceIndex >= 0) source = next[sourceIndex];
  }

  if (!source || source.type !== 'app') return { ok: false, items: privacyItems };
  if (target.type !== 'app' && target.type !== 'folder') {
    return { ok: false, items: privacyItems };
  }
  if (sourceFolderId && target.id === sourceFolderId) {
    return { ok: false, items: privacyItems };
  }
  if (target.type === 'folder' && (target.children?.length ?? 0) >= LAYOUT_LIMITS.maxFolderApps) {
    return { ok: false, items: privacyItems };
  }

  if (sourceFolder && sourceChildIndex >= 0) {
    source = sourceFolder.children!.splice(sourceChildIndex, 1)[0];
  }
  if (target.type === 'folder' && target.children) {
    target.children.push(positionItem(source, target.page, target.row, target.col));
    if (sourceFolderId) collapseFolder(next, sourceFolderId);
    else next.splice(sourceIndex, 1);
    return { ok: true, items: compactPrivacyPages(next).items };
  }

  next[targetIndex] = {
    id: createFolderId(),
    type: 'folder',
    name: '文件夹',
    color: 'gray',
    page: target.page,
    row: target.row,
    col: target.col,
    children: [
      positionItem(target, target.page, target.row, target.col),
      positionItem(source, target.page, target.row, target.col),
    ],
  };
  if (sourceFolderId) collapseFolder(next, sourceFolderId);
  else next.splice(sourceIndex, 1);
  return { ok: true, items: compactPrivacyPages(next).items };
}

/** 从隐私文件夹拖出子项，支持空槽、交换以及加入另一文件夹。 */
export function movePrivacyFolderChild(
  privacyItems: DesktopItem[],
  folderId: string,
  childId: string,
  toPage: number,
  row: number,
  col: number,
  cols: number,
  rows: number,
): PrivacyWorkspaceMutation {
  const pageCount = getPrivacyPageCount(privacyItems);
  if (
    !Number.isInteger(toPage)
    || toPage >= 0
    || toPage < -LAYOUT_LIMITS.maxPages
    || toPage < -(pageCount + 1)
    || !Number.isInteger(row)
    || !Number.isInteger(col)
  ) return { ok: false, items: privacyItems };

  const next = deepClone(privacyItems);
  const folder = next.find((item) => item.id === folderId);
  if (!folder?.children) return { ok: false, items: privacyItems };
  const childIndex = folder.children.findIndex((child) => child.id === childId);
  if (childIndex < 0) return { ok: false, items: privacyItems };
  const child = folder.children[childIndex];
  if (!isItemWithinBounds(child, row, col, cols, rows)) {
    return { ok: false, items: privacyItems };
  }
  const target = findItemCoveringCell(
    next.filter((item) => item.page === toPage),
    row,
    col,
    cols,
  );
  const targetIndex = target ? next.findIndex((item) => item.id === target.id) : -1;
  if (targetIndex >= 0 && next[targetIndex].id === folderId) {
    return { ok: false, items: privacyItems };
  }
  if (
    targetIndex >= 0
    && next[targetIndex].type === 'folder'
    && (next[targetIndex].children?.length ?? 0) >= LAYOUT_LIMITS.maxFolderApps
  ) return { ok: false, items: privacyItems };
  if (
    targetIndex < 0
    && !canPlaceItem(
      next.filter((item) => item.page === toPage),
      child,
      row,
      col,
      cols,
      rows,
    )
  ) return { ok: false, items: privacyItems };

  folder.children.splice(childIndex, 1);
  if (targetIndex >= 0) {
    const target = next[targetIndex];
    if (target.type === 'folder' && target.children) {
      target.children.push(positionItem(child, target.page, target.row, target.col));
      collapseFolder(next, folderId);
      return { ok: true, items: compactPrivacyPages(next).items };
    }
    folder.children.push(positionItem(target, folder.page, folder.row, folder.col));
    next.splice(targetIndex, 1);
  }
  next.push(positionItem(child, toPage, row, col));
  collapseFolder(next, folderId);
  return { ok: true, items: compactPrivacyPages(next).items };
}

/** 解散隐私文件夹并稳定放置全部子项；空间不足时原操作不生效。 */
export function dissolvePrivacyFolder(
  privacyItems: DesktopItem[],
  folderId: string,
  cols: number,
  rows: number,
): PrivacyWorkspaceMutation {
  const next = deepClone(privacyItems);
  const folderIndex = next.findIndex((item) => item.id === folderId);
  if (folderIndex < 0) return { ok: false, items: privacyItems };
  const folder = next[folderIndex];
  if (folder.type !== 'folder') return { ok: false, items: privacyItems };
  next.splice(folderIndex, 1);
  for (const child of folder.children ?? []) {
    const slot = findFirstAvailablePrivacySlot(next, child, cols, rows, folder.page);
    if (!slot) return { ok: false, items: privacyItems };
    next.push(positionItem(child, slot.page, slot.row, slot.col));
  }
  return { ok: true, items: compactPrivacyPages(next).items };
}
