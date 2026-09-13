/**
 * Config for the Options Flow MEMBER PERFORMANCE CONTRACT only.
 *
 * The base config EXCLUDES `OptionsFlow.perfContract.test.jsx`, because that
 * file refuses to run unless the production flow flags are present and Vite
 * inlines `import.meta.env.VITE_*` at transform time -- so it cannot configure
 * itself, and left in the default suite it would turn every plain `vitest run`
 * red. This config puts it back and is paired with `--mode flowperf`, which
 * loads `.env.flowperf` (the four flags, mirroring Railway `web`).
 *
 * ⛔ It re-states ONLY the exclude list. Everything else -- jsdom, setupFiles,
 * the 8 GB worker heap, the fork cap -- is inherited from vite.config.js, so
 * this file can never drift into being a second authority over the test
 * environment.
 *
 *     npm run test:flowperf
 */
import base from './vite.config.js'

export default {
  ...base,
  test: {
    ...base.test,
    // Default excludes minus the perf contract itself.
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
}
