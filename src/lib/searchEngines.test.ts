import { describe, expect, it } from 'vitest';
import {
  getAvailableSearchEngines,
  getEngineById,
  isBuiltinSearchEngine,
} from './searchEngines';

describe('searchEngines', () => {
  it('同 ID 自定义记录会覆盖内置引擎并保持原排序', () => {
    const engines = getAvailableSearchEngines([{
      id: 'bing',
      name: '我的 Bing',
      urlTemplate: 'https://example.com/?q={q}',
      iconUrl: 'data:image/svg+xml,override',
      color: '#123456',
    }]);

    expect(engines[0]).toMatchObject({
      id: 'bing',
      name: '我的 Bing',
      urlTemplate: 'https://example.com/?q={q}',
      isCustom: true,
    });
  });

  it('内置引擎删除墓碑会隐藏引擎并让当前选择安全回退', () => {
    const engines = getAvailableSearchEngines([], ['bing', 'google']);
    expect(engines.some((engine) => engine.id === 'bing')).toBe(false);
    expect(getEngineById('bing', [], ['bing', 'google']).id).toBe('baidu');
  });

  it('能区分内置 ID 与真正的自定义引擎 ID', () => {
    expect(isBuiltinSearchEngine('bing')).toBe(true);
    expect(isBuiltinSearchEngine('custom-1')).toBe(false);
  });
});
