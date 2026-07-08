/**
 * 搜索引擎定义与工具函数
 * - BUILTIN_ENGINES：内置搜索引擎列表（含 Iconify 图标 ID + API URL）
 * - buildSearchUrl：根据引擎构建搜索 URL
 * - getEngineById：按 ID 查找引擎（内置优先，再查自定义）
 * - getEngineIconUrl：获取图标 img src（Iconify API URL）
 */

import type { CustomSearchEngine } from '@/types';

export interface BuiltinEngine {
  id: string;
  name: string;
  color: string;           // 品牌色（fallback 背景 / simple-icons 着色）
  iconifyIcon: string;     // @iconify/react 使用的 icon ID
  iconApiUrl: string;      // Iconify API SVG URL（img src 方式，兼容性更好）
  urlTemplate: string;
  isCustom?: false;
}

/** Iconify API 生成带颜色的 SVG 图标 URL */
function iconUrl(collection: string, icon: string, color?: string): string {
  const hex = color ? encodeURIComponent(color) : undefined;
  return `https://api.iconify.design/${collection}/${icon}.svg${hex ? `?color=${hex}` : ''}`;
}

export const BUILTIN_ENGINES: BuiltinEngine[] = [
  {
    id: 'bing',
    name: 'Bing',
    color: '#0078D4',
    iconifyIcon: 'simple-icons:microsoftbing',
    iconApiUrl: iconUrl('simple-icons', 'microsoftbing', '#0078D4'),
    urlTemplate: 'https://www.bing.com/search?q={q}&form=QBLH&sp=-1',
  },
  {
    id: 'google',
    name: 'Google',
    color: '#4285F4',
    iconifyIcon: 'logos:google-icon',
    iconApiUrl: iconUrl('logos', 'google-icon'),
    urlTemplate: 'https://www.google.com/search?q={q}',
  },
  {
    id: 'baidu',
    name: '百度',
    color: '#2932E1',
    iconifyIcon: 'simple-icons:baidu',
    iconApiUrl: iconUrl('simple-icons', 'baidu', '#2932E1'),
    urlTemplate: 'https://www.baidu.com/s?wd={q}',
  },
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    color: '#DE5833',
    iconifyIcon: 'simple-icons:duckduckgo',
    iconApiUrl: iconUrl('simple-icons', 'duckduckgo', '#DE5833'),
    urlTemplate: 'https://duckduckgo.com/?q={q}',
  },
  {
    id: 'yandex',
    name: 'Yandex',
    color: '#FC3F1D',
    iconifyIcon: 'simple-icons:yandex',
    iconApiUrl: iconUrl('simple-icons', 'yandex', '#FC3F1D'),
    urlTemplate: 'https://yandex.com/search/?text={q}',
  },
  {
    id: 'sogou',
    name: '搜狗',
    color: '#FB5D1A',
    iconifyIcon: 'simple-icons:sogou',
    iconApiUrl: iconUrl('simple-icons', 'sogou', '#FB5D1A'),
    urlTemplate: 'https://www.sogou.com/web?query={q}',
  },
  {
    id: '360',
    name: '360',
    color: '#00AA3C',
    iconifyIcon: 'simple-icons:360',
    iconApiUrl: iconUrl('simple-icons', '360', '#00AA3C'),
    urlTemplate: 'https://www.so.com/s?q={q}',
  },
  {
    id: 'quark',
    name: '夸克',
    color: '#2C5EF0',
    iconifyIcon: 'simple-icons:quark',
    iconApiUrl: iconUrl('simple-icons', 'quark', '#2C5EF0'),
    urlTemplate: 'https://quark.sm.cn/s?q={q}',
  },
];

export type AnyEngine = BuiltinEngine | (CustomSearchEngine & { isCustom: true });

/** 获取图标 img src；内置引擎用 Iconify API URL，自定义引擎用 iconUrl 字段 */
export function getEngineIconUrl(engine: AnyEngine): string | null {
  if ('iconApiUrl' in engine) return engine.iconApiUrl;
  if ('iconUrl' in engine && engine.iconUrl) return engine.iconUrl;
  return null;
}

/** 按 ID 查找引擎（内置优先，再查自定义列表） */
export function getEngineById(
  id: string,
  customEngines: CustomSearchEngine[] = [],
): AnyEngine {
  const builtin = BUILTIN_ENGINES.find((e) => e.id === id);
  if (builtin) return builtin;
  const custom = customEngines.find((e) => e.id === id);
  if (custom) return { ...custom, isCustom: true as const };
  return BUILTIN_ENGINES[0];
}

/** 构建搜索 URL，{q} 替换为 encodeURIComponent(query) */
export function buildSearchUrl(engine: AnyEngine, query: string): string {
  return engine.urlTemplate.replace('{q}', encodeURIComponent(query));
}
