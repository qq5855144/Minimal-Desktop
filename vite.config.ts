import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import path from "path";

export default defineConfig(({ command }) => {
  // GitHub Pages 部署路径：https://<user>.github.io/Minimal-Desktop/
  const base = command === 'build' ? '/Minimal-Desktop/' : '/';
  return {
    base,
    plugins: [
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
    server: {
      proxy: {
        // dev 环境：将 /api/suggest 代理到百度建议接口，服务端转发无 CORS 限制
        '/api/suggest': {
          target: 'https://suggestion.baidu.com',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/suggest/, '/su'),
        },
      },
    },
  };
});
