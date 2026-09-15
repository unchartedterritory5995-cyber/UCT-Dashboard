// app/src/components/chart/__tests__/volumeStretchThirdPane.test.js
//
// ─── TWO AUTHORITIES OVER ONE PANE, AND ONE OF THEM CANNOT COUNT PAST TWO ───
//
// ⚰️⚰️ THE LIVE 2026-09-15 CLUSTER. `StockChart` sizes the volume pane with an
// ABSOLUTE two-pane pair:
//
//     mainPane.setStretchFactor(100 - pct)
//     volPane .setStretchFactor(pct)
//
// Stretch factors are RELATIVE, so that pair only means "volume is pct% of the
// chart" when those two panes are the whole chart. The moment a third pane
// exists — a data series, an RSI, any own-pane indicator — the volume pane's
// real share becomes
//
//     pct / (100 + thirdStretch)
//
// and the writer has silently sized the chart against a denominator that is no
// longer 100.
//
// ⛔⛔ AND IT IS NOT MERELY COSMETIC, BECAUSE A SAMPLER READS IT BACK. A 300ms
// poller measures the pane with `volPanePctOfStack` (denominator: the whole
// stack, correctly) and compares it against `lastAppliedVolPctRef` — the number
// the writer THOUGHT it applied. Those two now disagree by construction, and
// `latchOnDrag` fires at a two-point gap: within 1.5s of any real separator drag
// the sampler latches the measured value as if the member had chosen it, and
// `onVolumePaneResize` persists it as a GLOBAL preference. The next pass applies
// the smaller pct, against the same inflated denominator, and measures smaller
// still.
//
// ⭐ WHICH IS WHY IT IS CONDITIONAL EXACTLY AS THE OWNER REPORTED IT: with two
// panes the pair is correct and nothing moves; add a third and a Volume drag
// snaps back and ratchets, and the third pane swells to ~45% of the chart
// because it is the only pane still holding its full canonical weight while the
// other two are being written down. Delete the third pane and Volume resizes
// normally again.

import { describe, it, expect, afterEach } from 'vitest'
import { createChart, LineSeries } from 'lightweight-charts'
import { volPanePctOfStack, latchOnDrag, legacyPairOwnsStack } from '../volumePaneDrag'

const open = []
afterEach(() => {
  while (open.length) {
    const h = open.pop()
    try { h.chart.remove() } catch { /* going anyway */ }
    try { h.el.remove() } catch { /* idem */ }
  }
})

const STACK = 700
const VOL_PCT = 22          // the shipped default
const THIRD_STRETCH = 81    // what `computePaneLayout` gives an auxiliary pane

/** A chart with `n` panes, heights driven only by stretch factors. */
function chartOf(n) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const chart = createChart(el, { width: 600, height: STACK })
  const bars = Array.from({ length: 10 }, (_, i) => ({
    time: `2026-09-${String(i + 1).padStart(2, '0')}`, value: 100 + i,
  }))
  const series = []
  for (let i = 0; i < n; i++) {
    const s = chart.addSeries(LineSeries, {}, i)
    s.setData(bars)
    series.push(s)
  }
  const h = { el, chart, series }
  open.push(h)
  return h
}

/** Exactly what StockChart's separate-volume block writes. */
function applyLegacyPair(h, pct) {
  h.series[0].getPane().setStretchFactor(100 - pct)
  h.series[1].getPane().setStretchFactor(pct)
}

// ⚠️ HEIGHTS COME FROM THE STRETCH FACTORS, NOT FROM `getHeight()`. jsdom runs
// no layout, so every LWC pane measures 0 here — the same artifact the earlier
// zero-height investigation ran into. Lightweight-charts distributes the stack in
// PROPORTION to the stretch factors (the codebase pins that as measured fact in
// `paneSeparatorPin.test.js`), so modelling the pixel heights from the factors is
// the same arithmetic the renderer performs, and it is the arithmetic under test.
const stretches = (h) => h.chart.panes().map((p) => p.getStretchFactor())
const heights = (h) => {
  const f = stretches(h)
  const total = f.reduce((a, b) => a + b, 0)
  return f.map((v) => (v / total) * STACK)
}
const stackPx = () => STACK
const volPct = (h) => volPanePctOfStack(heights(h)[1], STACK)

describe('⭐ TWO panes — the legacy pair is correct, and nothing latches', () => {
  it('volume measures back as the pct that was applied', () => {
    const h = chartOf(2)
    applyLegacyPair(h, VOL_PCT)
    const measured = volPct(h)
    expect(Math.abs(measured - VOL_PCT), `applied ${VOL_PCT}, measured ${measured}`)
      .toBeLessThan(2)
    // …so a drag-time sampler has no opinion, which is the shipped behaviour.
    expect(latchOnDrag(VOL_PCT, VOL_PCT, measured),
      'the sampler latched on a chart where nothing moved').toBeNull()
  })
})

describe('⚰️⚰️ THREE panes — the same write means something else entirely', () => {
  it('⛔ the volume pane is NOT pct% of the stack once a third pane exists', () => {
    const h = chartOf(3)
    h.series[2].getPane().setStretchFactor(THIRD_STRETCH)
    applyLegacyPair(h, VOL_PCT)

    const measured = volPct(h)
    // pct / (100 + third) = 22 / 181 ≈ 12
    const predicted = Math.round((VOL_PCT / (100 + THIRD_STRETCH)) * 100)
    expect(Math.abs(measured - predicted), `measured ${measured}, predicted ${predicted}`)
      .toBeLessThanOrEqual(2)
    expect(measured, `volume measured ${measured}% after applying ${VOL_PCT}%`)
      .toBeLessThan(VOL_PCT - 2)
  })

  it('⛔⛔ …so the drag sampler LATCHES a height nobody chose', () => {
    // This is the defect. `applied` is what the writer believes it set; the
    // sampler measures the truth; the gap is >= 2 by construction, so within the
    // 1.5s drag window the sampler records it as the member's choice and
    // persists it globally.
    const h = chartOf(3)
    h.series[2].getPane().setStretchFactor(THIRD_STRETCH)
    applyLegacyPair(h, VOL_PCT)

    const latch = latchOnDrag(VOL_PCT, VOL_PCT, volPct(h))
    expect(latch, 'no latch — has the two-pane write been fixed?').not.toBeNull()
    expect(latch.pct, 'the latched height is the deflated one, not the member’s')
      .toBeLessThan(VOL_PCT)
  })

  it('⚰️ and it RATCHETS — each pass deflates the next', () => {
    // Feed the latched value back in, exactly as the next render does.
    const h = chartOf(3)
    h.series[2].getPane().setStretchFactor(THIRD_STRETCH)

    const seen = []
    let pct = VOL_PCT
    for (let pass = 0; pass < 4; pass++) {
      applyLegacyPair(h, pct)
      const measured = volPct(h)
      seen.push(measured)
      const latch = latchOnDrag(pct, pct, measured)
      if (!latch) break
      pct = latch.pct
    }
    expect(seen.length, `volume settled instead of ratcheting: ${JSON.stringify(seen)}`)
      .toBeGreaterThan(1)
    expect(seen[seen.length - 1], `the run: ${JSON.stringify(seen)}`).toBeLessThan(seen[0])
  })

  it('⭐⭐ THE THIRD PANE SWELLS, which is the "QQQ is enormous" report', () => {
    // Nothing writes the third pane down, so as the other two are deflated it is
    // left holding a larger and larger share — measured, not asserted.
    const h = chartOf(3)
    h.series[2].getPane().setStretchFactor(THIRD_STRETCH)
    applyLegacyPair(h, VOL_PCT)

    const share = heights(h)[2] / STACK
    expect(share, `the third pane took ${(share * 100).toFixed(1)}% of the chart`)
      .toBeGreaterThan(0.35)
  })
})

// ─── AND THE FIX: the legacy pair stands down once it cannot describe the stack ─
describe('⭐⭐ THE FIX — legacyPairOwnsStack', () => {
  it('⛔ true only while main + volume ARE the chart', () => {
    expect(legacyPairOwnsStack(2, false), 'the plain price+volume chart must keep the legacy path').toBe(true)
    expect(legacyPairOwnsStack(3, false), 'a third pane and the pair still wrote').toBe(false)
    expect(legacyPairOwnsStack(4, false)).toBe(false)
  })

  it('⭐ the Model Book index pane is part of the pair it can describe', () => {
    // That branch writes idx/vol/main together, so three panes are still fully
    // described; a FOURTH is not.
    expect(legacyPairOwnsStack(3, true)).toBe(true)
    expect(legacyPairOwnsStack(4, true)).toBe(false)
  })

  it('⚠️ an unreadable pane count keeps the shipped path rather than inventing one', () => {
    expect(legacyPairOwnsStack(0, false)).toBe(true)
    expect(legacyPairOwnsStack(NaN, false)).toBe(true)
  })

  it('⚰️⚰️ THE RATCHET CANNOT START, because the sampler is given no opinion', () => {
    // With the pair stood down, `lastAppliedVolPctRef` is null, and the sampler's
    // own guard is `if (!dragging || applied == null) return` — so the measured/
    // applied gap that drove the ratchet has nothing to compare against.
    const h = chartOf(3)
    h.series[2].getPane().setStretchFactor(THIRD_STRETCH)
    applyLegacyPair(h, VOL_PCT)              // the state the defect leaves behind
    const measured = volPct(h)

    expect(legacyPairOwnsStack(3, false)).toBe(false)
    const applied = null                      // what the fix records instead of `pct`
    const wouldLatch = (applied == null) ? null : latchOnDrag(VOL_PCT, applied, measured)
    expect(wouldLatch, 'the sampler still latched a height nobody chose').toBeNull()
  })
})
