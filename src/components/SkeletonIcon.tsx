import React from 'react';

interface SkeletonIconProps {
  size?: 'normal' | 'small';
}

const SkeletonIcon: React.FC<SkeletonIconProps> = ({ size = 'normal' }) => {
  const isSmall = size === 'small';
  const iconSize = isSmall ? 'w-12 h-12' : 'w-16 h-16 md:w-[72px] md:h-[72px]';
  const textSize = isSmall ? 'w-10 h-2' : 'w-14 h-2.5';

  return (
    <div className="flex flex-col items-center gap-1.5 select-none">
      <div className={`${iconSize} rounded-[22%] bg-white/20 animate-skeleton-pulse`} />
      <div className={`${textSize} rounded-full bg-white/20 animate-skeleton-pulse`} />
    </div>
  );
};

export default SkeletonIcon;