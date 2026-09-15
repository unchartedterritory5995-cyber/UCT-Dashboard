// The CALL SITE, not just the helper: the pin must be captured from the pane the
// CANDLES are in. A rail on `capturedPriceRange` alone cannot see a caller that
// goes back to passing `panes()[0]`, and that caller is where the bug lived.
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
    // the ~40 lines above the call are where paneH is resolved
    const before = src.slice(Math.max(0, i - 2200), i)
    const assign = before.slice(before.lastIndexOf('let paneH'))
    expect(assign, 'paneH is not resolved from the candle series’ own pane')
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
