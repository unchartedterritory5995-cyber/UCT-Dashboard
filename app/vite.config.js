import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // React + every package React's runtime depends on MUST live in
            // the same chunk. `scheduler` and `use-sync-external-store` are
            // peer deps that touch React internals on import — if they load
            // from a different chunk than React itself, you get
            // "Cannot set properties of undefined (setting 'Activity')".
            if (
              id.includes('react-dom') ||
              id.includes('/react/') ||
              id.includes('react-router') ||
              id.includes('/scheduler/') ||
              id.includes('use-sync-external-store')
            ) return 'vendor-react'
            if (id.includes('swr')) return 'vendor-swr'
            if (id.includes('lightweight-charts')) return 'vendor-charts'
            if (id.includes('echarts')) return 'vendor-echarts'
            if (id.includes('recharts')) return 'vendor-recharts'
            if (id.includes('@tiptap') || id.includes('prosemirror')) return 'vendor-tiptap'
            if (id.includes('@picovoice')) return 'vendor-picovoice'
            return 'vendor-misc'
          }
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8000'
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test-setup.js',
    server: {
      deps: {
        // Alias the broken @picovoice/porcupine-web package to our test stub
        // (its package.json exports don't resolve under vitest's resolver).
        inline: [/@picovoice\/porcupine-web/],
      },
    },
    alias: {
      '@picovoice/porcupine-web': fileURLToPath(
        new URL('./src/test-stubs/porcupine-web.js', import.meta.url)
      ),
    },
  },
})
