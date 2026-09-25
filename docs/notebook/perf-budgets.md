# Notebook performance budgets

Wave 7, lane I. This file is the record of what the Notebook is allowed to cost and the
measurements those allowances come from. Every number here names the command that produced
it and the tree it was built from. A number with no command beside it does not belong here.

The enforced values live in `docs/notebook/perf-budgets.json` (added with the budget tool).
This file explains them.

## 1. Bundle baseline (I0, the merged `vite.config.js`)

### What changed and why the bytes moved

`app/vite.config.js` had two top-level `build` keys from 2026-09-12 (`d261d0731`) until this
change. The later key won, so the first `build` block was discarded without an error. That
block held `rollupOptions.output.manualChunks` and `chunkSizeWarningLimit`. esbuild printed a
warning about it on every build (`▲ [WARNING] Duplicate key "build" in object literal
[duplicate-object-key]`, line 5 of the pre-merge build log). Nothing read that warning.

The merge keeps both parts in one `build` object: the iOS engine floor (`target:
['safari16', 'es2021']`) and the `manualChunks` map. It also adds `manifest: true`, which
changes no chunk and writes `dist/.vite/manifest.json` for the budget tool.
`app/src/__tests__/viteConfigDuplicateKeys.test.js` fails on a duplicate key anywhere in any
`vite*.config*` file. It also fails if the evaluated config loses the floor or the chunk map.

### How it was measured

- **Before:** `npm run build` at `4fdda82cd` (both `build` keys present). The same config was
  then rebuilt with `manifest: true` added to the winning block, into a scratch outDir. That
  second build changes no chunk: all 300 JS file names and sizes match the first build.
- **After:** `npm run build` on the merged config, meaning the tree of the commit that adds
  this section (its hash is cited in §2, which lands after it).
- **Byte counts:** raw bytes from `ls -l app/dist/assets`. They are not gzip sizes.
- **"First-open" bytes:** the JS a browser must fetch before a route can render. That is the
  static `imports` closure in the manifest from `index.html` plus the route's lazy root(s).
  Dynamic imports are not included, because they load on demand.

### The table

| chunk | planner (`5f60d5d5b`-era dist) | before, measured at `4fdda82cd` | after, merged | Δ vs before |
|---|---:|---:|---:|---:|
| entry `index-*.js` | 1,110,611 | 1,110,611 | **867,080** | −243,531 |
| `vendor-react-*.js` (entry preload) | — | — | 221,408 | new |
| `vendor-swr-*.js` (entry preload) | — | — | 19,870 | new |
| **entry + its preloads** | 1,110,611 | 1,110,611 | **1,108,358** | −2,253 |
| `vendor-charts-*.js` (lazy) | — | — | 185,379 | new |
| `vendor-echarts-*.js` (lazy) | — | two auto chunks, 561,021 + 588,935 | 1,142,871 | −7,085 |
| `tiptap-*.js` | 356,136 | 356,136 | 356,312 | +176 |
| `NotebookTab-*.js` | 270,020 | 270,043 | 270,227 | +184 |
| `askInsert-*.js` | 321,821 | 321,821 | 321,893 | +72 |
| `katexRender-*.js` (lazy) | 261,253 | 261,253 | 261,253 | 0 |
| `PdfDocumentViewer-*.js` (lazy) | 482,700 | 482,700 | 482,773 | +73 |
| all JS in `dist/assets` | 11,745,480 | 11,745,503 (300 files) | 11,750,448 (301 files) | +4,945 |
| `vendor-*` chunks | 0 | 0 | 4 | — |
| **Notebook route first-open** (entry + `JournalLayout` + `NotebookSurface`, static closure) | not measured | 2,324,697 | **2,323,886** | −811 |

The planner's figures differ from the `4fdda82cd` build by 23 bytes, in `NotebookTab` and the
all-JS total. `4fdda82cd` itself only touched backend files. The planner's dist was built
before `5f60d5d5b`, and the provenance of that dist was inferred in the plan, not proven.

### Every large movement, explained

- **Entry −243,531.** React, react-dom, scheduler and react-router moved into `vendor-react`
  (221,408 B), and swr moved into `vendor-swr` (19,870 B). The entry preloads both, so the JS
  fetched before first paint went from 1,110,611 to 1,108,358 (−2,253). The gain is caching:
  a deploy that does not touch React leaves those two chunks' hashes unchanged, so returning
  browsers reuse them.
- **tiptap +176, NotebookTab +184, askInsert +72, PdfDocumentViewer +73.** These chunks now
  import React from `vendor-react` as well as from the entry. In `tiptap` that is two more
  import statements (5 → 7), and those statements account for +76 of its +176 bytes. The rest
  is minified identifiers renamed around the new imports. That split was inferred and not
  isolated.
- **echarts: two chunks → one, −7,085 in total, and a regression on three routes.** Without
  `manualChunks`, Rollup put echarts in two chunks: the zrender and echarts core (561,021 B)
  and the charts and components (588,935 B). The Calendar ("UCT Terminal") and MyStocks
  routes needed only the core. The `vendor-echarts` entry merges both halves into one chunk,
  so those routes now fetch all of echarts. Measured over all 103 lazy routes the entry
  reaches:

  | route | before | merged | Δ |
  |---|---:|---:|---:|
  | `research/ResearchPage.jsx` | 3,238,246 | 3,818,902 | **+580,656** |
  | `Calendar.jsx` | 2,029,024 | 2,609,499 | **+580,475** |
  | `calendar/MyStocksHub.jsx` | 1,975,952 | 2,556,427 | **+580,475** |
  | the other 93 routes | — | — | −9,278 to −1,239 each |

  The fix is a variant with one change: remove `'vendor-echarts'` from the map. It was built
  and measured the same way. The three routes return to before −1,343. No route is worse than
  before by more than 375 B, and that 375 B is the legacy v8 `JournalTwoRoot`. The other
  routes give back up to ~7 KB of the merged config's gains. **This file does not choose
  between them.** The brief kept the map intact, so the map is intact here. The measurement
  and the one-line alternative go to the controller.

### Does the merged bundle still start?

Re-enabling a chunk map is how the 2026-08-09 "reading 'PureComponent'" crash shipped: a
module evaluated before its React import was ready. The unit suite cannot see this, so
every lazy route module was loaded in headless Chromium and module evaluation was checked.
The test served `dist` from a loopback port, checked a per-run nonce, loaded `/`, then ran
`import()` on each of the 103 unique route modules in `index.html`'s `dynamicImports`.

| dist | routes evaluated | rejected | page errors |
|---|---:|---:|---:|
| before (control) | 103 | 0 | 0 |
| merged | 103 | 0 | 0 |
| before, one route chunk poisoned (negative control) | 102 ok | **1** (`PostMarket.jsx: Error: w7i-negative-control`) | 0 |

This is a local check. It is not device or certification evidence.
