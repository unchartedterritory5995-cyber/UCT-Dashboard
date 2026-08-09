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
    'The Trading Brain you need as a companion. Join the launch list.'
  // A DIFFERENT filename, not a replacement of og-image.png: social platforms
  // cache preview images hard by URL, so a new path is what actually makes the
  // new card show up — and it leaves the launch card untouched for launch day.
  // Served by an explicit route in api/main.py (the SPA catch-all would
  // otherwise hand crawlers index.html).
  //
  // ⚠️ BUMP ?v= EVERY TIME THE CARD IS REGENERATED. The route sets
  // max-age=86400, so Cloudflare pins the old bytes at the edge for a day
  // (observed: cf-cache-status HIT serving the previous card after deploy) and
  // X/Discord/iMessage cache their copy far longer. Both key on the FULL url,
  // so the query string is what actually busts them. FastAPI ignores the param.
  const IMAGE = 'https://uctintelligence.com/og-coming-soon.png?v=sep5-mark'

  // The JSON-LD block declares two purchasable Offers ($200/mo, $2000/yr) and a
  // 7-day free trial. That is machine-readable "you can buy this now" that
  // Google can surface as a rich result with prices — while /checkout is 403.
  // Pre-launch it keeps the brand entity and drops every offer.
  const JSONLD = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'UCT Intelligence',
    applicationCategory: 'FinanceApplication',
    url: 'https://uctintelligence.com/',
    description:
      'The Trading Brain you need as a companion. Launching soon.',
    publisher: {
      '@type': 'Organization',
      name: 'Uncharted Territory',
      url: 'https://uctintelligence.com/',
    },
  }, null, 2)

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
        .replace(
          /(<script type="application\/ld\+json">)[\s\S]*?(<\/script>)/,
          `$1\n${JSONLD}\n    $2`,
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
        // ⭐ EVERY React entry point must be listed, not just 'react'.
        //
        // Listing bare 'react' matches ONE module id. React's other entry
        // points (`react/jsx-runtime`, `react-dom/client`) are separate ids,
        // so Rollup assigned them by its own shared-module algorithm — and
        // measured on 2026-08-09 it put `react/jsx-runtime` in vendor-TIPTAP
        // and React's CJS body in vendor-SWR. Every component uses the JSX
        // runtime, so the entry chunk statically imported vendor-tiptap to
        // get it, which in turn pulled vendor-recharts. That cascade — not
        // any source-level dependency — is why 231 KB gz of a rich-text
        // editor and a second chart library loaded on the LOGIN screen.
        //
        // Verify with app/vite.config.chunkmap.mjs-style module→chunk dump,
        // never by reading this list: the failure is silent and the entry
        // still works, it is just 231 KB heavier.
        manualChunks: {
          'vendor-react': [
            'react', 'react/jsx-runtime', 'react/jsx-dev-runtime',
            'react-dom', 'react-dom/client', 'scheduler', 'react-router-dom',
          ],
          'vendor-swr': ['swr'],
          'vendor-charts': ['lightweight-charts'],
          'vendor-echarts': ['echarts', 'echarts-for-react'],
          // ⛔ recharts and tiptap are deliberately NOT listed.
          //
          // Naming a package here FORCES a chunk into existence, and Rollup
          // then hosts unassigned shared modules (React's CJS body, the JSX
          // runtime) inside it. Both libraries are reached from source ONLY
          // through lazy `import()` route edges — OptionsFlow / UCT20Backtest
          // for recharts, the Journal Notebook / Community Composer /
          // ModelBook builder for tiptap — so a forced chunk gave the shared
          // runtime a home inside a route-only library and made the LOGIN
          // screen download both.
          //
          // Unlisted, they get Rollup's default treatment: a module reached
          // from two or more dynamic entries still lands in ONE auto-created
          // shared chunk (no duplication), but that chunk hangs off the lazy
          // routes where it belongs instead of off the entry.
          //
          // This is NOT the banned function form — the object form is intact.
          // See feedback_vite_manualchunks_object_form.
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
    pool: 'forks',
    // The full suite (~3,100 tests under jsdom + echarts/recharts) peaks near
    // the default ~4GB worker heap and OOMs a fork mid-run ("Ineffective
    // mark-compacts near heap limit"), producing false-positive failures.
    // Give the test workers more headroom so `vitest run` completes cleanly.
    //
    // ⚠️ This MUST stay top-level. It lived under `poolOptions.forks.execArgv`
    // until 2026-08-01, and Vitest 4 REMOVED `poolOptions` — the block was
    // accepted silently (only a deprecation line in the log) while the heap
    // flag never reached a single worker. A config that cannot fail loudly is
    // a config that stops being true; measured, restoring it took a red run
    // from 2 timeouts to 1.
    execArgv: ['--max-old-space-size=8192'],
    // Cap the fork pool at half the machine.
    //
    // Vitest defaults to `availableParallelism() - 1` (= 23 forks on this
    // 24-core box), and that oversubscribes badly once every fork is carrying
    // its own jsdom. The SAME 377 files, same work, measured end to end:
    //
    //   workers   cumulative test time   jsdom env time   wall    result
    //   23 (dflt)        308–336s             431–470s    47–49s  RED
    //   18 (75%)            257s                 424s     52.6s   RED
    //   12 (50%)            155s                 303s     53.1s   green
    //    6 (25%)             97s                 198s     67.5s   green
    //
    // Cumulative test time TRIPLES from 25% to default while wall time barely
    // moves — that extra "parallelism" is thrashing, not throughput. Starved
    // workers are what pushed tests past `testTimeout`: at the default, six
    // tests across FIVE unrelated files (ModelBook ×2, PathView.admin,
    // BreadthWidget, PositionsTable, TradesTable) have been observed timing
    // out at 5000ms in a single run — none of them slow, all of them starved.
    // So this is not two bad tests; it is a pool that measures the scheduler
    // instead of the code. 50% is the knee: green, and no slower than 75%.
    //
    // A percentage (not a literal) so a 4-core CI box scales down with it.
    maxWorkers: '50%',
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
