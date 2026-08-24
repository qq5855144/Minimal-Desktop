import { describe, expect, it } from 'vitest';
import { getPanelTheme } from './panelTheme';

describe('getPanelTheme', () => {
  it('uses a pure-white base and directional shadows for neumorphism', () => {
    const theme = getPanelTheme(true);

    expect(theme.sheetBg).toBe('bg-white');
    expect(theme.sheetStyle?.background).toBe('#ffffff');
    expect(theme.sheetStyle?.boxShadow).toContain('rgba(15,23,42');
    expect(theme.itemBg).toContain('bg-white');
    expect(theme.inputCls).toContain('inset_');
  });

  it('keeps the glass theme independent from the white neumorphic surface', () => {
    const theme = getPanelTheme(false);

    expect(theme.sheetBg).toContain('backdrop-blur');
    expect(theme.sheetStyle?.background).toContain('linear-gradient');
  });
});
