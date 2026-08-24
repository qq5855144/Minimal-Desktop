export interface GridDropRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface GridDropPosition {
  row: number;
  col: number;
}

export interface GridDropSourcePosition extends GridDropPosition {
  id: string;
  page: number;
}

/** 命中拖拽源自身，或解析后仍是原坐标时，属于有效的原位放回。 */
export function isNoopGridDrop(
  source: GridDropSourcePosition,
  targetPage: number,
  targetRow: number,
  targetCol: number,
  targetItemId?: string | null,
): boolean {
  if (source.page !== targetPage) return false;
  return targetItemId === source.id
    || (source.row === targetRow && source.col === targetCol);
}

/**
 * 将拖拽对象的视觉中心吸附到其完整网格占位区域中心。
 *
 * 例如 2×2 文件夹不能把指针所在单格当作左上角；应比较指针（ghost 中心）
 * 与每个合法四格区域的几何中心，再反推出该区域的左上角 row/col。
 */
export function resolveCenteredGridDropPosition(
  clientX: number,
  clientY: number,
  gridRect: GridDropRect,
  columnCount: number,
  rowCount: number,
  columnGapPx: number,
  rowGapPx: number,
  columnSpan: number,
  rowSpan: number,
): GridDropPosition | null {
  const values = [
    clientX,
    clientY,
    gridRect.left,
    gridRect.top,
    gridRect.width,
    gridRect.height,
    columnGapPx,
    rowGapPx,
  ];
  if (
    values.some((value) => !Number.isFinite(value))
    || gridRect.width <= 0
    || gridRect.height <= 0
    || columnGapPx < 0
    || rowGapPx < 0
    || !Number.isInteger(columnCount)
    || !Number.isInteger(rowCount)
    || !Number.isInteger(columnSpan)
    || !Number.isInteger(rowSpan)
    || columnCount <= 0
    || rowCount <= 0
    || columnSpan <= 0
    || rowSpan <= 0
    || columnSpan > columnCount
    || rowSpan > rowCount
  ) {
    return null;
  }

  const columnWidth = (
    gridRect.width - columnGapPx * (columnCount - 1)
  ) / columnCount;
  const rowHeight = (
    gridRect.height - rowGapPx * (rowCount - 1)
  ) / rowCount;
  if (columnWidth <= 0 || rowHeight <= 0) return null;

  const columnStride = columnWidth + columnGapPx;
  const rowStride = rowHeight + rowGapPx;
  const occupiedWidth = columnWidth * columnSpan + columnGapPx * (columnSpan - 1);
  const occupiedHeight = rowHeight * rowSpan + rowGapPx * (rowSpan - 1);
  const rawCol = Math.round(
    (clientX - gridRect.left - occupiedWidth / 2) / columnStride,
  );
  const rawRow = Math.round(
    (clientY - gridRect.top - occupiedHeight / 2) / rowStride,
  );

  return {
    row: Math.max(0, Math.min(rowCount - rowSpan, rawRow)),
    col: Math.max(0, Math.min(columnCount - columnSpan, rawCol)),
  };
}
