import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

const GATEWAY = process.env.GATEWAY_BASE ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // 仅本机自用：只绑定回环地址
    host: '127.0.0.1',
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    proxy: {
      // 前端所有请求都走同源 /api，由 Vite 转发到网关；音频流的 Range 头会原样透传
      '/api': {
        target: GATEWAY,
        changeOrigin: false,
      },
    },
  },
});
