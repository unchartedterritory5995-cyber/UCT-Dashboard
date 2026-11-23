// ─── ⭐⭐ TRAIN e95 (#2483, computed number formats) — `str.tostring` AS TRADINGVIEW PRINTS IT, ROW BY ROW ─────────────────
//
// The `vw-format-percent` probe (tools/visual_conformance/probes/vw-format-percent.pine), captured pre-open 2026-11-23 on
// NYSE:RDDT and AMEX:SPY 1D (`vwfp-2026-11-22`): the same 12 rows on both symbols. Each row is the value the probe wrote,
// TradingView's `str.tostring(v, format.percent)` and TradingView's `str.tostring(v, "#.##")`. The texts are held here as
// the rows (the captures commit through their own lane). TradingView's rules, as witnessed:
//   * format.percent takes the value AS a percent: no x100, "%" appended, always 2 decimals; no thousands separator;
//   * a negative that rounds to zero prints WITHOUT a sign (-0.004 -> "0.00%");
//   * a half rounds UP on the DECIMAL value (0.005 -> "0.01%", 0.575 -> "0.58%"): ⛔ the double 0.575 is 0.57499..., so a
//     binary rounding (`toFixed`) would print "0.57";
//   * `na` prints "NaN%"; "#.##" drops trailing zeros, `na` prints "NaN".
// ⛔ format.percent is NOT printed by the engine today: a text written with it is withheld by name ("...it is written with
// format.percent, which UCT does not print yet", `tests/test_script_format_is_a_literal.py`, whose tripwire keeps the
// assistant's rule 13 while it is). The second block holds the witnessed rule to the engine's one number core, so
// serving it is a wiring change whose figures are already proved here.

import { describe, it, expect } from 'vitest'
import { formatNumber, formatNumberWhy } from '../objectRuntime'
import { tostringNumberText } from '../pineTextFormat'

// [id, the value the probe wrote, TradingView's format.percent text, TradingView's "#.##" text]
const ROWS = [
  ['P01', 0.126, '0.13%', '0.13'],
  ['P02', -0.004, '0.00%', '0'],
  ['P03', 0.575, '0.58%', '0.58'],
  ['P04', 12.345, '12.35%', '12.35'],
  ['P05', -7.5, '-7.50%', '-7.5'],
  ['P06', 0, '0.00%', '0'],
  ['P07', 0.005, '0.01%', '0.01'],
  ['P08', 0.0049, '0.00%', '0'],
  ['P09', 1234.5, '1234.50%', '1234.5'],
  ['P10', 1e6, '1000000.00%', '1000000'],
  ['P11', 0.12345678, '0.12%', '0.12'],
  ['P12', NaN, 'NaN%', 'NaN'],
]

describe('"#.##" prints exactly what TradingView printed, on every witnessed row', () => {
  it.each(ROWS)('%s', (id, v, _percent, hash) => {
    expect(formatNumber(v, '#.##'), id).toBe(hash)
    expect(formatNumberWhy(v, '#.##'), id).toBe(null)
  })

  it('P03 above all: a half rounds UP on the DECIMAL value, not on the double', () => {
    expect((0.575).toFixed(2)).toBe('0.57')   // the trap: the double is 0.57499...
    expect(formatNumber(0.575, '#.##')).toBe('0.58')
    expect(formatNumber(0.005, '#.##')).toBe('0.01')
  })

  it('P02: a negative that rounds to zero carries no sign', () => {
    expect(formatNumber(-0.004, '#.##')).toBe('0')
    expect(formatNumber(-7.5, '#.##')).toBe('-7.5')   // CONTROL: a negative that does not round to zero keeps it
  })
})

describe('format.percent: the witnessed rule is the one number core at two decimals, plus "%"', () => {
  const percent = (n) => (Number.isFinite(n) ? `${tostringNumberText(n, { min: 2, max: 2 })}%` : 'NaN%')
  it.each(ROWS)('%s', (id, v, pct) => {
    expect(percent(v), id).toBe(pct)
  })
})
