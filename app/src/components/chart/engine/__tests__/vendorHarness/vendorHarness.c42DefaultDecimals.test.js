// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c42DefaultDecimals.test.js
//
// ─── C42 — `str.tostring(x)` WITH NO FORMAT: TEN DECIMALS, AGAINST TRADINGVIEW ─
//
// The object runtime printed a number with no format to ten SIGNIFICANT digits.
// Two captures of 2026-09-30 print more:
//
//   vw-fn-series-history-rddt-1d   `str.tostring(hlc3[k])`  →  151.5633333333
//                                                              158.5233333333
//   vw-int-array-avg-spy-1d        `str.tostring(a.avg())`  →  1.3333333333
//                                                              1.6666666667
//
// — ten DECIMALS, the last one rounded (…6667), trailing zeros trimmed
// (`232.9457`, `1.5`, `4576417`). Ten significant digits printed `151.5633333`.
// No committed capture holds a text with more than ten decimals.
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import { loadCapture } from './harness'
import { toProductBars } from './ourSide'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'
import { toRenderState } from '../../objectRenderState'

const DIR = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const cap = (file) => loadCapture(path.join(DIR, file)).capture

afterEach(() => { vi.unstubAllEnvs() })

function labelsOf(capture, source) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  const bars = toProductBars(capture)
  const d = memberPaneDefinition({ source, id: 'u_c42_dec', name: 'c42' })
  expect(d.ok, d.reason || '').toBe(true)
  const reader = objectReaderFor(d.definition, bars, {
    tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: capture.newestBarIsForming ?? null,
    historyFromListing: true,
  })
  const r = evaluateObjects(reader.program, {
    barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
  })
  return toRenderState(r.live, { bars, tf: 'D' }).labels.map((l) => l.text)
}

describe('C42 — the default number text is ten decimals', () => {
  it('⭐ the captures: every long fraction TradingView printed has exactly ten decimals', () => {
    const texts = [
      ...cap('vw-fn-series-history-rddt-1d-2026-09-30.json').objects.texts.labels,
      ...cap('vw-int-array-avg-spy-1d-2026-09-30.json').objects.texts.labels,
    ]
    const long = texts.map((t) => /\|(-?\d+)\.(\d{7,})$/.exec(t)).filter(Boolean)
    expect(long.map((m) => `${m[1]}.${m[2]}`).sort()).toEqual([
      '1.3333333333', '1.3333333333', '1.6666666667', '1.6666666667', '151.5633333333', '158.5233333333',
    ])
    for (const m of long) expect(m[2]).toHaveLength(10)
  })

  it('⭐ our runtime prints the same texts for the same values on the capture\'s bars', () => {
    const c = cap('vw-fn-series-history-rddt-1d-2026-09-30.json')
    const src = [
      '//@version=5',
      'indicator("c42 decimals", overlay = true)',
      'if barstate.islast',
      '    label.new(bar_index, low, "S05 hlc3|" + str.tostring(hlc3[5]))',
      '    label.new(bar_index, low, "S05 hlc3|" + str.tostring(hlc3[40]))',
      '    label.new(bar_index, low, "S05 hlc3|" + str.tostring(hlc3[200]))',
      '    label.new(bar_index, low, "S06 ohlc4|" + str.tostring(ohlc4[200]))',
      '    label.new(bar_index, low, "S01 volume|" + str.tostring(volume[5]))',
      // ⭐ F1 — FLOAT literals: before v6 `4 / 3` of two `const int` is 1
      // (`vw-int-div-assign` D03), so the fraction is asked of `4.0 / 3`.
      '    label.new(bar_index, low, "third|" + str.tostring(4.0 / 3))',
      '    label.new(bar_index, low, "two thirds|" + str.tostring(5.0 / 3))',
    ].join('\n')
    const ours = labelsOf(c, src)
    const vendor = c.objects.texts.labels
    // the first five are rows of the capture, value for value
    for (const t of ours.slice(0, 5)) expect(vendor, t).toContain(t)
    expect(ours.slice(0, 3)).toEqual(['S05 hlc3|151.5633333333', 'S05 hlc3|158.5233333333', 'S05 hlc3|232.9457'])
    // the int-array capture's two means, by value
    expect(ours[5]).toBe('third|1.3333333333')
    expect(ours[6]).toBe('two thirds|1.6666666667')
  })
})
