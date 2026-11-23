import type { DesktopItem } from '@/types';

export const BUILT_IN_SITES = [
  { id: 'site-translate', name: '百度翻译', url: 'https://fanyi.baidu.com/', color: 'blue' },
  { id: 'site-maps', name: '高德地图', url: 'https://www.amap.com/', color: 'green' },
  { id: 'site-rail', name: '铁路 12306', url: 'https://www.12306.cn/', color: 'indigo' },
  { id: 'site-encyclopedia', name: '维基百科', url: 'https://zh.wikipedia.org/', color: 'gray' },
  { id: 'site-github', name: 'GitHub', url: 'https://github.com/', color: 'gray' },
  { id: 'site-mdn', name: 'MDN Web 文档', url: 'https://developer.mozilla.org/zh-CN/', color: 'purple' },
] as const satisfies readonly Pick<DesktopItem, 'id' | 'name' | 'url' | 'color'>[];

export function hasDesktopSite(pages: DesktopItem[][], url: string): boolean {
  const target = url.replace(/\/$/, '');
  const matches = (item: DesktopItem): boolean => (
    item.url?.replace(/\/$/, '') === target || Boolean(item.children?.some(matches))
  );
  return pages.some((page) => page.some(matches));
}
