/**
 * 搜索引擎定义与工具函数
 * - BUILTIN_ENGINES：内置搜索引擎列表
 * - buildSearchUrl：根据引擎 ID 构建搜索 URL
 * - getFaviconUrl：通过 Google Favicon 服务获取网站图标
 * - getEngineById：按 ID 查找引擎（内置优先，再查自定义）
 */

import type { CustomSearchEngine } from '@/types';

export interface BuiltinEngine {
  id: string;
  name: string;
  domain: string;          // 用于 favicon 兜底
  iconUrl: string;         // 官方高清图标 URL
  color: string;           // 品牌主色（字母兜底时使用）
  urlTemplate: string;     // {q} 占位符替换
  isCustom?: false;
}

export const BUILTIN_ENGINES: BuiltinEngine[] = [
  {
    id: 'bing',
    name: 'Bing',
    domain: 'bing.com',
    iconUrl: 'https://www.bing.com/sa/simg/favicon-trans-bg-blue-mg.ico',
    color: '#0078D4',
    urlTemplate: 'https://www.bing.com/search?q={q}&form=QBLH&sp=-1',
  },
  {
    id: 'google',
    name: 'Google',
    domain: 'google.com',
    iconUrl: 'https://www.gstatic.com/images/branding/googleg/1x/googleg_48dp.png',
    color: '#4285F4',
    urlTemplate: 'https://www.google.com/search?q={q}',
  },
  {
    id: 'baidu',
    name: '百度',
    domain: 'baidu.com',
    iconUrl: 'https://www.baidu.com/favicon.ico',
    color: '#2932E1',
    urlTemplate: 'https://www.baidu.com/s?wd={q}',
  },
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    domain: 'duckduckgo.com',
    iconUrl: 'https://duckduckgo.com/favicon.ico',
    color: '#DE5833',
    urlTemplate: 'https://duckduckgo.com/?q={q}',
  },
  {
    id: 'yandex',
    name: 'Yandex',
    domain: 'yandex.com',
    iconUrl: 'https://yastatic.net/s3/home-static/_/37/37a6c486b31d91d929e7d67d3bb0a7d6.png',
    color: '#CC0000',
    urlTemplate: 'https://yandex.com/search/?text={q}',
  },
  {
    id: 'sogou',
    name: '搜狗',
    domain: 'sogou.com',
    iconUrl: 'https://www.sogou.com/images/logo/new/favicon.ico',
    color: '#FB5D1A',
    urlTemplate: 'https://www.sogou.com/web?query={q}',
  },
  {
    id: '360',
    name: '360',
    domain: 'so.com',
    iconUrl: 'https://p.ssl.qhimg.com/t011cb7f84e7e1e3e55.png',
    color: '#00AA3C',
    urlTemplate: 'https://www.so.com/s?q={q}',
  },
  {
    id: 'quark',
    name: '夸克',
    domain: 'quark.cn',
    iconUrl: 'https://www.google.com/s2/favicons?domain=quark.sm.cn&sz=128',
    color: '#2C5EF0',
    urlTemplate: 'https://quark.sm.cn/s?q={q}',
  },
];

/** 兜底：Google Favicon 服务获取 128px 图标 */
export function getFaviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
}

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
  // 默认返回 Bing
  return BUILTIN_ENGINES[0];
}

/** 构建搜索 URL，{q} 替换为 encodeURIComponent(query) */
export function buildSearchUrl(engine: AnyEngine, query: string): string {
  return engine.urlTemplate.replace('{q}', encodeURIComponent(query));
}
