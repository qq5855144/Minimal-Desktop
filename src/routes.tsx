import React from 'react';
import Desktop from './components/Desktop';
import type { ReactNode } from 'react';

export interface RouteConfig {
  name: string;
  path: string;
  element: ReactNode;
  visible?: boolean;
  public?: boolean;
}

export const routes: RouteConfig[] = [
  {
    name: '桌面',
    path: '/',
    element: <Desktop />,
    public: true,
  }
];
