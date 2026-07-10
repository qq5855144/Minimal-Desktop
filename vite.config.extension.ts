/**
 * vite.config.extension.ts
 * 浏览器扩展专用构建配置（Chrome / Firefox MV3）
 *
 * 与 vite.config.ts 的核心差异：
 *  1. base = './'   —— 扩展页面使用相对路径，避免 chrome-extension:// 协议下加载失败
 *  2. 输出文件名不含 hash —— Service Worker / background 脚本路径必须静态已知
 *  3. transformIndexHtml 插件：剥除 index.html 中 GitHub Pages SPA 内联脚本，
 *     确保符合 MV3 严格 CSP（script-src 'self'，禁止内联脚本）
 *  4. outDir = 'dist-ext'   —— 与常规 Pages 构建产物隔离
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import path from "path";
import type { Plugin } from "vite";

/** 剥离 index.html 内的所有 <script> 内联块（MV3 CSP 合规） */
function stripInlineScripts(): Plugin {
  return {
    name: "strip-inline-scripts",
    transformIndexHtml(html) {
      // 移除 <script>...</script>（不含 type="module" 的模块入口脚本）
      return html.replace(/<script(?![^>]*type=["']module["'])[^>]*>[\s\S]*?<\/script>/gi, "");
    },
  };
}

export default defineConfig({
  // 扩展页必须使用相对路径
  base: "./",

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
      output: {
        // MV3 规范：background / content script 路径必须静态，不能含 hash
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name].[ext]",
      },
    },
  },
});
