import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import WidgetGridCell from './WidgetGridCell';
import { getDesktopGridLayoutMetrics, getIconLayoutMetrics, getWeatherSurfaceMetrics } from '@/lib/iconLayout';
import type { DesktopItem } from '@/types';
vi.mock('./widgetRenderer', () => ({ getWidgetComponent: () => () => <div>surface</div> }));
const item: DesktopItem = { id: 'widget-weather', type: 'widget', widgetType: 'weather', name: '天气', color: 'blue', page: 0, row: 0, col: 0 };
describe('weather desktop label', () => {
  it.each([false, true])('places the name on the folder label baseline (large: %s)', (large) => {
    const grid = getDesktopGridLayoutMetrics(412, 4, 60, 900, 8);
    const icon = getIconLayoutMetrics('normal', grid.iconPx);
    const surface = getWeatherSurfaceMetrics(large, icon, grid);
    const markup = renderToStaticMarkup(<WidgetGridCell item={item} iconPx={icon.iconPx} weatherSurface={surface} />);
    expect(markup).toContain('>天气</span>');
    const label = markup.slice(markup.indexOf('<span'));
    const baselineTop = 2 * grid.rowHeightPx + grid.rowGapPx - icon.labelHeightPx;
    expect(label).toContain(`top:${baselineTop}px`);
    expect(label).toContain('app-icon-label');
  });
  it('does not leave a duplicate name on the empty drag placeholder', () => {
    const markup = renderToStaticMarkup(<WidgetGridCell item={item} ghost weatherSurface={{ width: 150, height: 150, top: 0, radius: 18 }} />);
    expect(markup).not.toContain('>天气</span>');
  });
});
