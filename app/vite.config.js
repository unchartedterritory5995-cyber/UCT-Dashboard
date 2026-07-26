import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

/** Pre-launch metadata swap.
 *
 * index.html's title/description/OG tags sell the product and promise a
 * 7-day free trial. While VITE_COMING_SOON=1 there is nothing to sign up for,
 * and this metadata is exactly what a social link preview shows — so it has to
 * change with the page. It must happen at BUILD time, not runtime: crawlers
 * (X, Discord, iMessage, Slack) read the served HTML and never execute JS.
 *
 * Unset the flag and the original marketing metadata comes back untouched.
 */
function comingSoonMeta() {
  const TITLE = 'UCT Intelligence — Coming soon'
  const DESC =
    'A daily intelligence desk for traders. The Morning Wire at 7:35, the '
    + 'UCT 20, live market breadth, and a coach that reviews every trade you '
    + 'take. Join the launch list.'
  // A DIFFERENT filename, not a replacement of og-image.png: social platforms
  // cache preview images hard by URL, so a new path is what actually makes the
  // new card show up — and it leaves the launch card untouched for launch day.
  // Served by an explicit route in api/main.py (the SPA catch-all would
  // otherwise hand crawlers index.html).
  const IMAGE = 'https://uctintelligence.com/og-coming-soon.png'

  return {
    name: 'uct-coming-soon-meta',
    transformIndexHtml(html) {
      if (process.env.VITE_COMING_SOON !== '1') return html
      return html
        .replace(/<title>[\s\S]*?<\/title>/, `<title>${TITLE}</title>`)
        .replace(
          /(<meta\s+name="description"\s+content=")[^"]*(")/,
          `$1${DESC}$2`,
        )
        .replace(
          /(<meta\s+property="og:title"\s+content=")[^"]*(")/,
          `$1${TITLE}$2`,
        )
        .replace(
          /(<meta\s+property="og:description"\s+content=")[^"]*(")/,
          `$1${DESC}$2`,
        )
        .replace(
          /(<meta\s+name="twitter:title"\s+content=")[^"]*(")/,
          `$1${TITLE}$2`,
        )
        .replace(
          /(<meta\s+name="twitter:description"\s+content=")[^"]*(")/,
          `$1${DESC}$2`,
        )
        .replace(
          /(<meta\s+property="og:image"\s+content=")[^"]*(")/,
          `$1${IMAGE}$2`,
        )
        .replace(
          /(<meta\s+name="twitter:image"\s+content=")[^"]*(")/,
          `$1${IMAGE}$2`,
        )
    },
  }
}

export default defineConfig({
  plugins: [react(), comingSoonMeta()],
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
