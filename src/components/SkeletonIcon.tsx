import React from 'react';
import { getIconLayoutMetrics, type IconSizeVariant } from '@/lib/iconLayout';

interface SkeletonIconProps {
  size?: IconSizeVariant;
  /** 覆盖图标尺寸（px），与 AppIcon 保持一致，不传时 normal=46 small=48 */
  iconPx?: number;
  variant?: 'skeleton' | 'empty';
  active?: boolean;
}

const SkeletonIcon: React.FC<SkeletonIconProps> = ({
  size = 'normal',
  iconPx,
  variant = 'skeleton',
  active = false,
}) => {
  const metrics = getIconLayoutMetrics(size, iconPx);
  const isEmpty = variant === 'empty';

  return (
    <div className="flex flex-col items-center gap-1 select-none">
      <div
        className={
          isEmpty
            ? `border-2 border-dashed transition-all duration-150 ${active ? 'border-white/60 bg-white/15' : 'border-white/20 bg-white/5'}`
            : 'bg-white/20 animate-skeleton-pulse'
        }
        style={{ width: metrics.iconPx, height: metrics.iconPx, borderRadius: metrics.iconRadius }}
      />
      <div
        className="flex items-center justify-center"
        style={{ width: metrics.labelMaxWidthPx, minHeight: metrics.labelHeightPx }}
      >
        {isEmpty ? (
          <div style={{ width: metrics.labelPlaceholderWidthPx, height: metrics.labelHeightPx }} />
        ) : (
          <div
            className="rounded-full bg-white/20 animate-skeleton-pulse"
            style={{ width: metrics.labelPlaceholderWidthPx, height: metrics.labelSkeletonHeightPx }}
          />
        )}
      </div>
    </div>
  );
};

export default SkeletonIcon;
