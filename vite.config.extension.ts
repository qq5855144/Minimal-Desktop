/**
 * vite.config.extension.ts
 * 浏览器扩展专用构建配置（Chrome / Firefox MV3）
 *
 * 与 vite.config.ts 的核心差异：
 *  1. base = './'   —— 扩展页面使用相对路径，避免 chrome-extension:// 协议下加载失败
 *  2. 输出文件名不含 hash —— background service worker 路径必须静态已知
 *  3. transformIndexHtml 插件：剥除 index.html 中 GitHub Pages SPA 内联脚本，
 *     确保符合 MV3 严格 CSP（script-src 'self'，禁止内联脚本）
 *  4. outDir = 'dist-ext'   —— 与常规 Pages 构建产物隔离
 *  5. VITE_IS_EXTENSION=true —— 让 App.tsx 切换为 HashRouter
 *  6. background.ts 作为独立 rollup 入口打包为 assets/background.js
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import path from "path";
import type { Plugin } from "vite";

/** 剥离 index.html 内的所有非模块内联脚本（MV3 CSP 合规） */
function stripInlineScripts(): Plugin {
  return {
    name: "strip-inline-scripts",
    transformIndexHtml(html) {
      return html.replace(/<script(?![^>]*type=["']module["'])[^>]*>[\s\S]*?<\/script>/gi, "");
    },
  };
}

export default defineConfig({
  base: "./",

  define: {
    // 让 App.tsx 在扩展环境中切换为 HashRouter
    "import.meta.env.VITE_IS_EXTENSION": JSON.stringify("true"),
  },

  plugins: [
    react(),
    svgr({
      svgrOptions: {
        icon: true,
        exportType: "named",
        namedExport: "ReactComponent",
      },
    }),
    stripInlineScripts(),
  ],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  build: {
    outDir: "dist-ext",
    emptyOutDir: true,

    rollupOptions: {
      input: {
        // 主页面入口
        index: path.resolve(__dirname, "index.html"),
        // MV3 Service Worker（background script）独立打包
        background: path.resolve(__dirname, "src/extension/background.ts"),
      },
      output: {
        // 静态文件名（无 hash），background.js 路径需与 manifest.json 一致
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name].[ext]",
      },
    },
  },
});
