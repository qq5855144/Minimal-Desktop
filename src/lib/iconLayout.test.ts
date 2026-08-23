import { describe, expect, it } from 'vitest';
import {
  DESKTOP_GRID_GAP_PX,
  getDesktopGridLayoutMetrics,
  getIconLayoutMetrics,
  getLargeFolderLayoutMetrics,
} from './iconLayout';

describe('iconLayout', () => {
  it('2×2 文件夹以两行可用高度生成严格正方形并保持名称基线', () => {
    const grid = getDesktopGridLayoutMetrics(360, 4, 46);
    const icon = getIconLayoutMetrics('normal', grid.iconPx, 25);
    const folder = getLargeFolderLayoutMetrics(icon, grid.columnWidthPx);
    const twoRowHeight = icon.cellMinHeightPx * 2 + DESKTOP_GRID_GAP_PX;

    expect(folder.sidePx).toBe(126);
    expect(folder.radius).toBe('12%');
    expect(folder.totalHeightPx).toBe(twoRowHeight);
    expect(folder.sidePx + icon.labelGapPx + icon.labelHeightPx).toBe(twoRowHeight);
  });

  it('3×3 缩略图四周、行间和列间使用完全相等的间距单元', () => {
    const grid = getDesktopGridLayoutMetrics(360, 4, 46);
    const icon = getIconLayoutMetrics('normal', grid.iconPx, 25);
    const folder = getLargeFolderLayoutMetrics(icon, grid.columnWidthPx);

    // 无边线：3 个缩略图 + 左右及两个内部间隔，精确还原正方形边长。
    expect(folder.previewCellPx * 3 + folder.spacingPx * 4)
      .toBeCloseTo(folder.sidePx, 8);
    expect(folder.previewCellPx).toBe(folder.spacingPx * 4);
    expect(folder.previewCellPx).toBeGreaterThan(icon.folderPreviewCellPx);
  });

  it('应用视图的图标大小、圆角和列数会联动文件夹尺寸', () => {
    const fourColumns = getDesktopGridLayoutMetrics(360, 4, 64);
    const fiveColumns = getDesktopGridLayoutMetrics(360, 5, 64);
    const smallIcon = getIconLayoutMetrics('normal', 36, 10);
    const largeIcon = getIconLayoutMetrics('normal', fourColumns.iconPx, 40);
    const smallFolder = getLargeFolderLayoutMetrics(smallIcon, fourColumns.columnWidthPx);
    const fourColumnFolder = getLargeFolderLayoutMetrics(largeIcon, fourColumns.columnWidthPx);
    const fiveColumnIcon = getIconLayoutMetrics('normal', fiveColumns.iconPx, 40);
    const fiveColumnFolder = getLargeFolderLayoutMetrics(
      fiveColumnIcon,
      fiveColumns.columnWidthPx,
    );

    expect(largeIcon.iconRadius).toBe('40%');
    expect(smallIcon.iconRadius).toBe('10%');
    expect(fourColumnFolder.radius).toBe('12%');
    expect(fiveColumnFolder.radius).toBe('12%');
    expect(fourColumnFolder.sidePx).toBeGreaterThan(smallFolder.sidePx);
    expect(fiveColumns.iconPx).toBeLessThan(fourColumns.iconPx);
    expect(fiveColumnFolder.sidePx).toBeLessThan(fourColumnFolder.sidePx);
    expect(fiveColumnFolder.sidePx).toBeLessThanOrEqual(
      fiveColumns.columnWidthPx * 2 + DESKTOP_GRID_GAP_PX,
    );
  });
});
