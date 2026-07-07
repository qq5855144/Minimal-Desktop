import React from 'react';

interface SkeletonIconProps {
  size?: 'normal' | 'small';
  /** 覆盖图标尺寸（px），与 AppIcon 保持一致，不传时 normal=46 small=48 */
  iconPx?: number;
}

const SkeletonIcon: React.FC<SkeletonIconProps> = ({ size = 'normal', iconPx }) => {
  const isSmall = size === 'small';
  // 与 AppIcon 逻辑对齐：small 固定 48，normal 使用传入值或默认 46
  const px = isSmall ? 48 : (iconPx ?? 46);
  const labelW = Math.round(px * 0.85);

  return (
    <div className="flex flex-col items-center gap-1 select-none">
      <div
        className="rounded-[22%] bg-white/20 animate-skeleton-pulse"
        style={{ width: px, height: px }}
      />
      <div
        className="rounded-full bg-white/20 animate-skeleton-pulse"
        style={{ width: labelW, height: 8 }}
      />
    </div>
  );
};

export default SkeletonIcon;