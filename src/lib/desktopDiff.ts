import type { DesktopData, DesktopItem } from '@/types';

interface FlatItem {
  id: string;
  parentId: string | null;
  type: DesktopItem['type'];
  name: string;
  url?: string;
  iconUrl?: string;
  iconCrop?: DesktopItem['iconCrop'];
  color: DesktopItem['color'];
  widgetType?: DesktopItem['widgetType'];
  childOrder: number | null;
  page: number;
  row: number;
  col: number;
}

export interface DesktopDiffSummary {
  beforePages: number;
  afterPages: number;
  beforeItems: number;
  afterItems: number;
  added: number;
  removed: number;
  moved: number;
  changed: number;
  backupVersion: number;
  hasPrivacyVault: boolean;
}

function flatten(data: DesktopData): Map<string, FlatItem> {
  const items = new Map<string, FlatItem>();
  const visit = (item: DesktopItem, parentId: string | null, childOrder: number | null) => {
    items.set(item.id, {
      id: item.id,
      parentId,
      type: item.type,
      name: item.name,
      url: item.url,
      iconUrl: item.iconUrl,
      iconCrop: item.iconCrop,
      color: item.color,
      widgetType: item.widgetType,
      childOrder,
      page: item.page,
      row: item.row,
      col: item.col,
    });
    item.children?.forEach((child, index) => visit(child, item.id, index));
  };
  data.pages.forEach((page) => page.forEach((item) => visit(item, null, null)));
  return items;
}

function contentKey(item: FlatItem): string {
  return JSON.stringify([
    item.type, item.name, item.url ?? '', item.iconUrl ?? '', item.iconCrop ?? null,
    item.color, item.widgetType ?? '',
  ]);
}

export function summarizeDesktopDiff(current: DesktopData, incoming: DesktopData): DesktopDiffSummary {
  const before = flatten(current);
  const after = flatten(incoming);
  let added = 0;
  let removed = 0;
  let moved = 0;
  let changed = 0;

  for (const [id, item] of after) {
    const previous = before.get(id);
    if (!previous) {
      added += 1;
      continue;
    }
    if (
      previous.parentId !== item.parentId
      || previous.childOrder !== item.childOrder
      || previous.page !== item.page
      || previous.row !== item.row
      || previous.col !== item.col
    ) moved += 1;
    if (contentKey(previous) !== contentKey(item)) changed += 1;
  }
  for (const id of before.keys()) {
    if (!after.has(id)) removed += 1;
  }

  return {
    beforePages: current.pages.length,
    afterPages: incoming.pages.length,
    beforeItems: before.size,
    afterItems: after.size,
    added,
    removed,
    moved,
    changed,
    backupVersion: incoming.version,
    hasPrivacyVault: Boolean(incoming.privacyVault),
  };
}
