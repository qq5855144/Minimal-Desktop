/**
 * 搜索引擎定义与工具函数
 * - BUILTIN_ENGINES：内置搜索引擎列表（含 Iconify 图标 ID）
 * - buildSearchUrl：根据引擎构建搜索 URL
 * - getEngineById：按 ID 查找引擎（内置优先，再查自定义）
 */

import type { CustomSearchEngine } from '@/types';

export interface BuiltinEngine {
  id: string;
  name: string;
  color: string;           // 字母兜底时的背景色 / 自定义引擎主题色
  iconifyIcon: string;     // Iconify 图标 ID，如 "logos:google-icon"
  urlTemplate: string;     // {q} 占位符替换
  isCustom?: false;
}

export const BUILTIN_ENGINES: BuiltinEngine[] = [
  {
    id: 'bing',
    name: 'Bing',
    color: '#0078D4',
    iconifyIcon: 'logos:bing',
    urlTemplate: 'https://www.bing.com/search?q={q}&form=QBLH&sp=-1',
  },
  {
    id: 'google',
    name: 'Google',
    color: '#4285F4',
    iconifyIcon: 'logos:google-icon',
    urlTemplate: 'https://www.google.com/search?q={q}',
  },
  {
    id: 'baidu',
    name: '百度',
    color: '#2932E1',
    iconifyIcon: 'logos:baidu',
    urlTemplate: 'https://www.baidu.com/s?wd={q}',
  },
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    color: '#DE5833',
    iconifyIcon: 'simple-icons:duckduckgo',
    urlTemplate: 'https://duckduckgo.com/?q={q}',
  },
  {
    id: 'yandex',
    name: 'Yandex',
    color: '#FC3F1D',
    iconifyIcon: 'logos:yandex',
    urlTemplate: 'https://yandex.com/search/?text={q}',
  },
  {
    id: 'sogou',
    name: '搜狗',
    color: '#FB5D1A',
    iconifyIcon: 'simple-icons:sogou',
    urlTemplate: 'https://www.sogou.com/web?query={q}',
  },
  {
    id: '360',
    name: '360',
    color: '#00AA3C',
    iconifyIcon: 'simple-icons:360',
    urlTemplate: 'https://www.so.com/s?q={q}',
  },
  {
    id: 'quark',
    name: '夸克',
    color: '#2C5EF0',
    iconifyIcon: 'simple-icons:quark',
    urlTemplate: 'https://quark.sm.cn/s?q={q}',
  },
];

export type AnyEngine = BuiltinEngine | (CustomSearchEngine & { isCustom: true });

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
