// @vitest-environment jsdom
/* Item 6 — the chart-type catalogue on the phone.
 *
 * ⛔ THE ORPHAN THIS CLOSES. `heikinAshi` is a real field in `chartDefaults`,
 * StockChart transforms the series for it, and the bars-push single-writer
 * invariant explicitly excludes it — that is how live it is. Its only control
 * was a checkbox inside `ChartToolbar`, which the phone shell sets to
 * `display:none`. Built, working, unreachable: the Drawing Boards shape again.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import MobileChartTypeSheet, { CHART_TYPES, HEIKIN_KEY, selectedTypeKey, chartTypePatch } from './MobileChartTypeSheet'

vi.mock('../../../components/mobile/haptics', () => ({ default: { tap: () => {} } }))

beforeEach(() => cleanup())

const open = (chartType = 'candles') => {
  const onPick = vi.fn(); const onClose = vi.fn()
  render(<MobileChartTypeSheet open onClose={onClose} chartType={chartType} onPick={onPick} />)
  return { onPick, onClose }
}

describe('the catalogue', () => {
  it('offers Heikin Ashi beside the five StockChart already drew', () => {
    open()
    for (const name of ['Candles', 'Hollow', 'Bars', 'Line', 'Area', 'Heikin Ashi'])
      expect(screen.getByRole('option', { name }), `${name} is not offered`).toBeTruthy()
  })

  it('every catalogue entry is reachable — the count is derived, not typed', () => {
    open()
    expect(screen.getAllByRole('option')).toHaveLength(CHART_TYPES.length)
  })

  it('picking Heikin Ashi reports its own key, not a chartType', () => {
    const { onPick, onClose } = open()
    fireEvent.click(screen.getByRole('option', { name: 'Heikin Ashi' }))
    expect(onPick).toHaveBeenCalledWith(HEIKIN_KEY)
    expect(onClose).toHaveBeenCalled()
  })
})

describe('selection and the write agree — one function each, so a tick cannot lie', () => {
  it('a Heikin Ashi chart shows Heikin Ashi as selected, not Candles', () => {
    // The trap: `heikinAshi` pins `chartType:'candles'`, so a picker reading
    // chartType alone would tick Candles on a chart that is plainly not candles.
    expect(selectedTypeKey({ chartType: 'candles', heikinAshi: true })).toBe(HEIKIN_KEY)
  })

  it('an ordinary chart selects its own type', () => {
    expect(selectedTypeKey({ chartType: 'bars', heikinAshi: false })).toBe('bars')
    expect(selectedTypeKey({})).toBe('candles')
    expect(selectedTypeKey(null)).toBe('candles')
  })

  it('choosing Heikin Ashi turns it on and keeps the series drawable', () => {
    expect(chartTypePatch(HEIKIN_KEY)).toEqual({ chartType: 'candles', heikinAshi: true })
  })

  it('⛔ choosing ANY other type turns it back OFF — the way out must exist', () => {
    // Without this, a phone user who tried Heikin Ashi could never get back to a
    // real candle chart: the tile would appear to switch and the transform would
    // still be applied.
    for (const t of ['candles', 'hollow', 'bars', 'line', 'area'])
      expect(chartTypePatch(t)).toEqual({ chartType: t, heikinAshi: false })
  })

  it('round trip: every catalogue key selects itself back', () => {
    for (const t of CHART_TYPES) {
      expect(selectedTypeKey(chartTypePatch(t.key)), `${t.key} does not select itself back`).toBe(t.key)
    }
  })
})

describe('⛔ the patch is APPLIED, not merely computed', () => {
  /* The failure this repo keeps rediscovering: a correct function, a correct
     component, and nothing joining them. `MobileChartsApp` mounts a real chart
     and is not renderable here, so the wire is read from source — and each read
     names what it could not find rather than matching nothing and reporting
     success. */
  const app = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'MobileChartsApp.jsx'), 'utf8')

  it('the shell writes through chartTypePatch, so Heikin Ashi actually turns off', () => {
    expect(app, 'the shell never imports the patch').toContain('chartTypePatch')
    expect(app, 'the pick handler does not apply the patch').toMatch(/onPick=\{\(t\) => write\(\{ \.\.\.cs, \.\.\.chartTypePatch\(t\)/)
  })

  it('the tick is read through selectedTypeKey, so it cannot show Candles on a HA chart', () => {
    expect(app, 'the shell still reads cs.chartType directly for the tick')
      .toContain('chartType={selectedTypeKey(cs)}')
  })

  it('NON-VACUITY · the same read finds the sheet mounted at all', () => {
    expect(app).toContain('<MobileChartTypeSheet')
  })
})
