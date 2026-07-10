import React from 'react';
import { BrowserRouter, HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import IntersectObserver from '@/components/common/IntersectObserver';
import { Toaster } from '@/components/ui/sonner';
import { DesktopProvider } from '@/contexts/DesktopContext';

import { routes } from './routes';

// 扩展插件环境使用 HashRouter（chrome-extension:// 协议不支持 BrowserRouter basename）
// 普通网页环境使用 BrowserRouter + BASE_URL basename
const IS_EXTENSION = import.meta.env.VITE_IS_EXTENSION === 'true';

const App: React.FC = () => {
  const routeTree = (
    <Routes>
      {routes.map((route, index) => (
        <Route key={index} path={route.path} element={route.element} />
      ))}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );

  return (
    <DesktopProvider>
      {IS_EXTENSION ? (
        <HashRouter>
          <IntersectObserver />
          {routeTree}
          <Toaster />
        </HashRouter>
      ) : (
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <IntersectObserver />
          {routeTree}
          <Toaster />
        </BrowserRouter>
      )}
    </DesktopProvider>
  );
};

export default App;
