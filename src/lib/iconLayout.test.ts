import { describe, expect, it } from 'vitest';
import {
  DESKTOP_GRID_GAP_PX,
  getDesktopGridLayoutMetrics,
  getExpandedFolderLayoutMetrics,
  getIconLayoutMetrics,
  getLargeFolderLayoutMetrics,
} from './iconLayout';

describe('iconLayout', () => {
  it('2×2 文件夹与相邻两列普通应用图标的左右边缘严格对齐', () => {
    const grid = getDesktopGridLayoutMetrics(360, 4, 46, 800, 8);
    const icon = getIconLayoutMetrics('normal', grid.iconPx, 25);
    const folder = getLargeFolderLayoutMetrics(icon, grid);
    const adjacentIconOuterWidth = grid.columnWidthPx + grid.columnGapPx + icon.iconPx;

    expect(folder.sidePx).toBe(132);
    expect(folder.radius).toBe('12%');
    expect(folder.sidePx).toBeCloseTo(adjacentIconOuterWidth, 8);
    expect(folder.sidePx).toBeCloseTo(
      grid.rowHeightPx + grid.rowGapPx + icon.iconPx,
      8,
    );
    expect(folder.totalHeightPx).toBe(folder.sidePx + icon.labelGapPx + icon.labelHeightPx);
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

  it.each([
    ['1x2', 1, 3],
    ['2x1', 3, 1],
  ] as const)('%s 文件夹按指定方向排列三个缩略图', (layout, rows, cols) => {
    const grid = getDesktopGridLayoutMetrics(360, 4, 46, 800, 8);
    const icon = getIconLayoutMetrics('normal', grid.iconPx, 25);
    const large = getLargeFolderLayoutMetrics(icon, grid);
    const folder = getExpandedFolderLayoutMetrics(layout, icon, large);

    expect(folder.previewRows).toBe(rows);
    expect(folder.previewCols).toBe(cols);
    expect(folder.widthPx).toBe(layout === '1x2' ? large.sidePx : icon.iconPx);
    expect(folder.heightPx).toBe(layout === '2x1' ? large.sidePx : icon.iconPx);
    expect(folder.radius).toBe(`${Math.round(icon.iconPx * 0.3 * 100) / 100}px`);
    expect(
      folder.previewCols * folder.previewCellPx
        + (folder.previewCols - 1) * folder.columnGapPx
        + folder.paddingXPx * 2,
    ).toBeCloseTo(folder.widthPx, 8);
    expect(
      folder.previewRows * folder.previewCellPx
        + (folder.previewRows - 1) * folder.rowGapPx
        + folder.paddingYPx * 2,
    ).toBeCloseTo(folder.heightPx, 8);
  });

  it('1×2 与 2×1 使用基于短边的等半径圆角且受尺寸上下限保护', () => {
    const normalGrid = getDesktopGridLayoutMetrics(360, 4, 46, 800, 8);
    const normalIcon = getIconLayoutMetrics('normal', normalGrid.iconPx, 25);
    const normalLarge = getLargeFolderLayoutMetrics(normalIcon, normalGrid);
    const horizontal = getExpandedFolderLayoutMetrics('1x2', normalIcon, normalLarge);
    const vertical = getExpandedFolderLayoutMetrics('2x1', normalIcon, normalLarge);
    expect(horizontal.radius).toBe(vertical.radius);
    expect(horizontal.radius).toBe('13.8px');

    const tinyIcon = getIconLayoutMetrics('normal', 24, 25);
    const tinyLarge = getLargeFolderLayoutMetrics(tinyIcon, {
      columnWidthPx: 40,
      columnGapPx: 12,
    });
    expect(getExpandedFolderLayoutMetrics('1x2', tinyIcon, tinyLarge).radius).toBe('10px');

    const hugeIcon = getIconLayoutMetrics('normal', 96, 25);
    const hugeLarge = getLargeFolderLayoutMetrics(hugeIcon, {
      columnWidthPx: 120,
      columnGapPx: 20,
    });
    expect(getExpandedFolderLayoutMetrics('2x1', hugeIcon, hugeLarge).radius).toBe('20px');
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
    expect(fiveColumnFolder.sidePx).toBeCloseTo(
      fiveColumns.columnWidthPx + DESKTOP_GRID_GAP_PX + fiveColumns.iconPx,
      8,
    );
  });

  it.each([
    [360, 4, 36],
    [360, 4, 46],
    [360, 4, 64],
    [360, 5, 36],
    [360, 5, 64],
    [1440, 6, 36],
    [1440, 8, 46],
    [1440, 10, 64],
  ])('在 %ipx/%i 列/%ipx 图标下保持文件夹四边对齐', (width, cols, iconPx) => {
    const grid = getDesktopGridLayoutMetrics(width, cols, iconPx, 900, 8);
    const icon = getIconLayoutMetrics('normal', grid.iconPx, 25);
    const folder = getLargeFolderLayoutMetrics(icon, grid);
    const horizontalOuterEdgeSpan = grid.columnWidthPx + grid.columnGapPx + icon.iconPx;
    const verticalOuterEdgeSpan = grid.rowHeightPx + grid.rowGapPx + icon.iconPx;

    expect(grid.rowHeightPx).toBeCloseTo(grid.columnWidthPx, 8);
    expect(grid.rowGapPx).toBe(grid.columnGapPx);
    expect(folder.sidePx).toBeCloseTo(horizontalOuterEdgeSpan, 8);
    expect(folder.sidePx).toBeCloseTo(verticalOuterEdgeSpan, 8);
    expect(icon.cellMinHeightPx).toBeLessThanOrEqual(
      grid.rowHeightPx + grid.rowGapPx,
    );
  });

  it('电脑端 2×2 文件夹同样以普通应用的实际图标边缘为横向锚点', () => {
    const grid = getDesktopGridLayoutMetrics(1440, 8, 46, 900, 8);
    const icon = getIconLayoutMetrics('normal', grid.iconPx, 25);
    const folder = getLargeFolderLayoutMetrics(icon, grid);

    expect(grid.isWide).toBe(true);
    expect(grid.iconPx).toBe(46);
    expect(grid.columnGapPx).toBe(16);
    expect(grid.rowGapPx).toBe(16);
    expect(folder.sidePx).toBeCloseTo(
      grid.columnWidthPx + grid.columnGapPx + grid.iconPx,
      8,
    );
    expect(folder.sidePx).toBeCloseTo(
      grid.rowHeightPx + grid.rowGapPx + grid.iconPx,
      8,
    );
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
