// app/src/components/chart/engine/__tests__/vendorHarness/vwapDailyQuotient.test.js
//
// ⭐⭐ Q-ROB5 (2026-11-16) — A DAILY `vwap` IS THE ONE-BAR SESSION'S QUOTIENT, `(price * volume) / volume`.
//
// On a daily chart every bar is its own session, and TradingView's value is that session's sums divided:
// `(price * volume) / volume`, which is not always the price bit for bit. `interpret.js::dailySessionVwap`
// returned the price, so a script that rounds the value UP to the tick
// (`ceil(vwap * 100) / 100`: mtf-key-levels-support-and-resistance's D-VWAP) drew it 0.01 low on the bars
// where the quotient lands a unit above the price: 57.29 where TradingView draws 57.3 (runtime-on DIVERGE,
// 6 bars on RDDT 1D). A tolerance compare could not see it; the `ceil` does.
//
// Two witnesses, read off committed captures:
//   1. h3-vwap-source-spy-1d-2026-10-02: S01 (bare) and S02..S07 (`ta.vwap(close)` ... `ta.vwap(ohlc4)`) are
//      the quotient BIT FOR BIT on every one of 1800 bars (the price alone: 1626-1674 of them);
//   2. mtf-key-levels-support-and-resistance-{rddt,spy}-1d-2026-11-14: the script's own D-VWAP plot
//      (`ceil(vwap * mult) / mult`) on every bar it has a value.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { interpret } from '../../ast/interpret'
import { toProductBars } from './ourSide.js'

const HARNESS = path.resolve(process.cwd(), '../tests/fixtures/vendor/harness')
const capture = (id) => JSON.parse(fs.readFileSync(path.join(HARNESS, `${id}.json`), 'utf8'))
const column = (cap, title) => {
  const plot = cap.study.plots.find((p) => p.title === title)
  const at = cap.plotValues.fields.indexOf(plot.id)
  return cap.plotValues.rows.map((r) => r[at])
}
const ourVwap = (cap, args = []) => interpret({ type: 'call', name: args.length ? 'vwapOf' : 'vwap', args },
  toProductBars(cap), {}, undefined, undefined, { tf: 'D' })

describe('a daily vwap is the one-bar session\'s quotient, as TradingView computes it', () => {
  it('h3-vwap-source-spy-1d (S01, the bare form): bit for bit on every bar', () => {
    const cap = capture('h3-vwap-source-spy-1d-2026-10-02')
    const tv = column(cap, 'S01_vwap_bare_RAW')
    const ours = ourVwap(cap)
    let compared = 0
    const off = []
    tv.forEach((v, i) => {
      if (v === null) return
      compared += 1
      if (ours[i] !== v) off.push(i)
    })
    expect(compared, 'non-vacuity').toBeGreaterThan(1000)
    expect(off).toEqual([])
  })

  for (const id of ['mtf-key-levels-support-and-resistance-rddt-1d-2026-11-14',
    'mtf-key-levels-support-and-resistance-spy-1d-2026-11-14']) {
    it(`${id}: the script's D-VWAP (rounded UP to the tick) is TradingView's on every bar`, () => {
      const cap = capture(id)
      const tv = column(cap, 'D-VWAP')
      const ours = ourVwap(cap)
      let compared = 0
      const off = []
      tv.forEach((v, i) => {
        if (v === null) return
        compared += 1
        const rounded = Math.ceil(ours[i] * (1 / 0.01)) / (1 / 0.01)
        if (rounded !== v) off.push(`${i}: ours ${rounded}, TradingView ${v}`)
      })
      expect(compared, 'non-vacuity').toBeGreaterThan(500)
      expect(off).toEqual([])
    })
  }

  it('⛔ control: the bare PRICE (the old answer) is not TradingView\'s there (the rail can tell them apart)', () => {
    const cap = capture('mtf-key-levels-support-and-resistance-rddt-1d-2026-11-14')
    const tv = column(cap, 'D-VWAP')
    const bars = toProductBars(cap)
    const off = tv.filter((v, i) => v !== null
      && Math.ceil(((bars[i].h + bars[i].l + bars[i].c) / 3) * 100) / 100 !== v).length
    expect(off).toBeGreaterThan(0)
  })
})
