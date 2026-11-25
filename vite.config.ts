import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages 프로젝트 페이지: https://youngma2.github.io/study-check-app/
  base: '/study-check-app/',
  plugins: [react()],
  build: {
    rollupOptions: {
      // 두 페이지: 실제 앱(index.html) · 🧪 뽑기 상자 체험(demo.html)
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        demo: fileURLToPath(new URL('./demo.html', import.meta.url)),
      },
    },
  },
  server: { host: '127.0.0.1', port: 5174, strictPort: true },
  preview: { host: '127.0.0.1', port: 4174, strictPort: true },
});
