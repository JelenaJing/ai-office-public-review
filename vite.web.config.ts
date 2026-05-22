import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

/**
 * Vite config for the browser (Web) build.
 *
 * Intentionally does NOT include vite-plugin-electron — running this config
 * starts a plain Vite dev server without spawning Electron.
 *
 * Entry HTML:  index.web.html  →  src/web-main.tsx
 * Dev URL:     http://localhost:5173/
 */
export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },

  server: {
    port: 5173,
    open: '/index.web.html',
  },

  build: {
    outDir: 'dist-web',
    rollupOptions: {
      input: path.resolve(__dirname, 'index.web.html'),
    },
  },
})
