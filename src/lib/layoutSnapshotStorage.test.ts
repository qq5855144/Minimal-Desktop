import { describe, expect, it } from 'vitest';
import type { DesktopData } from '@/types';
import { createLayoutSnapshot } from './layoutSnapshotStorage';

describe('createLayoutSnapshot', () => {
  it('keeps layout data but strips all privacy fields', () => {
    const data: DesktopData = {
      version: 4,
      pages: [[]],
      privacyVault: { v: 3, salt: 'AA==', iv: 'AA==', ct: 'AA==', iterations: 600_000 },
      privacyItems: [],
      pinHash: 'legacy',
    };

    const snapshot = createLayoutSnapshot('  工作布局  ', data, { cols: 5, rows: 9 });

    expect(snapshot.name).toBe('工作布局');
    expect(snapshot.cols).toBe(5);
    expect(snapshot.rows).toBe(9);
    expect(snapshot.data).toEqual({ version: 4, pages: [[]] });
    expect(snapshot.data).not.toHaveProperty('privacyVault');
    expect(snapshot.data).not.toHaveProperty('privacyItems');
    expect(snapshot.data).not.toHaveProperty('pinHash');
  });
});
