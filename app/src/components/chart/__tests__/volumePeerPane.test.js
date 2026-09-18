// app/src/components/chart/__tests__/volumePeerPane.test.js
//
// ─── ONE ANSWER TO "DOES VOLUME OWN A PANE?" ────────────────────────────────
//
// ⚰️⚰️ THE RENDERER AND CHART DATA ASKED THE SAME HELPER DIFFERENT QUESTIONS.
// `nativeVolumeOwnsPane` needs `volumeSeparatePane` / `blankVolume` / `shown`, and
// those are PROPS the host hands to `StockChart`. Chart Data never received
// them, so it asked the settings-only question — and `ChartPane` passes
// `volumeSeparatePane` UNCONDITIONALLY, so on the main chart the renderer
// allocated a real volume pane while Chart Data answered BAND.
//
// ⛔ THAT ONE DISAGREEMENT PRODUCED THREE SYMPTOMS:
//   · Volume listed inside `PRICE 5` while drawn in its own pane below;
//   · `movePane` resolving an order with NO `volume` key, so the arrows had
//     nothing to cross and QQQ could not pass Volume;
//   · Volume itself unmovable, for the same reason.
//
// ⭐ SO THE HOST HANDS THE SAME INPUTS TO BOTH READERS. There is no second
// derivation left to drift.

import { describe, it, expect } from 'vitest'
import { paneMap } from '../chartDataMap'
import { nativeVolumeOwnsPane } from '../engine/volumePresentation'

/** The rows Chart Data builds from: the four price MAs plus Volume. */
const ROWS = [
  { id: 'ema9', label: 'EMA 9' },
  { id: 'ema20', label: 'EMA 20' },
  { id: 'sma50', label: 'SMA 50' },
  { id: 'sma200', label: 'SMA 200' },
  // ⚠️ THE ROW DECLARES ITS OWN PATH. `paneMap` reads `path.kind === 'section'`
  // with key `volume`, never the id — so the fixture has to be the real shape.
  { id: 'volume', label: 'Volume', path: { kind: 'section', key: 'volume' } },
]
const defOf = () => null
/** A fresh default chart: nothing says `separatePane` in the blob. */
const FRESH = { indicatorInstances: [] }
/** What `ChartPane` hands the renderer on the main chart. */
const HOST = { volumeSeparatePane: true, blankVolume: false }

const groupKinds = (settings, volumeOpts) =>
  paneMap(ROWS, settings, defOf, volumeOpts).map((g) => g.kind)

describe('⚰️⚰️ Volume is a PEER pane, and Chart Data says so', () => {
  it('⛔⛔ THE REGRESSION: without the host inputs, Volume reads as a BAND', () => {
    // The pre-fix call — settings only. Kept as the control so the fix below is
    // not proving something that could never have gone wrong.
    expect(nativeVolumeOwnsPane({ cs: FRESH }), 'the settings-only answer changed')
      .toBe(false)
    expect(groupKinds(FRESH, null), 'a volume GROUP appeared without the props')
      .not.toContain('volume')
  })

  it('⭐⭐ THE FIX: with the host inputs, Volume is its own group', () => {
    expect(nativeVolumeOwnsPane({ cs: FRESH, ...HOST })).toBe(true)
    const groups = paneMap(ROWS, FRESH, defOf, HOST)
    const vol = groups.find((g) => g.kind === 'volume')
    expect(vol, 'Volume is still not a pane group of its own').toBeTruthy()
    // …and it is NOT inside the price group any more
    const price = groups.find((g) => g.kind === 'price')
    const priceLabels = (price?.rows || []).map((r) => r.label || r.id)
    expect(priceLabels, 'Volume is still listed inside PRICE').not.toContain('Volume')
  })

  it('⛔ the renderer and the map now agree on every input combination', () => {
    // The honest statement of "one truth": for the same inputs, the two callers
    // cannot disagree, because there is only one call.
    const cases = [
      { cs: FRESH },
      { cs: FRESH, volumeSeparatePane: true },
      { cs: FRESH, blankVolume: true },
      { cs: FRESH, shown: false, volumeSeparatePane: true },
      { cs: { volume: { separatePane: true } } },
      { cs: { volumeOverlayIndicators: ['rsi'] } },
    ]
    for (const c of cases) {
      const owns = nativeVolumeOwnsPane(c)
      const mapped = groupKinds(c.cs, c).includes('volume')
      expect(mapped, `disagreement for ${JSON.stringify(c)}`).toBe(owns)
    }
  })

  it('⭐ a BANDED volume is still correctly inside Price', () => {
    // The fix must not turn every chart's volume into a pane.
    const banded = { cs: FRESH, volumeSeparatePane: false, blankVolume: false }
    expect(nativeVolumeOwnsPane(banded)).toBe(false)
    expect(groupKinds(FRESH, banded)).not.toContain('volume')
  })
})
