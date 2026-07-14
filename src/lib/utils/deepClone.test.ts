import { describe, it, expect, vi, afterEach } from 'vitest';
import { deepClone } from './deepClone';

describe('deepClone', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── 基础类型 ──
  it('复制基本值（数字/字符串/布尔/null）', () => {
    expect(deepClone(42)).toBe(42);
    expect(deepClone('hello')).toBe('hello');
    expect(deepClone(true)).toBe(true);
    expect(deepClone(null)).toBe(null);
  });

  // ── 深拷贝隔离性 ──
  it('返回与原对象内容相等但引用不同的新对象', () => {
    const src = { a: 1, b: { c: 2 } };
    const clone = deepClone(src);
    expect(clone).toEqual(src);
    expect(clone).not.toBe(src);
    expect(clone.b).not.toBe(src.b);
  });

  it('修改克隆不影响原对象', () => {
    const src = { x: { y: 99 } };
    const clone = deepClone(src);
    clone.x.y = 0;
    expect(src.x.y).toBe(99);
  });

  it('深拷贝嵌套数组', () => {
    const src = [[1, 2], [3, 4]];
    const clone = deepClone(src);
    clone[0][0] = 999;
    expect(src[0][0]).toBe(1);
  });

  it('深拷贝复杂 DesktopItem 结构', () => {
    const item = { id: 'app-1', name: '相册', page: 0, row: 1, col: 2, type: 'app', color: 'blue' };
    const clone = deepClone(item);
    expect(clone).toEqual(item);
    expect(clone).not.toBe(item);
  });

  it('深拷贝 DesktopData（多页结构）', () => {
    const data = { pages: [[{ id: 'a', row: 0, col: 0 }], []], dock: [], version: 3 };
    const clone = deepClone(data);
    clone.pages[0][0].id = 'modified';
    expect(data.pages[0][0].id).toBe('a');
  });

  // ── 降级路径（模拟旧浏览器） ──
  it('structuredClone 不可用时降级为 JSON 深拷贝', () => {
    const original = globalThis.structuredClone;
    // @ts-expect-error 模拟旧浏览器
    globalThis.structuredClone = undefined;
    try {
      const src = { a: [1, 2, 3], b: { c: true } };
      const clone = deepClone(src);
      expect(clone).toEqual(src);
      expect(clone).not.toBe(src);
      expect(clone.a).not.toBe(src.a);
    } finally {
      globalThis.structuredClone = original;
    }
  });
});
