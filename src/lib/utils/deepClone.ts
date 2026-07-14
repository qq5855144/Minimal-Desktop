/**
 * 深拷贝工具函数，兼容不支持 structuredClone 的旧版浏览器（Chrome < 98 / Safari < 15.4）。
 *
 * 降级策略说明：
 * - 优先使用原生 structuredClone（支持 Map/Set/Date/RegExp/ArrayBuffer 等复杂类型）
 * - 降级使用 JSON.parse/stringify（仅支持 JSON 可序列化类型，但同步且零依赖）
 *
 * 注意：MessageChannel.postMessage 虽能触发结构化克隆算法，但其 onmessage 回调
 * 是微任务（异步），无法用于同步返回值的场景，故此处不采用。
 * 本项目数据均为纯 JSON 可序列化对象（DesktopItem/DesktopData），降级策略完全满足需求。
 */
export function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}
