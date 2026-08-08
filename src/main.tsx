import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { AppWrapper } from "./components/common/PageMeta.tsx";
import "./index.css";

// GitHub Pages 404.html 会把 SPA 子路径编码为 ?p=/...&q=...。
// 在模块入口中恢复 URL，避免为了路由兼容放宽 CSP 允许内联脚本。
function restoreGithubPagesRoute() {
  const params = new URLSearchParams(window.location.search);
  const encodedPath = params.get('p');
  if (!encodedPath) return;
  const base = window.location.pathname.endsWith('/')
    ? window.location.pathname.slice(0, -1)
    : window.location.pathname;
  const childPath = encodedPath.replace(/~and~/g, '&');
  const search = params.get('q')?.replace(/~and~/g, '&');
  window.history.replaceState(
    null,
    '',
    `${base}${childPath.startsWith('/') ? childPath : `/${childPath}`}${search ? `?${search}` : ''}${window.location.hash}`,
  );
}

restoreGithubPagesRoute();

// 清除旧版取色缓存（bg_c 前缀），防止旧纯色缓存影响新 blur 背景层方案
try {
  Object.keys(localStorage)
    .filter((k) => k.startsWith('bg_c'))
    .forEach((k) => localStorage.removeItem(k));
} catch { /* ignore */ }

createRoot(document.getElementById("root")!).render(
  <AppWrapper>
    <App />
  </AppWrapper>
);
