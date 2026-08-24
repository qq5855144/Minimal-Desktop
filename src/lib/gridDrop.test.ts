import { describe, expect, it } from 'vitest';
import { isNoopGridDrop, resolveCenteredGridDropPosition } from './gridDrop';

const GRID = {
  left: 16,
  top: 100,
  width: 328,
  height: 628,
};

describe('gridDrop', () => {
  it('把命中自身四格或回到原坐标识别为有效的原位放回', () => {
    const source = { id: 'folder', page: 1, row: 2, col: 1 };

    expect(isNoopGridDrop(source, 1, 1, 0, 'folder')).toBe(true);
    expect(isNoopGridDrop(source, 1, 2, 1, null)).toBe(true);
    expect(isNoopGridDrop(source, 1, 2, 2, null)).toBe(false);
    expect(isNoopGridDrop(source, 2, 2, 1, 'folder')).toBe(false);
  });

  it('以四格整体中心解析 2×2 文件夹左上角，而不是采用指针所在单格', () => {
    // 单列 73px、单行 68px、间距 12px；row=2/col=1 的四格中心为 (180, 334)。
    expect(resolveCenteredGridDropPosition(
      180,
      334,
      GRID,
      4,
      8,
      12,
      12,
      2,
      2,
    )).toEqual({ row: 2, col: 1 });
  });

  it('在网格边缘仍将完整 2×2 占位约束在可见行列内', () => {
    expect(resolveCenteredGridDropPosition(
      GRID.left,
      GRID.top,
      GRID,
      4,
      8,
      12,
      12,
      2,
      2,
    )).toEqual({ row: 0, col: 0 });
    expect(resolveCenteredGridDropPosition(
      GRID.left + GRID.width,
      GRID.top + GRID.height,
      GRID,
      4,
      8,
      12,
      12,
      2,
      2,
    )).toEqual({ row: 6, col: 2 });
  });

  it('拒绝无法组成完整占位区域的无效网格几何', () => {
    expect(resolveCenteredGridDropPosition(
      100,
      100,
      GRID,
      1,
      8,
      12,
      12,
      2,
      2,
    )).toBeNull();
    expect(resolveCenteredGridDropPosition(
      100,
      100,
      { ...GRID, width: 0 },
      4,
      8,
      12,
      12,
      2,
      2,
    )).toBeNull();
  });
});
