import type { ComponentType } from 'react';
import type { WidgetType } from '@/types';
import { resolveWidgetType } from '@/lib/widgetConfig';
import ClockWidget from './ClockWidget';
import CombinedWidget from './CombinedWidget';
import SearchBar from './SearchBar';

const WIDGET_COMPONENTS: Record<WidgetType, ComponentType> = {
  clock: ClockWidget,
  search: SearchBar,
  combined: CombinedWidget,
};

export function getWidgetComponent(widgetType?: WidgetType): ComponentType {
  return WIDGET_COMPONENTS[resolveWidgetType(widgetType)];
}
