// ─── ⭐⭐ TRAIN e95 (#2483, computed number formats) — `str.tostring` AS TRADINGVIEW PRINTS IT, ROW BY ROW ─────────────────
//
// The `vw-format-percent` probe (tools/visual_conformance/probes/vw-format-percent.pine), captured pre-open 2026-11-23 on
// NYSE:RDDT and AMEX:SPY 1D (`tests/fixtures/vendor/harness/vw-format-percent-{rddt,spy}-1d-2026-11-23-preopen.json`,
// #2564). ONE SOURCE: the rows are read from the two captures' table, row-major, three columns: the label (`P03 0.575`:
// the row and the value the probe wrote), TradingView's `str.tostring(v, format.percent)` and its `str.tostring(v, "#.##")`.
// TradingView's rules, as witnessed:
//   * format.percent takes the value AS a percent: no x100, "%" appended, always 2 decimals; no thousands separator;
//   * a negative that rounds to zero prints WITHOUT a sign (-0.004 -> "0.00%");
//   * a half rounds UP on the DECIMAL value (0.005 -> "0.01%", 0.575 -> "0.58%"): ⛔ the double 0.575 is 0.57499..., so a
//     binary rounding (`toFixed`) would print "0.57";
//   * `na` prints "NaN%"; "#.##" drops trailing zeros, `na` prints "NaN".
// ⛔ format.percent is NOT printed by the engine in e95 (coordinator ruling 2026-11-23: one probe script on two symbols is
// not the two-scripts evidence rule): a text written with it is withheld by name ("...it is written with format.percent,
// which UCT does not print yet", `tests/test_script_format_is_a_literal.py`, whose tripwire keeps the assistant's rule 13).
// The last block holds the witnessed rule to the engine's one number core, so serving it (e96, after a community
// script's MATCH) is a wiring change whose figures are already proved here.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { formatNumber, formatNumberWhy } from '../objectRuntime'
import { tostringNumberText } from '../pineTextFormat'

const HARNESS = path.resolve(process.cwd(), '..', 'tests', 'fixtures', 'vendor', 'harness')
/** `[[id, value, TradingView's format.percent text, TradingView's "#.##" text], ...]` from one capture's table. */
function rowsOf(sym) {
  const cap = JSON.parse(fs.readFileSync(path.join(HARNESS, `vw-format-percent-${sym}-1d-2026-11-23-preopen.json`), 'utf8'))
  const cells = cap.objects.texts.tableCells
  expect(cells.slice(0, 3), sym).toEqual(['value', 'format.percent', '#.##'])
  const out = []
  for (let i = 3; i < cells.length; i += 3) {
    const [id, written] = cells[i].split(' ')
    out.push([id, written === 'na' ? NaN : Number(written), cells[i + 1], cells[i + 2]])
  }
  return out
}
const RDDT = rowsOf('rddt')
const SPY = rowsOf('spy')
const ROWS = RDDT

describe('the two captures are one witness', () => {
  it('RDDT and SPY print the same 12 rows, P01..P12, every value read', () => {
    expect(RDDT).toHaveLength(12)
    expect(RDDT.map((r) => r[0])).toEqual(Array.from({ length: 12 }, (_, i) => `P${String(i + 1).padStart(2, '0')}`))
    expect(RDDT.map((r) => String(r))).toEqual(SPY.map((r) => String(r)))
    for (const [id, v] of RDDT) expect(Number.isFinite(v) || (id === 'P12' && Number.isNaN(v)), id).toBe(true)
  })
})

describe('"#.##" prints exactly what TradingView printed, on every witnessed row', () => {
  it.each(ROWS)('%s', (id, v, _percent, hash) => {
    expect(formatNumber(v, '#.##'), id).toBe(hash)
    expect(formatNumberWhy(v, '#.##'), id).toBe(null)
  })

  it('P03 above all: a half rounds UP on the DECIMAL value, not on the double', () => {
    const p03 = ROWS.find((r) => r[0] === 'P03')
    expect(p03[1]).toBe(0.575)
    expect(p03[1].toFixed(2)).toBe('0.57')   // the trap: the double is 0.57499...
    expect(formatNumber(p03[1], '#.##')).toBe(p03[3])
  })

  it('P02: a negative that rounds to zero carries no sign (CONTROL: P05 keeps its sign)', () => {
    const p02 = ROWS.find((r) => r[0] === 'P02')
    const p05 = ROWS.find((r) => r[0] === 'P05')
    expect(p02[1] < 0 && p05[1] < 0).toBe(true)
    expect(formatNumber(p02[1], '#.##')).toBe(p02[3])
    expect(formatNumber(p05[1], '#.##')).toBe(p05[3])
  })
})

describe('format.percent: the witnessed rule is the one number core at two decimals, plus "%"', () => {
  const percent = (n) => (Number.isFinite(n) ? `${tostringNumberText(n, { min: 2, max: 2 })}%` : 'NaN%')
  it.each(ROWS)('%s', (id, v, pct) => {
    expect(percent(v), id).toBe(pct)
  })
})
