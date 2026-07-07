import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import IntersectObserver from '@/components/common/IntersectObserver';
import { Toaster } from '@/components/ui/sonner';
import { DesktopProvider } from '@/contexts/DesktopContext';

import { routes } from './routes';

const App: React.FC = () => {
  return (
    <DesktopProvider>
      {/* basename 使用 Vite 注入的 BASE_URL，开发时为 '/'，生产时为 '/Minimal-Desktop/' */}
      <Router basename={import.meta.env.BASE_URL}>
        <IntersectObserver />
        <Routes>
          {routes.map((route, index) => (
            <Route key={index} path={route.path} element={route.element} />
          ))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <Toaster />
      </Router>
    </DesktopProvider>
  );
};

export default App;
