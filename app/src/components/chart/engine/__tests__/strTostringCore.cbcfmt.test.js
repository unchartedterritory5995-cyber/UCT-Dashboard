// app/src/components/chart/engine/__tests__/strTostringCore.cbcfmt.test.js
//
// ─── ⭐⭐ CBC-FMT — THE ONE `str.tostring` NUMBER CORE, AGAINST WHAT TRADINGVIEW PRINTS ──
//
// `pineTextFormat.js::tostringNumberText` (rules F1-F9 in its header). Every expected text
// here is a TradingView print, transcribed (the capture itself stays where it is filed) or
// read straight off a committed fixture:
//   S10 capture session S10's `vw-fmt-tie-readings-rddt-1d-2026-11-15`, rows T01-T30 (our own
//       probe, `tools/visual_conformance/probes/vw-fmt-tie-readings.pine`): the tie READING
//       (decup, not binary), unsigned zero, the exponent, more than 16 decimals, grouping, and
//       `format.mintick`'s own binary rounding;
//   R1 the LRC builtin's 16-`#` pattern (no ten-decimal cap), and S10 `vw-cs2-label-number-format`
//   R2 127.705 through `format.mintick` / "#.##" (committed fixtures)
//   R3 the exact binary ties of vw-int-array-avg (and -neg): half AWAY from zero
//   R6 `str.format`'s `{0}` keeps its own formatter (952.4295 -> "952.429"; S10 T24)
//   + the lanes: the object runtime, the runtime VM (a NAMED stop, never an unnamed concat
//     error), and the F11 compile-error refusal (`pine:type`).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import {
  tostringNumberText, tostringNumberWhy, formatPlainNumber, tickNumberText, formatMessageNumber,
  plainPatternBounds, formatPatternedNumber, patternedNumberWhy, TOSTRING_DEFAULT_BOUNDS,
} from '../pineTextFormat'
import { defaultNumberText, formatNumber, formatNumberWhy } from '../objectRuntime'
import { RUN_TEXT_FNS } from '../runtime/text'
import { translatePine } from '../ast/pine'

const HARNESS = path.join(path.resolve(process.cwd(), '..'), 'tests', 'fixtures', 'vendor', 'harness')
const fixture = (f) => JSON.parse(fs.readFileSync(path.join(HARNESS, f), 'utf8'))
const plain = (n, fmt) => formatPlainNumber(n, fmt)

describe('S10 — `vw-fmt-tie-readings` RDDT 1D: every str.tostring row, transcribed', () => {
  // [row, what our side prints, TradingView's text]
  const ROWS = [
    // F6 a DECIMAL tie rounds up on the shortest decimal ("decup"); binary ("mul") would print the second
    ['T01 1.005 #.## (mul: 1)', () => plain(1.005, '#.##'), '1.01'],
    ['T02 163.265 #.## (mul: 163.26)', () => plain(163.265, '#.##'), '163.27'],
    ['T03 145.795 #.## (mul: 145.79)', () => plain(145.795, '#.##'), '145.8'],
    ['T04 1.255 #.## (mul: 1.25)', () => plain(1.255, '#.##'), '1.26'],
    ['T05 2.675 #.## CONTROL', () => plain(2.675, '#.##'), '2.68'],
    ['T06 127.705 #.## CONTROL', () => plain(127.705, '#.##'), '127.71'],
    ['T07 -1.005 #.## (mul: -1)', () => plain(-1.005, '#.##'), '-1.01'],
    // format.mintick is a DIFFERENT rounding: n / tick, in binary
    ['T08 1.005 mintick', () => tickNumberText(1.005, '0.01'), '1.00'],
    ['T09 163.265 mintick', () => tickNumberText(163.265, '0.01'), '163.26'],
    ['T10 0.125 mintick (exact tie)', () => tickNumberText(0.125, '0.01'), '0.13'],
    ['T11 -0.004 mintick', () => tickNumberText(-0.004, '0.01'), '0.00'],
    ['T12 1234.5 mintick (no grouping)', () => tickNumberText(1234.5, '0.01'), '1234.50'],
    // F7 a value that rounds to zero is unsigned
    ['T13 -0.004 #.##', () => plain(-0.004, '#.##'), '0'],
    ['T14 -1e-12 default', () => defaultNumberText(-1e-12), '0'],
    // F4 no decimal cap
    ['T15 0.1 20#', () => plain(0.1, '#.####################'), '0.1'],
    ['T16 123.456 16#', () => plain(123.456, '#.################'), '123.456'],
    ['T17 1/3 16#', () => plain(1 / 3, '#.################'), '0.3333333333333333'],
    // F8 the default's exponent
    ['T18 1e21 default', () => defaultNumberText(1e21), '1e+21'],
    ['T19 1.00000000005 default (tenth-decimal decimal tie)', () => defaultNumberText(1.00000000005), '1.0000000001'],
    // F9 grouping by three
    ['T20 1234.5 #,###.##', () => formatPatternedNumber(1234.5, '#,###.##'), '1,234.5'],
    ['T26 -0.4 #', () => plain(-0.4, '#'), '0'],
    ['T28 int 5 vs 5.0', () => `${defaultNumberText(5)}/${defaultNumberText(5.0)}`, '5/5'],
    ['T29 1e-11 default', () => defaultNumberText(1e-11), '0'],
    ['T30 99999.995 #.## (a carry)', () => plain(99999.995, '#.##'), '100000'],
    // str.format's own formatter (F7 of the report: Java on the exact binary value)
    ['T24 str.format 1.0005', () => formatMessageNumber(1.0005), '1'],
  ]
  it.each(ROWS)('%s', (row, ours, tv) => {
    expect(ours()).toBe(tv)
  })
  it('⛔ the binary reading the capture refuted would have printed the mul column', () => {
    const mul = (x, k) => String(Math.round(Math.abs(x) * 10 ** k) / 10 ** k)
    expect(mul(1.005, 2)).toBe('1')
    expect(mul(163.265, 2)).toBe('163.26')
    // ⚰️ and `toFixed` (the engine before CBC-FMT)
    expect((127.705).toFixed(2)).toBe('127.70')
  })
  it('⛔ str.format\'s exact tie (T25 "2.062", half-even) is NOT this core\'s: it keeps its own withhold', () => {
    expect(formatMessageNumber(2.0625)).toBeNull()
  })
})

describe('R1 — F4 / F1: the LRC builtin, and the default ten decimals (S10 vw-cs2-label-number-format)', () => {
  it('⭐ `str.tostring(pearsonR, "#.################")` (RDDT 1D, transcribed)', () => {
    expect(plain(0.8175176096085278, '#.################')).toBe('0.8175176096085278')
  })
  it('⭐ the default: "32.8166666667", "0.8175176096", "1"', () => {
    expect(defaultNumberText(32.81666666666667)).toBe('32.8166666667')
    expect(defaultNumberText(0.8175176096085278)).toBe('0.8175176096')
    expect(defaultNumberText(1)).toBe('1')
    expect(defaultNumberText(4 / 3)).toBe('1.3333333333')
    expect(defaultNumberText(1e-6)).toBe('0.000001')
    expect(defaultNumberText(NaN)).toBe('NaN')
  })
})

describe('R2 — F6: a decimal tie rounds up (committed fixtures)', () => {
  it('⭐ support-resistance-mtf-flux RDDT: every `1D | <price>` label is its own y through format.mintick', () => {
    const labels = fixture('support-resistance-mtf-flux-charts-rddt-1d-2026-11-14.json').objects.records.labels
      .filter((l) => /^1D \| /.test(l.t || ''))
    expect(labels.length).toBeGreaterThanOrEqual(20)
    expect(labels.some((l) => l.y === 127.705)).toBe(true) // non-vacuity: the tie is in it
    for (const l of labels) expect(`1D | ${tickNumberText(l.y, '0.01')}`, `y=${l.y}`).toBe(l.t)
  })
  it('⭐ parabolic SAR RDDT prints 127.71 for y = 127.705, and "#.#" prints (transcribed)', () => {
    const sar = fixture('parabolic-sar-rddt-1d-2026-10-03.json').objects.records.labels.find((l) => l.y === 127.705)
    expect(sar.t).toBe('127.71')
    expect(plain(176.505, '#.##')).toBe('176.51')
    expect(plain(54.45, '#.#')).toBe('54.5')
    expect(plain(152.65, '#.#')).toBe('152.7')
    expect(plain(66.15, '#.#')).toBe('66.2')
  })
})

describe('R3 — F5: an EXACT binary tie rounds half AWAY from zero', () => {
  it('⭐ vw-int-array-avg SPY: R01-R19, each label its value through the one core', () => {
    const labels = fixture('vw-int-array-avg-spy-1d-2026-09-30.json').objects.records.labels
    const want = Object.fromEntries(labels.map((l) => String(l.t).split('|')).filter((p) => /^R\d\d/.test(p[0])).map(([k, v]) => [k.slice(0, 3), v]))
    const value = { R01: 1.5, R02: 4 / 3, R03: 5 / 3, R04: 2.5, R05: -1.5, R06: 1.5, R07: 4 / 3, R08: 5 / 3, R09: 2.5,
      R10: -1.5, R11: 1.5, R12: 4 / 3, R13: 5 / 3, R14: 1.5, R15: 4 / 3, R16: 5 / 3, R17: 2.5, R18: 1.5, R19: 1.5 }
    const hashes = new Set(['R06', 'R07', 'R08', 'R09', 'R10', 'R14', 'R15', 'R16', 'R17', 'R19'])
    expect(Object.keys(want)).toHaveLength(19)
    for (const [k, v] of Object.entries(value)) {
      expect(hashes.has(k) ? plain(v, '##') : defaultNumberText(v), k).toBe(want[k])
    }
  })
  it('⭐ the negative ties (vw-int-array-avg-neg A11-A13, transcribed): -1.5 -> -2, -2.5 -> -3, -0.5 -> -1', () => {
    expect(plain(-1.5, '##')).toBe('-2')
    expect(plain(-2.5, '##')).toBe('-3')
    expect(plain(-0.5, '##')).toBe('-1')
    expect(Math.round(-2.5)).toBe(-2) // JS rounds half toward +inf: refuted
  })
})

describe('still WITHHELD by name: what no capture shows', () => {
  it('a PATTERN at 1e21 or more (only the default\'s exponent is witnessed)', () => {
    expect(tostringNumberWhy(1e21, plainPatternBounds('#.##'))).toBe('format:magnitude-uncaptured')
    expect(plain(1e21, '#.##')).toBeNull()
    expect(tostringNumberWhy(1e21, TOSTRING_DEFAULT_BOUNDS)).toBeNull()
  })
  it('a grouping of any size but three, a negative under a prefix, a negative mintick tie', () => {
    expect(patternedNumberWhy(12345, '#,##')).toBe('format:grouping-uncaptured')
    expect(patternedNumberWhy(-2.5, 'H (#.##)')).toBe('format:negative-under-prefix')
    expect(tickNumberText(-0.125, '0.01')).toBeNull()
    expect(formatPatternedNumber(282.95, 'Swing H  (#,###.####)')).toBe('Swing H  (282.95)')
  })
})

describe('R6 — `str.format`\'s `{0}` is a DIFFERENT formatter and keeps its own', () => {
  it('⭐ 952.4295: "{0}" -> "952.429" (Java on the exact binary value), "#.###" -> "952.43"', () => {
    expect(formatMessageNumber(952.4295)).toBe('952.429')
    expect(plain(952.4295, '#.###')).toBe('952.43')
  })
})

describe('the lanes ask the one core', () => {
  it('the object runtime: `formatNumber` and its named why agree', () => {
    for (const [n, fmt] of [[127.705, '#.##'], [1.005, '#.##'], [-0.004, '#.##'], [1.5, undefined], [1e21, undefined], [1e21, '#.##'], [-0.001, '#.## pts'], [-2.5, 'H (#.##)']]) {
      const s = formatNumber(n, fmt)
      const w = formatNumberWhy(n, fmt)
      expect(s === null, `${n} ${fmt}`).toBe(w !== null)
    }
  })
  it('⛔ the runtime VM: a withheld text is a NAMED stop, never `null` reaching `+`', () => {
    expect(RUN_TEXT_FNS['str.tostring/fmt'].fn(127.705, '#.##')).toBe('127.71')
    expect(RUN_TEXT_FNS['str.tostring/fmt'].fn(1.005, '#.##')).toBe('1.01')
    expect(RUN_TEXT_FNS['str.tostring'].fn(-1e-12)).toBe('0')
    let err = null
    try { RUN_TEXT_FNS['str.tostring/fmt'].fn(1e21, '#.##') } catch (e) { err = e }
    expect(err && err.guard).toBe('format:magnitude-uncaptured')
    expect(RUN_TEXT_FNS['str.tostring'].fn('text')).toBe('text')
  })
  it('⛔ F11 — a number in a label\'s text is a TradingView compile error: refused by name (`pine:type`)', () => {
    const bad = translatePine('//@version=6\nindicator("t", overlay = true)\nplot(close)\nif barstate.islast\n    label.new(bar_index, close, close)\n', { strict: true })
    expect(JSON.stringify(bad.objectDiagnostics || {})).toMatch(/pine:type/)
    const ok = translatePine('//@version=6\nindicator("t", overlay = true)\nplot(close)\nif barstate.islast\n    label.new(bar_index, close, str.tostring(close))\n', { strict: true })
    expect(JSON.stringify(ok.objectDiagnostics || {})).not.toMatch(/pine:type/)
    const fmt = translatePine('//@version=6\nindicator("t", overlay = true)\nplot(close)\nif barstate.islast\n    label.new(bar_index, close, str.format("{0}", close))\n', { strict: true })
    expect(JSON.stringify(fmt.objectDiagnostics || {})).not.toMatch(/pine:type/)
  })
})
