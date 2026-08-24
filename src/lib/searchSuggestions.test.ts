import { describe, expect, it } from 'vitest';
import { normalizeSuggestionList } from './searchSuggestions';

describe('normalizeSuggestionList', () => {
  it('清理、去重并限制第三方返回的搜索建议', () => {
    expect(normalizeSuggestionList([
      '  搜索建议  ',
      '搜索建议',
      null,
      1,
      '第二条',
      '',
      ...Array.from({ length: 20 }, (_, index) => `建议 ${index}`),
    ])).toEqual([
      '搜索建议',
      '第二条',
      '建议 0',
      '建议 1',
      '建议 2',
      '建议 3',
      '建议 4',
      '建议 5',
      '建议 6',
      '建议 7',
    ]);
  });

  it('拒绝非数组响应并限制单条长度', () => {
    expect(normalizeSuggestionList({ suggestions: ['x'] })).toEqual([]);
    expect(normalizeSuggestionList(['x'.repeat(200)])[0]).toHaveLength(160);
  });
});
