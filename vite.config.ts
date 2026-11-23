import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import path from "path";
import { rmSync } from "node:fs";

export default defineConfig(({ command, mode }) => {
  const cloudflare = mode === 'cloudflare' || process.env.CF_PAGES === '1';
  const base = command === 'build' && !cloudflare ? '/Minimal-Desktop/' : '/';
  return {
    base,
    plugins: [
      {
        name: 'minimal-desktop-cloudflare-spa',
        apply: 'build',
        closeBundle() {
          if (!cloudflare) return;
          // Cloudflare Pages 没有顶级 404.html 时自动将 SPA 子路由交给 index.html。
          for (const file of ['404.html', '404-redirect.js']) {
            rmSync(path.resolve(__dirname, 'dist', file), { force: true });
          }
        },
      },
      react(),
      svgr({
        svgrOptions: {
          icon: true,
          exportType: "named",
          namedExport: "ReactComponent",
        },
      }),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
