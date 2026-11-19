import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// 3100 keeps clear of the web app (3000) and the API (8788).
// /privacy/ and /terms/ are linked from Google sign-in, so every build must carry them.
export default defineConfig({
  server: { port: 3100, strictPort: true },
  preview: { port: 3100, strictPort: true },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        privacy: resolve(import.meta.dirname, 'privacy/index.html'),
        terms: resolve(import.meta.dirname, 'terms/index.html'),
      },
    },
  },
})
