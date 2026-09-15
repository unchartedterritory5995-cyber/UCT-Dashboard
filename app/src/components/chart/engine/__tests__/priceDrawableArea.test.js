// app/src/components/chart/engine/__tests__/priceDrawableArea.test.js
//
// ─── THE CANDLES KEEP THEIR SHARE OF THEIR OWN PANE ─────────────────────────
//
// ⚰️⚰️ THE OWNER'S PRODUCTION SCREENSHOT. NVDA around 210, arranged as
// QQQ · PRICE · VOLUME, and after a refresh the candles were pressed into a
// narrow strip at the bottom of the Price pane with the right-hand scale reading
// to roughly 1600. A series drawn in 15% of its pane needs a scale ~6.6x its own
// range, which is exactly that number.
//
// ⛔ THE CAUSE WAS A FRAME-OF-REFERENCE MIX, NOT A PANE-ORDER BUG. The 30%
// headroom (`MAIN_TOP`) was taken off the WHOLE plot area and the candles got
// whatever survived the oscillator stack. `MAX_STACK_C` — 69 hundredths — says
// it out loud: the shipped ceiling permitted a stack that left the candles ONE
// PERCENT of the chart. Measured on `chartHeight: 700`, the candles' share of
// their own pane as own panes were added:
//
//     separate volume   0.700 → 0.646 → 0.570 → 0.433 → 0.248
//     banded volume     0.550 → 0.471 → 0.357 → 0.151 → 0.022
//
// ⚠️ AND IT WAS PRE-EXISTING. The arithmetic is byte-identical at `7ac0e0aee`,
// master before pane ordering merged. Pane ordering did not introduce it — it
// made it REACHABLE, because adding an own pane went from rare to one click.
// Arrangement is not a factor: the rails below assert Price's margins are the
// same with a pane above it and below it.
//
// ⭐ SO THE RAIL IS A RATIO, NOT A CONSTANT. "The candles get 70% of what is
// theirs" holds for every stack size, which is what makes the squish
// unconstructible rather than merely absent at the sizes someone thought to try.

import { describe, it, expect } from 'vitest'
import { computePaneLayout } from '../paneLayout'
import { PRICE_PANE, VOLUME_PANE } from '../paneOrder'

const inst = (defId, id) => ({ defId, instanceId: id, inputs: {} })

/** A separate volume pane — the shipped shape, and the owner's. */
const SEPARATE = {
  chartHeight: 700, separatorPx: 1, hasVolumeBand: false,
  firstPaneIndex: 2, abovePct: [78, 22], mainPaneIndex: 0,
}
/** Volume drawn as a BAND inside the candles' own pane. */
const BANDED = {
  chartHeight: 700, separatorPx: 1, hasVolumeBand: true,
  firstPaneIndex: 1, abovePct: [100], mainPaneIndex: 0,
}

const STACKS = [
  ['0 own panes', []],
  ['1 own pane', [inst('dataSeries', 'q')]],
  ['2 own panes', [inst('dataSeries', 'q'), inst('rsi', 'r')]],
  ['3 own panes', [inst('dataSeries', 'q'), inst('rsi', 'r'), inst('macd', 'm')]],
  ['4 own panes', [inst('dataSeries', 'q'), inst('rsi', 'r'), inst('macd', 'm'), inst('atr', 'a')]],
]

/** What fraction of the PRICE PANE the candles may actually paint in. */
const drawable = (layout) => {
  const m = layout.pane0.mainMargins
  return 1 - m.top - m.bottom
}

/**
 * The candles' share of the space that is THEIRS — the pane minus whatever the
 * volume band legitimately occupies. Must be `1 - MAIN_TOP` always.
 */
const shareOfOwnSpace = (layout) => {
  const m = layout.pane0.mainMargins
  return (1 - m.top - m.bottom) / (1 - m.bottom)
}

describe('⚰️⚰️ the candles are not squeezed out by their neighbours', () => {
  for (const [name, instances] of STACKS) {
    it(`${name} — a separate volume pane`, () => {
      const l = computePaneLayout(instances, SEPARATE)
      expect(shareOfOwnSpace(l), `headroom ate the pane: ${JSON.stringify(l.pane0.mainMargins)}`)
        .toBeCloseTo(0.70, 6)
      expect(l.pane0.mainMargins.top, 'the headroom moved with the stack').toBeCloseTo(0.30, 6)
      // ⛔ AND NOTHING IS RESERVED FOR A BAND THAT IS NOT THERE.
      expect(l.pane0.mainMargins.bottom, 'Price reserved volume-band space with volume in its own pane').toBe(0)
      expect(l.pane0.volumeMargins, 'a separate volume pane was given band margins').toBeNull()
    })

    it(`${name} — a banded volume`, () => {
      const l = computePaneLayout(instances, BANDED)
      // ⚠️ THE BAND SHARES THE PANE, so the headroom is 30% of the PANE and the
      // candles get what is left after the band — `shareOfOwnSpace` is 0.647
      // here, not 0.70, and that is correct. What must not move is the HEADROOM:
      // it is the term the stack used to inflate.
      expect(l.pane0.mainMargins.top, 'the headroom moved with the stack').toBeCloseTo(0.30, 6)
      // The band gets its own share, and the two agree on the boundary.
      expect(l.pane0.volumeMargins, 'the band lost its margins').toBeTruthy()
      expect(l.pane0.volumeMargins.top)
        .toBeCloseTo(1 - l.pane0.mainMargins.bottom, 12)
    })
  }

  it('⛔⛔ the drawable share does NOT decay as panes are added', () => {
    // ⚰️ THE REGRESSION IN ONE ASSERTION. Before the fix this sequence was
    // 0.700, 0.646, 0.570, 0.433, 0.248 — monotonically decaying toward nothing.
    const shares = STACKS.map(([, i]) => drawable(computePaneLayout(i, SEPARATE)))
    for (const s of shares) expect(s).toBeCloseTo(shares[0], 6)
    // …and the banded shape too, where it used to collapse to 0.022.
    const banded = STACKS.map(([, i]) => drawable(computePaneLayout(i, BANDED)))
    expect(Math.min(...banded), `banded candles squeezed: ${banded.map((s) => s.toFixed(3))}`)
      .toBeGreaterThan(0.45)
    expect(Math.min(...shares), `the candles were squeezed: ${shares.map((s) => s.toFixed(3))}`)
      .toBeGreaterThan(0.5)
  })

  it('⛔ a representative price lands in the MIDDLE of its pane, not the floor', () => {
    // Deterministic and synthetic — no market data. A series whose values span
    // 200..220 autoscales to the drawable band; the midpoint 210 must sit near
    // the middle of the pane, not in the bottom sixth as the screenshot showed.
    const l = computePaneLayout(STACKS[4][1], SEPARATE)
    const m = l.pane0.mainMargins
    // 210 is the midpoint of the series, so it paints at the middle of the band.
    const yFrac = m.top + (1 - m.top - m.bottom) * 0.5
    expect(yFrac, `210 painted at ${yFrac.toFixed(3)} of the pane — the screenshot's floor`)
      .toBeLessThan(0.75)
    expect(yFrac).toBeGreaterThan(0.25)
    // ⛔ AND THE IMPLIED SCALE RANGE IS SANE. A 20-wide series drawn in
    // `drawable` of the pane implies a scale spanning 20/drawable. At the
    // screenshot's ~0.15 that is ~133 for a 20-wide series — the runaway axis.
    const impliedRange = 20 / (1 - m.top - m.bottom)
    expect(impliedRange, 'the price scale would run away').toBeLessThan(40)
  })
})

describe('⛔ ARRANGEMENT is not a factor — only the size of the stack', () => {
  // This is what separates the two competing hypotheses. If the squish came
  // from a foreign series contaminating Price's scale, moving that series would
  // change Price's geometry. It does not: the margins are identical.
  const one = [inst('dataSeries', 'q')]
  const cases = [
    ['QQQ above Price', ['q', PRICE_PANE, VOLUME_PANE]],
    ['QQQ below Price', [PRICE_PANE, 'q', VOLUME_PANE]],
    ['QQQ at the bottom', [PRICE_PANE, VOLUME_PANE, 'q']],
    ['Price at the bottom', ['q', VOLUME_PANE, PRICE_PANE]],
  ]
  const margins = cases.map(([, order]) =>
    computePaneLayout(one, { ...SEPARATE, order }).pane0.mainMargins)

  for (let i = 0; i < cases.length; i++) {
    it(`${cases[i][0]} — same Price margins`, () => {
      expect(margins[i]).toEqual(margins[0])
      expect(margins[i].bottom).toBe(0)
    })
  }
})
