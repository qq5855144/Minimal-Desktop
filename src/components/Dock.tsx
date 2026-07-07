import React from 'react';
import { useDesktop } from '@/contexts/DesktopContext';
import type { DesktopItem } from '@/types';
import AppIcon from './AppIcon';
import SkeletonIcon from './SkeletonIcon';

const Dock: React.FC<{
  onDragBegin: (item: DesktopItem, x: number, y: number) => void;
  onLongPress: (item: DesktopItem, x: number, y: number) => void;
  onDeleteItem: (id: string) => void;
}> = ({ onDragBegin, onLongPress, onDeleteItem }) => {
  const { data, loading } = useDesktop();

  return (
    <div className="flex justify-center px-4 pb-4 md:pb-6">
      <div className="glass rounded-[28px] px-3 py-2 md:px-4 md:py-3 flex items-end gap-2 md:gap-3 max-w-md w-full justify-center">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonIcon key={`dock-sk-${i}`} size="small" />)
        ) : data.dock.length === 0 ? (
          <p className="text-white/50 text-xs py-4">长按图标拖到此处添加到 Dock</p>
        ) : (
          <>
            {data.dock.map((item) => (
              <div key={item.id} data-cell="1" data-row={-1} data-col={-1} data-page={-1} data-itemid={item.id}>
                <AppIcon
                  item={item}
                  size="small"
                  onLongPress={(x, y) => onLongPress(item, x, y)}
                  onDragBegin={(it, x, y) => onDragBegin(it, x, y)}
                  onDeleteInEditMode={(id) => onDeleteItem(id)}
                />
              </div>
            ))}
            {data.dock.length < 4 &&
              Array.from({ length: 4 - data.dock.length }).map((_, i) => (
                <div
                  key={`dock-empty-${i}`}
                  data-cell="1"
                  data-row={-1}
                  data-col={data.dock.length + i}
                  data-page={-1}
                  className="w-12 h-12 md:w-14 md:h-14 rounded-[22%]"
                />
              ))}
          </>
        )}
      </div>
    </div>
  );
};

export default Dock;