/**
 * 搜索引擎定义与工具函数
 * - BUILTIN_ENGINES：内置搜索引擎（使用本地内联 SVG，无需网络）
 * - buildSearchUrl：构建搜索 URL
 * - getEngineById：按 ID 查找引擎
 * - getEngineIconSrc：获取图标 src（内联 data URL 或 iconUrl）
 */

import type { CustomSearchEngine } from '@/types';
import {
  bingIcon, googleIcon, baiduIcon,
  duckduckgoIcon, yandexIcon, sogouIcon,
  i360Icon, quarkIcon,
} from '@/assets/engineIcons';

export interface BuiltinEngine {
  id: string;
  name: string;
  color: string;       // fallback 背景色
  iconSrc: string;     // 内联 SVG data URL
  urlTemplate: string;
  isCustom?: false;
}

export const BUILTIN_ENGINES: BuiltinEngine[] = [
  {
    id: 'bing',
    name: 'Bing',
    color: '#0078D4',
    iconSrc: bingIcon,
    urlTemplate: 'https://www.bing.com/search?q={q}&form=QBLH&sp=-1',
  },
  {
    id: 'google',
    name: 'Google',
    color: '#4285F4',
    iconSrc: googleIcon,
    urlTemplate: 'https://www.google.com/search?q={q}',
  },
  {
    id: 'baidu',
    name: '百度',
    color: '#2932E1',
    iconSrc: baiduIcon,
    urlTemplate: 'https://www.baidu.com/s?wd={q}',
  },
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    color: '#DE5833',
    iconSrc: duckduckgoIcon,
    urlTemplate: 'https://duckduckgo.com/?q={q}',
  },
  {
    id: 'yandex',
    name: 'Yandex',
    color: '#FC3F1D',
    iconSrc: yandexIcon,
    urlTemplate: 'https://yandex.com/search/?text={q}',
  },
  {
    id: 'sogou',
    name: '搜狗',
    color: '#FB5D1A',
    iconSrc: sogouIcon,
    urlTemplate: 'https://www.sogou.com/web?query={q}',
  },
  {
    id: '360',
    name: '360',
    color: '#00AA3C',
    iconSrc: i360Icon,
    urlTemplate: 'https://www.so.com/s?q={q}',
  },
  {
    id: 'quark',
    name: '夸克',
    color: '#2C5EF0',
    iconSrc: quarkIcon,
    urlTemplate: 'https://quark.sm.cn/s?q={q}',
  },
];

export type AnyEngine = BuiltinEngine | (CustomSearchEngine & { isCustom: true });

/** 获取图标 src：内置引擎返回内联 data URL，自定义引擎返回 iconUrl */
export function getEngineIconSrc(engine: AnyEngine): string | null {
  if ('iconSrc' in engine) return engine.iconSrc;
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

/** 构建搜索 URL，支持 {q} 和 %s 两种占位符 */
export function buildSearchUrl(engine: AnyEngine, query: string): string {
  const encoded = encodeURIComponent(query);
  return engine.urlTemplate.replace(/{q}/g, encoded).replace(/%s/g, encoded);
}
