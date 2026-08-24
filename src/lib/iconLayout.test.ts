import { describe, expect, it } from 'vitest';
import {
  DESKTOP_GRID_GAP_PX,
  getDesktopGridLayoutMetrics,
  getIconLayoutMetrics,
  getLargeFolderLayoutMetrics,
} from './iconLayout';

describe('iconLayout', () => {
  it('2×2 文件夹以两行可用高度生成严格正方形并保持名称基线', () => {
    const grid = getDesktopGridLayoutMetrics(360, 4, 46, 800, 8);
    const icon = getIconLayoutMetrics('normal', grid.iconPx, 25);
    const folder = getLargeFolderLayoutMetrics(icon, grid);
    const twoRowHeight = grid.rowHeightPx * 2 + grid.rowGapPx;

    expect(folder.sidePx).toBe(126);
    expect(folder.radius).toBe('12%');
    expect(folder.totalHeightPx).toBe(twoRowHeight);
    expect(folder.sidePx + icon.labelGapPx + icon.labelHeightPx).toBe(twoRowHeight);
  });

  it('3×3 缩略图四周、行间和列间使用完全相等的间距单元', () => {
    const grid = getDesktopGridLayoutMetrics(360, 4, 46, 800, 8);
    const icon = getIconLayoutMetrics('normal', grid.iconPx, 25);
    const folder = getLargeFolderLayoutMetrics(icon, grid);

    // 无边线：3 个缩略图 + 左右及两个内部间隔，精确还原正方形边长。
    expect(folder.previewCellPx * 3 + folder.spacingPx * 4)
      .toBeCloseTo(folder.sidePx, 8);
    expect(folder.previewCellPx).toBe(folder.spacingPx * 4);
    expect(folder.previewCellPx).toBeGreaterThan(icon.folderPreviewCellPx);
  });

  it('应用视图的图标大小、圆角和列数会联动文件夹尺寸', () => {
    const fourColumns = getDesktopGridLayoutMetrics(360, 4, 64, 800, 8);
    const fiveColumns = getDesktopGridLayoutMetrics(360, 5, 64, 800, 8);
    const smallGrid = getDesktopGridLayoutMetrics(360, 4, 36, 800, 8);
    const smallIcon = getIconLayoutMetrics('normal', smallGrid.iconPx, 10);
    const largeIcon = getIconLayoutMetrics('normal', fourColumns.iconPx, 40);
    const smallFolder = getLargeFolderLayoutMetrics(smallIcon, smallGrid);
    const fourColumnFolder = getLargeFolderLayoutMetrics(largeIcon, fourColumns);
    const fiveColumnIcon = getIconLayoutMetrics('normal', fiveColumns.iconPx, 40);
    const fiveColumnFolder = getLargeFolderLayoutMetrics(
      fiveColumnIcon,
      fiveColumns,
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

  it('电脑端 2×2 文件夹在四格占位内与两行应用图标上下对称', () => {
    const grid = getDesktopGridLayoutMetrics(1440, 8, 46, 900, 8);
    const icon = getIconLayoutMetrics('normal', grid.iconPx, 25);
    const folder = getLargeFolderLayoutMetrics(icon, grid);

    expect(grid.isWide).toBe(true);
    expect(grid.iconPx).toBe(46);
    expect(grid.columnGapPx).toBe(16);
    expect(grid.rowGapPx).toBe(16);
    expect(folder.sidePx).toBeCloseTo(
      grid.rowHeightPx + grid.rowGapPx + grid.iconPx,
      8,
    );
    const appTopInsetPx = grid.rowHeightPx - icon.cellMinHeightPx;
    const folderTopInsetPx = grid.rowHeightPx * 2 + grid.rowGapPx
      - folder.totalHeightPx;
    expect(folderTopInsetPx).toBeCloseTo(appTopInsetPx, 8);
    expect(folder.sidePx).toBeLessThan(
      grid.columnWidthPx * 2 + grid.columnGapPx,
    );
  });

  it('电脑端支持 10 列且会按每页行数收紧密度，不缩小用户指定图标', () => {
    const eightRows = getDesktopGridLayoutMetrics(1440, 10, 46, 900, 8);
    const tenRows = getDesktopGridLayoutMetrics(1440, 10, 46, 900, 10);

    expect(eightRows.contentWidthPx).toBeLessThanOrEqual(1080);
    expect(eightRows.columnWidthPx).toBeGreaterThan(eightRows.iconPx);
    expect(eightRows.iconPx).toBe(46);
    expect(tenRows.iconPx).toBe(46);
    expect(tenRows.columnGapPx).toBe(14);
    expect(tenRows.rowHeightPx).toBeLessThan(eightRows.rowHeightPx);
  });
});
