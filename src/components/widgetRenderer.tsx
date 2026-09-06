import type { ComponentType } from 'react';
import type { WidgetType, DesktopItem } from '@/types';
import { resolveWidgetType } from '@/lib/widgetConfig';
import ClockWidget from './ClockWidget';
import CombinedWidget from './CombinedWidget';
import SearchBar from './SearchBar';
import WeatherWidget from './weather/WeatherWidget';

const WIDGET_COMPONENTS: Record<WidgetType, ComponentType<{ item?: DesktopItem; preview?: boolean }>> = {
  weather: WeatherWidget,
  clock: ClockWidget,
  search: SearchBar,
  combined: CombinedWidget,
};

export function getWidgetComponent(widgetType?: WidgetType): ComponentType<{ item?: DesktopItem; preview?: boolean }> {
  return WIDGET_COMPONENTS[resolveWidgetType(widgetType)];
}
