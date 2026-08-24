import { describe, expect, it } from 'vitest';
import type { DesktopItem } from '@/types';
import {
  resolveFolderChildVisualKind,
  SYSTEM_GLYPH_SCALE,
  SYSTEM_GLYPH_STROKE_WIDTH,
} from './iconPresentation';

const syncItem: DesktopItem = {
  id: 'sys-sync',
  type: 'system',
  name: '同步',
  color: 'indigo',
  page: 0,
  row: 0,
  col: 0,
};

describe('iconPresentation', () => {
  it('同步入口移入文件夹后仍优先使用原系统图案', () => {
    expect(resolveFolderChildVisualKind(syncItem, false)).toBe('system');
    expect(resolveFolderChildVisualKind({ ...syncItem, iconUrl: 'cached-icon.png' }, true))
      .toBe('system');
  });

  it('桌面与文件夹使用相同的系统图标比例和线宽', () => {
    expect(SYSTEM_GLYPH_SCALE).toBe(0.5);
    expect(SYSTEM_GLYPH_STROKE_WIDTH).toBe(2);
  });
});
