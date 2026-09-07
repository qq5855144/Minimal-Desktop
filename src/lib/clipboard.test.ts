import { afterEach, expect, it, vi } from 'vitest';
import { copyLink } from './clipboard';
afterEach(() => vi.unstubAllGlobals());
it('copies the exact link with the browser Clipboard API', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  await copyLink('https://example.com/?a=1&b=2');
  expect(writeText).toHaveBeenCalledWith('https://example.com/?a=1&b=2');
});
it.each([true, false])('cleans up the legacy clipboard field even when copy returns %s', async (success) => {
  const field = { value: '', setAttribute: vi.fn(), style: { cssText: '' }, select: vi.fn(), setSelectionRange: vi.fn(), remove: vi.fn() };
  const focus = vi.fn();
  const execCommand = vi.fn().mockReturnValue(success);
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('document', { activeElement: { focus }, createElement: () => field, body: { appendChild: vi.fn() }, execCommand });
  if (success) await copyLink('https://example.com/');
  else await expect(copyLink('https://example.com/')).rejects.toThrow('复制失败');
  expect(execCommand).toHaveBeenCalledWith('copy');
  expect(field.remove).toHaveBeenCalledOnce(); expect(focus).toHaveBeenCalledOnce();
});
