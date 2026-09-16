// app/src/components/chart/__tests__/priceAxisPinSite.test.js
//
// ─── THE CALL SITES, NOT JUST THE ARITHMETIC ────────────────────────────────
//
// ⚰️⚰️ THE PRODUCTION CRUSH CAME FROM A DENOMINATOR, TWICE. Both sites took a
// pixel row that lives inside the CANDLES' pane and divided it by the height of
// whatever pane happens to be FIRST. While Price was always first those were the
// same number; with a pane above Price they are not, and the result is a stored
// value that leaves the candles a sliver of their pane.
//
// ⛔ A RAIL ON THE HELPER CANNOT SEE THIS. `capturedPriceRange` can be perfect
// and the caller can still hand it `panes()[0]`, which is exactly where the bug
// lived — so these read the call sites.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const src = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../StockChart.jsx'), 'utf8')

describe('⛔ the axis-drag capture asks the CANDLES for their pane', () => {
  it('reads the height from the candle series, not from physical pane 0', () => {
    const i = src.indexOf('const pinned = capturedPriceRange(')
    expect(i, 'the capture call site moved — re-point this rail').toBeGreaterThan(0)
    const before = src.slice(Math.max(0, i - 2200), i)
    const assign = before.slice(before.lastIndexOf('let paneH'))
    expect(assign, 'paneH is not resolved from the candle series own pane')
      .toMatch(/series\.getPane\?\.\(\)\?\.getHeight/)
    expect(/^\s*paneH = chart\.panes\??\.\(\)\[0\]/m.test(assign),
      'paneH went back to physical pane 0').toBe(false)
  })

  it('⛔ Price-owned primitives attach to PRICE’s pane', () => {
    // The watermark and the session shade are Price-owned chrome and were
    // attached to `panes()[0]` by the same assumption.
    for (const name of ['wmCtrlRef', 'sessionShadeRef']) {
      const at = src.indexOf(`${name}.current.primitive`)
      expect(at, `${name} attach site not found`).toBeGreaterThan(0)
      const line = src.slice(src.lastIndexOf('\n', at) + 1, src.indexOf('\n', at))
      expect(line, `${name} still attaches to physical pane 0`)
        .toMatch(/candleSeriesRef\.current\?\.getPane\?\.\(\)/)
    }
  })
})

describe('⚰️⚰️ the PERSISTED view lock measures against PRICE’s pane', () => {
  it('_measureViewLock divides by the candle pane, not the first pane', () => {
    // ⛔ THIS IS THE ONE THAT SURVIVED EVERYTHING ELSE. The measurement is
    // stored by `persistViewLock()` and re-applied on every load through
    // `vertMarginsRef`, which OUTRANKS the computed margins — so one drag on a
    // chart with a pane above Price poisons the saved layout permanently, and no
    // correction to `computePaneLayout` can reach it.
    //
    // `priceToCoordinate` returns a row inside the candles' pane; dividing it by
    // `chart.paneSize()` (the FIRST pane) saturates the 0.9 clamp and stores a
    // lock that leaves the candles ~10% of their pane. Measured on production as
    // NVDA ~212 against a Price scale running to ~625–880, surviving refresh and
    // two deploys.
    const i = src.indexOf('const _measureViewLock')
    expect(i, '_measureViewLock moved — re-point this rail').toBeGreaterThan(0)
    const body = src.slice(i, i + 4000)
    const at = body.indexOf('let paneH')
    expect(at, 'paneH assignment not found').toBeGreaterThan(0)
    const assign = body.slice(at, at + 500)
    expect(assign, 'paneH is not taken from the candle series own pane')
      .toMatch(/series\?\.getPane\?\.\(\)\?\.getHeight/)
    // `chart.paneSize()` may survive only as a FALLBACK, never the first source.
    const firstAssignment = assign.split('\n').slice(0, 2).join('\n')
    expect(/paneSize\(\)/.test(firstAssignment),
      'paneSize() is still the primary source').toBe(false)
  })

  it('⛔ the candle series is resolved BEFORE paneH is measured', () => {
    // The fix depends on `series` being in scope at the measurement; if a future
    // edit moves the declaration back below it, `paneH` silently falls through to
    // the pane-0 fallback and the bug returns quietly.
    const i = src.indexOf('const _measureViewLock')
    const body = src.slice(i, i + 4000)
    expect(body.indexOf('const series = candleSeriesRef.current'))
      .toBeLessThan(body.indexOf('let paneH'))
  })
})
