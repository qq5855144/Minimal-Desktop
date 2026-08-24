import { describe, expect, it } from 'vitest';
import { getPanelTheme } from './panelTheme';

describe('getPanelTheme', () => {
  it('uses a soft cool base and directional shadows for neumorphism', () => {
    const theme = getPanelTheme(true);

    expect(theme.sheetBg).toBe('bg-[#e8edf5]');
    expect(theme.sheetStyle?.background).toBe('#e8edf5');
    expect(theme.sheetStyle?.boxShadow).toContain('rgba(151,163,180');
    expect(theme.itemBg).toContain('bg-[#e8edf5]');
    expect(theme.inputCls).toContain('inset_');
  });

  it('keeps the glass theme independent from the white neumorphic surface', () => {
    const theme = getPanelTheme(false);

    expect(theme.sheetBg).toContain('backdrop-blur');
    expect(theme.sheetStyle?.background).toContain('linear-gradient');
  });
});
