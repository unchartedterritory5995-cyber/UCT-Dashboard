import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        // Object form (NOT function form): Rollup walks the dependency
        // graph and bundles React + every package that imports React into
        // vendor-react automatically. Function form whitelists by name
        // and silently dumps React-dependent libs into vendor-misc, which
        // crashes at runtime with "Cannot read properties of undefined
        // (reading 'PureComponent' / 'Activity' / ...)".
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-swr': ['swr'],
          'vendor-charts': ['lightweight-charts'],
          'vendor-echarts': ['echarts', 'echarts-for-react'],
          'vendor-recharts': ['recharts'],
          'vendor-tiptap': [
            '@tiptap/react', '@tiptap/starter-kit', '@tiptap/core',
            '@tiptap/extension-image', '@tiptap/extension-link',
            '@tiptap/extension-placeholder', '@tiptap/suggestion',
          ],
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
    // The full suite (~1000 tests under jsdom + echarts/recharts) peaks near
    // the default ~4GB worker heap and OOMs a fork mid-run ("Ineffective
    // mark-compacts near heap limit"), producing false-positive failures.
    // Give the test workers more headroom so `vitest run` completes cleanly.
    pool: 'forks',
    poolOptions: {
      forks: { execArgv: ['--max-old-space-size=8192'] },
    },
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
