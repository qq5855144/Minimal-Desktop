import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { AppWrapper } from "./components/common/PageMeta.tsx";
import "./index.css";

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
