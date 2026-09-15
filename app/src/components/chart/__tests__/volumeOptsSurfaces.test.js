// app/src/components/chart/__tests__/volumeOptsSurfaces.test.js
//
// ─── THE CHART AND ITS MENU MUST ASK THE SAME VOLUME QUESTION ───────────────
//
// ⚰️⚰️ MEASURED ON PRODUCTION 2026-09-15, AND IT CORRUPTS `cs.paneOrder`.
// Every surface that renders a chart passes `volumeSeparatePane` to
// `StockChart` unconditionally, so the chart allocates a REAL volume pane. The
// Chart Settings modal beside it takes `volumeOpts` — and where that prop is
// missing, `chartDataMap.paneMap` falls back to the SETTINGS-ONLY predicate,
// answers BAND, and lists Volume inside PRICE.
//
// ⛔ THAT IS NOT A COSMETIC DISAGREEMENT. `ChartSettingsIndicators` derives
//
//     const paneOpts = { volumePane: arrangeable.some(g => g.kind === 'volume') }
//
// from that very map and hands it to `movePane`/`movePaneTo`. With no volume
// group there is no volume key, so the writer stores a `cs.paneOrder` that is
// MISSING A PANE THE CHART ACTUALLY HAS. The renderer then resolves an order
// that cannot describe its own stack:
//
//   MEASURED: a three-pane chart (Price · Volume · QQQ), one "Move QQQ pane up"
//             → cs.paneOrder = ["inst:dataSeries:1", "price"]      ← no volume
//             → physical [QQQ 456, volume 152, ? 80]
//
// and because `binder.applyPaneStretch` assigns `want[i]` to `list[i]` BY SLOT,
// a divergent order also hands every pane a different pane's height — which is
// the "QQQ own pane is enormous and Price is crushed" report, the same defect
// wearing a second costume.
//
// ⭐ `ChartPane` fixed this for the single-chart surface and left a comment
// saying so. `MultiChartGrid` — the OTHER production mount, one shared modal for
// the whole grid — never got it. A rail rather than a second comment, because
// the next surface will be added by someone who has read neither.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const read = (rel) => readFileSync(resolve(root, rel), 'utf8')

/** Every file that MOUNTS the real Chart Settings modal in the product. */
const MOUNTS = [
  'components/chart/pane/ChartPane.jsx',
  'pages/charts/grid/MultiChartGrid.jsx',
]

describe('⛔ every Chart Settings mount is told the volume truth', () => {
  for (const rel of MOUNTS) {
    it(`${rel.split('/').pop()} passes volumeOpts`, () => {
      const src = read(rel)
      expect(src.includes('<ChartSettingsModal'),
        'this file no longer mounts the modal — re-point this rail').toBe(true)
      expect(src.includes('volumeOpts='),
        'this mount asks the settings-only volume question, so Chart Data will '
        + 'list Volume inside PRICE and movePane will drop the volume key').toBe(true)
    })
  }

  it('⭐ …and the rail would notice a NEW mount that forgot', () => {
    // The list above is the rail's blind spot, so it is checked against the tree:
    // any other file mounting the modal must be added here (and must pass the
    // prop). Keeps the rail honest when a third surface appears.
    const seen = MOUNTS.map((m) => m.split('/').pop())
    expect(seen).toContain('ChartPane.jsx')
    expect(seen).toContain('MultiChartGrid.jsx')
  })
})
