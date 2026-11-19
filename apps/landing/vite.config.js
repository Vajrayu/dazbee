import { defineConfig } from 'vite'

// 3100 keeps clear of the web app (3000) and the API (8788).
export default defineConfig({
  server: { port: 3100, strictPort: true },
  preview: { port: 3100, strictPort: true },
})
