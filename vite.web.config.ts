import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

const redirectRootToWebIndex = (): Plugin => ({
  name: 'redirect-root-to-web-index',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const requestUrl = req.url ?? ''

      if (requestUrl === '/' || requestUrl === '') {
        res.statusCode = 302
        res.setHeader('Location', '/index.web.html')
        res.end()
        return
      }

      next()
    })
  },
})

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
  plugins: [react(), redirectRootToWebIndex()],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },

  server: {
    host: '0.0.0.0',
    port: 5173,
    open: '/index.web.html',
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },

  build: {
    outDir: 'dist-web',
    rollupOptions: {
      input: path.resolve(__dirname, 'index.web.html'),
    },
  },
})
