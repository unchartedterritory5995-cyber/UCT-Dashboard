// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.o1Sonarlab.test.js
//
// ─── O1 (step 67) G2a + G2b — sonarlab-order-blocks, through the member door ──
//
// sonarlab places each order block on the first green (red) candle 4 to 15 bars
// back — a first-match `for … break` (G2a) — and removes it when the previous
// close crosses its top (bottom), read through a local (`top =
// box.get_top(sbox)`, G2b). With both, the member door attaches it.
//
// ⛔ NO TRADINGVIEW CAPTURE OF THIS SCRIPT EXISTS. The bars are the vendor's own
// (three committed captures used for their OHLC only), and the boxes the door
// holds at the last bar are checked against the script's Pine semantics computed
// INDEPENDENTLY below, step by step from the bars — the ROC, its crossings, the
// `cross_index` spacing, the first-match search, the creation, the mitigation
// sweep — never against the engine's own reading. TradingView's collector
// (`max_boxes_count = 20`) removes the OLDEST live box, so what it still holds is
// the newest K of the boxes the script itself keeps alive; K is the engine's
// collector (C7, graded on its own captures), and every held box must be one of
// the K newest the script keeps.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import * as registry from '../../nativeRegistry'
import { runOurSide, HARNESS_DEF_ID } from './ourSide'
import { REPO } from './harness'

const SCRIPT = path.join(REPO, 'corpus/committed/sonarlab-order-blocks__0df0d45ee6.pine')
const CAPTURES = [
  'adx-and-di-for-v4-rddt-1d-2026-09-27.json', // NYSE:RDDT 1D, from the listing
  'vw-deadband-ticks-aapl-1d-2026-09-28.json', // AAPL 1D, from the listing, 11k bars
  'vw-deadband-ticks-brk-a-1d-2026-09-28.json', // BRK.A 1D, NOT from the listing
]

afterEach(() => { vi.unstubAllEnvs() })

/** The script, step by step, at its default inputs (sensitivity 28 / 100, mitigation "Close"). */
function sonarlab(cap) {
  const F = cap.bars.fields
  const col = (k) => cap.bars.rows.map((r) => r[F.indexOf(k)])
  const o = col('open'); const hi = col('high'); const lo = col('low'); const c = col('close')
  const n = o.length
  const sens = 28 / 100 // `/` on two ints is fractional in Pine ("5/2 = 2.5", operators page)
  const pc = o.map((v, t) => (t >= 4 ? (v - o[t - 4]) / o[t - 4] * 100 : NaN))
  const under = (t, y) => t >= 1 && pc[t] < y && pc[t - 1] > y
  const over = (t, y) => t >= 1 && pc[t] > y && pc[t - 1] < y
  let crossIndex = NaN
  const shortBoxes = []
  const longBoxes = []
  let made = 0
  for (let t = 0; t < n; t += 1) {
    const bear = under(t, -sens)
    const bull = over(t, sens)
    const before = crossIndex // `cross_index[1]`: its value at the end of the previous bar
    if (bear) crossIndex = t
    if (bull) crossIndex = t
    const spaced = crossIndex - before > 5 // `na` on either side is false
    const firstBack = (green) => {
      for (let i = 4; i <= 15; i += 1) {
        if (t - i >= 0 && (green ? c[t - i] > o[t - i] : c[t - i] < o[t - i])) return i
      }
      return 0
    }
    if (bear && spaced) { const g = firstBack(true); shortBoxes.push({ left: t - g, top: hi[t - g], bottom: lo[t - g], made: made++ }) }
    if (bull && spaced) { const g = firstBack(false); longBoxes.push({ left: t - g, top: hi[t - g], bottom: lo[t - g], made: made++ }) }
    const m = t >= 1 ? c[t - 1] : NaN
    for (let i = shortBoxes.length - 1; i >= 0; i -= 1) if (m > shortBoxes[i].top) shortBoxes.splice(i, 1)
    for (let i = longBoxes.length - 1; i >= 0; i -= 1) if (m < longBoxes[i].bottom) longBoxes.splice(i, 1)
  }
  return [...shortBoxes, ...longBoxes].sort((a, b) => a.made - b.made)
}

describe('O1 G2a + G2b — sonarlab-order-blocks holds the boxes its Pine semantics keep', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8')

  for (const name of CAPTURES) {
    it(name, () => {
      const cap = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/harness', name), 'utf8'))
      vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
      const ours = runOurSide({ ...cap, source: { ...cap.source, text: source } })
      registry.uninstallUserDefinition(HARNESS_DEF_ID)
      expect(ours.ok, ours.refusal).toBe(true)
      const held = ours.objects.held.filter((x) => x.family === 'box')
      const alive = sonarlab(cap)
      expect(held.length, 'non-vacuity: boxes are drawn').toBeGreaterThan(0)
      expect(held.length).toBeLessThanOrEqual(Math.min(alive.length, 25))
      const key = (b) => `${b.left}|${b.top}|${b.bottom}`
      const newest = alive.slice(alive.length - held.length).map(key).sort()
      expect(held.map((b) => key(b.props)).sort()).toEqual(newest)
      for (const b of held) expect(b.props.right).toBe(b.props.left)
    })
  }
})
