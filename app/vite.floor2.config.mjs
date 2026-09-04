// LOCAL-ONLY dev config for previewing the Community redesign inside the full
// app shell. Serves the app on :5200 and proxies /api to the isolated backend
// on :8010 (throwaway data dir + fresh admin). Not used by any build/deploy.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5200,
    strictPort: true,
    proxy: { '/api': 'http://localhost:8011' },
  },
})
