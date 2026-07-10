import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import path from "path";

export default defineConfig(({ command }) => {
  // GitHub Pages 部署路径：https://<user>.github.io/Minimal-Desktop/
  // 用 command 而非 NODE_ENV 判断，避免环境变量 NODE_ENV=production 影响 dev 预览的 base 路径
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
  };
});
