import { describe, expect, it } from 'vitest';
import type { DesktopData, DesktopItem } from '@/types';
import { summarizeDesktopDiff } from './desktopDiff';

const app = (id: string, row = 0, name = id): DesktopItem => ({
  id, type: 'app', name, color: 'blue', page: 0, row, col: 0, url: `https://${id}.example`,
});

describe('summarizeDesktopDiff', () => {
  it('reports additions, removals, moves and edits separately', () => {
    const current: DesktopData = { version: 4, pages: [[app('a'), app('b', 1), app('gone', 2)]] };
    const incoming: DesktopData = {
      version: 4,
      pages: [[app('a', 3), app('b', 1, 'renamed'), app('new', 2)]],
      privacyVault: { v: 3, salt: 'AA==', iv: 'AA==', ct: 'AA==', iterations: 600_000 },
    };

    expect(summarizeDesktopDiff(current, incoming)).toMatchObject({
      added: 1,
      removed: 1,
      moved: 1,
      changed: 1,
      hasPrivacyVault: true,
      backupVersion: 4,
    });
  });

  it('treats folder child reordering as movement', () => {
    const folder = (children: DesktopItem[]): DesktopItem => ({
      id: 'folder', type: 'folder', name: 'Folder', color: 'gray', page: 0, row: 0, col: 0, children,
    });
    const a = app('a');
    const b = app('b');
    const current: DesktopData = { version: 4, pages: [[folder([a, b])]] };
    const incoming: DesktopData = { version: 4, pages: [[folder([b, a])]] };

    expect(summarizeDesktopDiff(current, incoming).moved).toBe(2);
  });
});
