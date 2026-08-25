import { describe, expect, it } from 'vitest';
import type { DesktopItem } from '@/types';
import {
  canOpenFolderChildDirectly,
  getFolderPreviewGrid,
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

  it('按文件夹布局解析缩略图行列', () => {
    expect(getFolderPreviewGrid('1x1')).toEqual({ rows: 2, cols: 2 });
    expect(getFolderPreviewGrid('1x2')).toEqual({ rows: 1, cols: 3 });
    expect(getFolderPreviewGrid('2x1')).toEqual({ rows: 3, cols: 1 });
    expect(getFolderPreviewGrid('2x2')).toEqual({ rows: 3, cols: 3 });
  });

  it('仅扩展布局中的网站应用缩略图允许直接打开', () => {
    const app: DesktopItem = {
      ...syncItem,
      id: 'app',
      type: 'app',
      url: 'https://example.com',
    };
    expect(canOpenFolderChildDirectly('1x1', app)).toBe(false);
    expect(canOpenFolderChildDirectly('1x2', app)).toBe(true);
    expect(canOpenFolderChildDirectly('2x1', app)).toBe(true);
    expect(canOpenFolderChildDirectly('2x2', app)).toBe(true);
    expect(canOpenFolderChildDirectly('2x2', syncItem)).toBe(false);
    expect(canOpenFolderChildDirectly('2x2', { ...app, url: undefined })).toBe(false);
  });
});
