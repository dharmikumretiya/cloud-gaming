import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '..', '');
  return {
    plugins: [react(), tailwindcss()],
    server: { proxy: { '/api': `http://${env.BIND_ADDRESS || '127.0.0.1'}:${env.PORT || 3001}`, '/streaming': { target: `http://${env.BIND_ADDRESS || '127.0.0.1'}:${env.PORT || 3001}`, ws: true } } },
  };
});
