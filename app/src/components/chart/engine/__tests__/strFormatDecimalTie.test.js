// app/src/components/chart/engine/__tests__/strFormatDecimalTie.test.js
//
// ─── ⛔⛔ N01 (2026-11-19) — `{N,number,P}` OVER A DECIMAL TIE IS WITHHELD BY NAME ──────────
//
// `str.format("{0,number,#.##}", x)` was SERVED from the binary value: 1.005 -> "1", 163.265 ->
// "163.26", 2.675 -> "2.67". `str.tostring(x, "#.##")` is WITNESSED printing the decimal reading
// of the same values ("1.01", "163.27", "2.68": capture session S10, `vw-fmt-tie-readings` T01-T07,
// rows transcribed in `strTostringCore.cbcfmt.test.js`), and no capture shows which reading
// `str.format`'s pattern draws. Until capture row N01 (queue Q-TF-N-a, PR #2072) is graded, a
// value whose shortest decimal ends on a 5 one digit past the pattern's last kept
// digit is WITHHELD, named `format:message-decimal-tie` (`pineTextFormat.js::decimalTieAt`).
//
//   A  the tie values of row N01 are withheld, by name, negatives included;
//   B  the predicate at other precisions (a 0-decimal and a 3-decimal pattern), and the bare
//      `{N}`, whose binary reading T24 pins, is untouched;
//   C  everything that is not a tie prints exactly as before;
//   D  CONTROL: `str.tostring`'s witnessed path is unchanged;
//   E  through the object lane: the tie's cell is held and not drawn, the name reaches the run's
//      `textsWithheldWhy`, and the non-tie cell beside it is drawn.
import { describe, it, expect } from 'vitest'

import {
  formatMessageNumber, messageNumberWhy, decimalTieAt, exactTieAt, compileMessagePattern,
  formatPlainNumber, MESSAGE_DECIMAL_TIE,
} from '../pineTextFormat.js'
import { RUN_TEXT_FNS } from '../runtime/text'
import { formatNumber, OBJECT_STATUS } from '../objectRuntime'
import { buildObjectLane, runObjectLane } from '../runtime/objectLane.js'
import { toRenderState } from '../objectRenderState'

/** Row N01's six values (the probe `vw-tf-format-number-patterns.pine`), each a decimal tie at two. */
const N01 = [1.005, 163.265, 145.795, 2.675, 127.705, -1.005]

describe('A — a decimal tie under `{N,number,#.##}` is WITHHELD, by name', () => {
  it('⛔⛔ every N01 value: null, named `format:message-decimal-tie`', () => {
    expect(MESSAGE_DECIMAL_TIE).toBe('format:message-decimal-tie')
    for (const x of N01) {
      expect(formatMessageNumber(x, '#.##'), String(x)).toBeNull()
      expect(messageNumberWhy(x, '#.##'), String(x)).toBe(MESSAGE_DECIMAL_TIE)
    }
  })

  it('⛔ these are NOT exact binary ties: the old rule did not catch one of them', () => {
    // The double under 1.005 is 1.00499999999999989…, so `exactTieAt` says no and the binary
    // reading printed "1". Without this, rail A would pass on the exact-tie rule alone.
    for (const x of N01) expect(exactTieAt(x, 2), String(x)).toBe(false)
    expect((1.005).toFixed(2)).toBe('1.00')
    expect((163.265).toFixed(2)).toBe('163.26')
    expect((2.675).toFixed(2)).toBe('2.67')
  })

  it('⛔ negative ties, and a tie that would round UP to 1000, are withheld too', () => {
    for (const x of [-1.005, -2.675, -163.265, -0.025, 999.995]) {
      expect(formatMessageNumber(x, '#.##'), String(x)).toBeNull()
      expect(messageNumberWhy(x, '#.##'), String(x)).toBe(MESSAGE_DECIMAL_TIE)
    }
  })

  it('⛔ a tie the binary value rounds the SAME way as the decimal one is still withheld (a HALF_EVEN reading parts there)', () => {
    // 0.025's double is 0.02500000000000000138…: binary and half-up both say "0.03", half-even says "0.02".
    expect((0.025).toFixed(2)).toBe('0.03')
    expect(formatMessageNumber(0.025, '#.##')).toBeNull()
  })

  it('⭐ an EXACT binary tie keeps its own name (it is a decimal tie too)', () => {
    expect(decimalTieAt(0.125, 2)).toBe(true)
    expect(formatMessageNumber(0.125, '#.##')).toBeNull()
    expect(messageNumberWhy(0.125, '#.##')).toBe('format:message-exact-tie')
  })
})

describe('B — the tie at other precisions; the bare `{N}` (T24) is not this rule\'s', () => {
  it('⭐ 0 decimals: x.5 is a tie, x.51 and an integer are not', () => {
    expect(decimalTieAt(2.5, 0)).toBe(true)
    expect(decimalTieAt(-0.5, 0)).toBe(true)
    expect(decimalTieAt(2.51, 0)).toBe(false)
    expect(decimalTieAt(2.4, 0)).toBe(false)
    expect(decimalTieAt(3, 0)).toBe(false)
  })

  it('⭐ 3 decimals: 1.0005 and -1.0015 are ties; 1.0004, 1.00051 and 1.0006 are not', () => {
    expect(decimalTieAt(1.0005, 3)).toBe(true)
    expect(decimalTieAt(-1.0015, 3)).toBe(true)
    expect(decimalTieAt(1.0004, 3)).toBe(false)
    expect(decimalTieAt(1.00051, 3)).toBe(false)
    expect(decimalTieAt(1.0006, 3)).toBe(false)
  })

  it('⭐ the shortest decimal is read in full, never in exponent form (5e-7 at six decimals)', () => {
    expect(String(5e-7)).toBe('5e-7')
    expect(decimalTieAt(5e-7, 6)).toBe(true)
    expect(decimalTieAt(5e-7, 5)).toBe(false)
    expect(decimalTieAt(NaN, 2)).toBe(false)
    expect(decimalTieAt(Infinity, 2)).toBe(false)
  })

  it('⛔ a 0-decimal or a 3-decimal PATTERN is still refused at translate, by name (no capture pins either)', () => {
    expect(compileMessagePattern('{0,number,#}', 1).why).toBe('format:number-pattern:#')
    expect(compileMessagePattern('{0,number,#.###}', 1).why).toBe('format:number-pattern:#.###')
    expect(formatMessageNumber(2.5, '#')).toBeNull()
    expect(messageNumberWhy(1.0005, '#.###')).toBe('format:message-pattern-unread')
  })

  it('⭐ CONTROL — the bare `{N}` keeps its witnessed binary reading at a decimal tie (T24 1.0005 -> "1")', () => {
    expect(decimalTieAt(1.0005, 3)).toBe(true)
    expect(formatMessageNumber(1.0005)).toBe('1')
    expect(messageNumberWhy(1.0005)).toBeNull()
    // and its exact binary tie stays withheld (T25 2.0625 -> "2.062" waits for N10)
    expect(formatMessageNumber(2.0625)).toBeNull()
    expect(messageNumberWhy(2.0625)).toBe('format:message-exact-tie')
  })
})

describe('C — what is not a tie prints exactly as before', () => {
  it('⭐ the non-ties of the brief', () => {
    expect(formatMessageNumber(1.004, '#.##')).toBe('1')
    expect(formatMessageNumber(1.006, '#.##')).toBe('1.01')
    expect(formatMessageNumber(163.27, '#.##')).toBe('163.27')
    expect(formatMessageNumber(2.68, '#.##')).toBe('2.68')
    expect(formatMessageNumber(1.0051, '#.##')).toBe('1.01')
    expect(formatMessageNumber(-1.0051, '#.##')).toBe('-1.01')
    expect(formatMessageNumber(700, '#.##')).toBe('700')
    for (const x of [1.004, 1.006, 163.27, 2.68, 1.0051, 700]) expect(messageNumberWhy(x, '#.##')).toBeNull()
  })

  it('⭐⭐ a sweep: every non-tie below the bound prints the binary two-decimal reading, and only ties are withheld', () => {
    // values on a 1/1000 grid from -50 to 50 plus SPY-like closes: half of the grid's
    // thousandths end on 5, so ties and non-ties are both well represented.
    let ties = 0
    let printed = 0
    for (let k = -50000; k <= 50000; k += 7) {
      const x = k / 1000
      const tie = decimalTieAt(x, 2)
      const s = formatMessageNumber(x, '#.##')
      if (tie) {
        ties += 1
        expect(s, String(x)).toBeNull()
        continue
      }
      const old = x.toFixed(2).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
      if (old === '-0') { expect(s).toBeNull(); continue }
      printed += 1
      expect(s, String(x)).toBe(old)
    }
    // ⛔ NON-VACUITY: both arms ran, many times
    expect(ties).toBeGreaterThan(1000)
    expect(printed).toBeGreaterThan(10000)
  })

  it('⭐ the named why and the formatter agree on every value (null iff null)', () => {
    const vals = [...N01, 1.004, 1.006, 0.125, 0.0625, -0.0001, 999.9996, -999.9996, 1234.5, NaN, 5, 0, 1.0005, 2.0625]
    for (const fmt of [undefined, '#.##', 'percent', '#']) {
      for (const x of vals) {
        expect(formatMessageNumber(x, fmt) === null, `${x} ${fmt}`).toBe(messageNumberWhy(x, fmt) !== null)
      }
    }
  })
})

describe('D — CONTROL: `str.tostring`\'s witnessed decimal reading is UNCHANGED', () => {
  it('⭐ T01-T07 through the one core, the object runtime\'s formatter and the runtime VM', () => {
    const TV = { 1.005: '1.01', 163.265: '163.27', 145.795: '145.8', 2.675: '2.68', 127.705: '127.71', '-1.005': '-1.01' }
    for (const x of N01) {
      expect(formatPlainNumber(x, '#.##'), String(x)).toBe(TV[String(x)])
      expect(formatNumber(x, '#.##'), String(x)).toBe(TV[String(x)])
      expect(RUN_TEXT_FNS['str.tostring/fmt'].fn(x, '#.##'), String(x)).toBe(TV[String(x)])
    }
  })
})

describe('E — through the object lane: the tie cell is held, not drawn, and named', () => {
  const LF = String.fromCharCode(10)
  const N = 30
  const lastClose = (c) => Array.from({ length: N }, (_, i) => ({
    t: 1700000000 + i * 86400, o: 100, h: 200, l: 50, c: i === N - 1 ? c : 100 + i / 8, v: 1000000,
  }))
  const run = (close) => {
    const BARS = lastClose(close)
    const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
    const src = ['//@version=6', 'indicator("t", overlay = true)', 'if barstate.islast',
      '    var table tb = table.new(position.top_right, 2, 1)',
      '    table.cell(tb, 0, 0, str.format("F {0,number,#.##}", close))',
      '    table.cell(tb, 1, 0, "T " + str.tostring(close, "#.##"))'].join(LF) + LF
    const lane = buildObjectLane(src, { tf: 'D', newestBarIsForming: false, bars: BARS })
    expect(lane.ok, lane.ok ? '' : `refused ${(lane.refusal || {}).guard}`).toBe(true)
    const r = runObjectLane(lane, { bars: N, series: SERIES, confirmed: true, readTime: (i) => BARS[i].t })
    expect(r.status, r.reason).toBe(OBJECT_STATUS.OK)
    const state = toRenderState(r.live, { bars: BARS.map((b) => ({ ...b })), tf: 'D' })
    const drawn = (state.tables || []).flatMap((t) => (t.cells || []).map((c) => c.text))
    return { r, state, drawn }
  }

  it('⛔⛔ close = 163.265: the str.format cell is NOT drawn and the run names why; str.tostring\'s cell draws "T 163.27"', () => {
    const { r, state, drawn } = run(163.265)
    expect(drawn).toEqual(['T 163.27'])
    expect(state.unplaced.cell).toBe(1)
    expect(r.stats.textsWithheldWhy).toEqual({ [MESSAGE_DECIMAL_TIE]: 1 })
    expect(r.stats.textsWithheld).toBe(1)
  })

  it('⭐ CONTROL — close = 163.27 (no tie): both cells draw, nothing is withheld', () => {
    const { r, state, drawn } = run(163.27)
    expect(drawn.sort()).toEqual(['F 163.27', 'T 163.27'])
    expect(state.unplaced.cell).toBe(0)
    expect(r.stats.textsWithheld || 0).toBe(0)
    expect(r.stats.textsWithheldWhy).toBeUndefined()
  })

  it('⛔ a negative tie (close = -1.005) is withheld the same way', () => {
    const { r, drawn } = run(-1.005)
    expect(drawn).toEqual(['T -1.01'])
    expect(r.stats.textsWithheldWhy).toEqual({ [MESSAGE_DECIMAL_TIE]: 1 })
  })
})
