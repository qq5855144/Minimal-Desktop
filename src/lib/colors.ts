import type { IconColor } from '@/types';

const COLOR_MAP: Record<IconColor, string> = {
  blue: 'hsl(211 100% 52%)',
  green: 'hsl(142 71% 45%)',
  orange: 'hsl(30 100% 55%)',
  red: 'hsl(0 84% 60%)',
  purple: 'hsl(262 83% 58%)',
  yellow: 'hsl(48 96% 53%)',
  pink: 'hsl(330 80% 60%)',
  teal: 'hsl(172 70% 42%)',
  indigo: 'hsl(230 80% 60%)',
  gray: 'hsl(240 5% 50%)',
};

export function getColorStyle(color: IconColor): string {
  return COLOR_MAP[color] || COLOR_MAP.gray;
}

export const COLOR_OPTIONS: IconColor[] = [
  'blue',
  'green',
  'orange',
  'red',
  'purple',
  'yellow',
  'pink',
  'teal',
  'indigo',
  'gray',
];

// 根据字符串生成稳定的颜色
export function pickColor(seed: string): IconColor {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  const idx = Math.abs(hash) % COLOR_OPTIONS.length;
  return COLOR_OPTIONS[idx];
}