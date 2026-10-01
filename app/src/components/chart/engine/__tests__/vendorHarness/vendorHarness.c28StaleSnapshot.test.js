// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c28StaleSnapshot.test.js
//
// ─── C28 — A SNAPSHOT DOES NOT SEE THE CLOSING PASS, AGAINST TRADINGVIEW ─────
//
// `artemis-oscillator-pro` declares `float knnVal = 50.0` and reassigns it inside
// an `if` whose fold stops at a `for` (the k-nearest-neighbour vote). The closing
// pass condemns `knnVal` in the final env, but `knnIsBull`, `knnConf` and
// `aopScore` are bound BELOW that write, each carrying the env as it stood — so
// they read the declaration's 50 on every bar. The objects pane drew four cells
// TradingView does not: `◈ NEUTRAL` (vendor `▼ BEAR`), `0%` (`80%`),
// `29 ▼ BEAR` (`22 ▼ STRONG BEAR`) and `↓-3` (`↓-17`).
//
// ⭐ WHAT IS PINNED, against the capture (NYSE:RDDT 1D, 632 bars):
//   - every table cell the objects pane draws holds, at its table and address,
//     the text TradingView holds there — nothing drawn the vendor lacks;
//   - the four cells that read `knnVal` below its unfoldable write are withheld
//     (counted as dropped `cell:text`), not drawn;
//   - CONTROL: the cells that do not read it (the MTF panel, `KNN AI`, `K=5`)
//     are still drawn, so the rail cannot pass by drawing nothing.
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import { loadCapture } from './harness'
import { toProductBars } from './ourSide'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'
import { toRenderState } from '../../objectRenderState'

const DIR = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const ARTEMIS = 'artemis-oscillator-pro-rddt-1d-2026-09-28.json'

afterEach(() => { vi.unstubAllEnvs() })

function ourCells(cap) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  const bars = toProductBars(cap)
  const d = memberPaneDefinition({ source: cap.source.text, id: 'u_c28_stale', name: 'c28' })
  expect(d.ok, d.reason).toBe(true)
  const reader = objectReaderFor(d.definition, bars, {
    tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: cap.newestBarIsForming ?? null,
    historyFromListing: true,
  })
  const run = evaluateObjects(reader.program, {
    barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
  })
  const state = toRenderState(run.live, { bars, tf: 'D' })
  return {
    d,
    cells: state.tables.flatMap((t) => t.cells.map((c) => ({ pos: t.position, col: c.col, row: c.row, text: c.text }))),
  }
}

describe('C28 — artemis-oscillator-pro: no cell reads `knnVal` off its declaration', () => {
  it('⭐ every drawn cell is TradingView\'s text at its table and address', () => {
    const cap = loadCapture(path.join(DIR, ARTEMIS)).capture
    const vTables = new Map(cap.objects.records.tables.map((t) => [t.id, t.pos]))
    const vendor = new Map(cap.objects.records.tableCells
      .map((c) => [`${vTables.get(c.tid)}|${c.col}|${c.row}`, c.t]))
    const { cells } = ourCells(cap)
    expect(cells.length).toBeGreaterThan(10)
    for (const c of cells) {
      const key = `${c.pos}|${c.col}|${c.row}`
      expect(vendor.has(key), key).toBe(true)
      expect(c.text, key).toBe(vendor.get(key))
    }
  })

  it('🔴 the four cells that read it are withheld, and the rest still draw (control)', () => {
    const cap = loadCapture(path.join(DIR, ARTEMIS)).capture
    const { d, cells } = ourCells(cap)
    const at = (pos, col, row) => cells.find((c) => c.pos === pos && c.col === col && c.row === row)
    // the AOP score badge (middle_right) and the KNN panel (bottom_right)
    expect(at('middle_right', 1, 0)).toBeUndefined()
    expect(at('middle_right', 2, 0)).toBeUndefined()
    expect(at('bottom_right', 1, 0)).toBeUndefined()
    expect(at('bottom_right', 1, 1)).toBeUndefined()
    expect(at('middle_right', 0, 0).text).toBe('AOP')
    expect(at('bottom_right', 0, 0).text).toBe('KNN AI')
    expect(at('bottom_right', 1, 3).text).toBe('K=5')
    expect(d.translation.objectDiagnostics.dropReasons['cell:text']).toBeGreaterThanOrEqual(4)
  })
})
