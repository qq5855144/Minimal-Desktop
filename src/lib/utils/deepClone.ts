/**
 * 深拷贝工具函数，兼容不支持 structuredClone 的旧版浏览器。
 * 适用于纯 JSON 可序列化数据（无 Map/Set/Date/RegExp 等特殊类型）。
 */
export function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}
