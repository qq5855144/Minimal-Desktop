import React from 'react';
import Desktop from './components/Desktop';
import type { ReactNode } from 'react';

const CloudDriveView = React.lazy(() => import('./components/CloudDriveView'));

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
  },
  {
    name: '云盘',
    path: '/drive',
    element: (
      <React.Suspense fallback={<p role="status" className="p-4">正在打开云盘…</p>}>
        <CloudDriveView />
      </React.Suspense>
    ),
  },
];
