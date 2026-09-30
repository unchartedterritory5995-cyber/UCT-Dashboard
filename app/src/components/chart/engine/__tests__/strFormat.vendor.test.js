// app/src/components/chart/engine/__tests__/strFormat.vendor.test.js
//
// ─── ⭐⭐ `str.format` — READ OFF THE VENDOR'S OWN TEXT (C15, objects-triage step 13) ─
//
// Every expectation here is a TradingView string or a TradingView length, never a
// belief about MessageFormat:
//
//   A  the grammar the translator admits, and what it refuses BY NAME;
//   B  `{N}` over a number, against the ten labels of
//      `liquidation-levels-rddt-1d-2026-09-28.json` — each label's own `y` IS the
//      number its `{1}` printed, so the vendor supplies both sides of the check;
//   C  `{N,number,#.##}`, against the length the vendor measured on 300 SPY bars
//      (`w3-format-spy-1d-2026-09-22.json`, F12);
//   D  what no capture pins is WITHHELD, and the withheld object is not drawn;
//   E  the whole capture through the member door: liquidation-levels MATCHES.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import {
  compileMessagePattern, formatMessageNumber, exactTieAt, MESSAGE_NUMBER_PATTERNS,
} from '../pineTextFormat.js'
import { gradeCapture, loadCapture, HARNESS_DIR } from './vendorHarness/harness'
import { buildObjectLane, runObjectLane } from '../runtime/objectLane.js'
import { OBJECT_STATUS } from '../objectRuntime'
import { toRenderState } from '../objectRenderState'

const LIQ = 'liquidation-levels-rddt-1d-2026-09-28'
const liqCapture = () => {
  const loaded = loadCapture(path.join(HARNESS_DIR, `${LIQ}.json`))
  if (!loaded.capture) throw new Error(`${LIQ}: ${loaded.reason}`)
  return loaded.capture
}
const W3 = JSON.parse(fs.readFileSync(
  path.resolve(process.cwd(), '../tests/fixtures/vendor/w3-format-spy-1d-2026-09-22.json'), 'utf8'))

describe('A — the pattern grammar: what a capture pins is admitted, the rest refused by name', () => {
  it('⭐ literal text and `{N}` slots, in order', () => {
    const c = compileMessagePattern('+{0}x: {1}', 2)
    expect(c).toEqual({ ok: true, parts: [{ lit: '+' }, { arg: 0 }, { lit: 'x: ' }, { arg: 1 }] })
  })

  it('⭐ `{N,number,#.##}` — the one number pattern F12 pins', () => {
    expect(compileMessagePattern('{0,number,#.##}', 1)).toEqual({ ok: true, parts: [{ arg: 0, fmt: '#.##' }] })
    expect(Object.keys(MESSAGE_NUMBER_PATTERNS)).toEqual(['#.##'])
  })

  it('⛔ everything no capture shows is refused, each under its own name', () => {
    const why = (p, n = 1) => compileMessagePattern(p, n).why
    expect(why("it's {0}")).toBe('format:quote')
    expect(why('{0')).toBe('format:brace')
    expect(why('0}')).toBe('format:brace')
    expect(why('{1}')).toBe('format:index')
    expect(why('{x}')).toBe('format:element')
    expect(why('{0,number}')).toBe('format:element:number')
    expect(why('{0,number,percent}')).toBe('format:number-pattern:percent')
    expect(why('{0,number,integer}')).toBe('format:number-pattern:integer')
    expect(why('{0,number,#.#}')).toBe('format:number-pattern:#.#')
    expect(why('{0,number,#,###.##}')).toBe('format:number-pattern:#,###.##')
    expect(why('{0,date,short}')).toBe('format:element:date')
    // ⛔ CONTROL — the refusals are not the whole answer
    expect(compileMessagePattern('no slots at all', 0)).toEqual({ ok: true, parts: [{ lit: 'no slots at all' }] })
  })
})

describe('B — `{N}` over a number, against the ten liquidation-levels labels', () => {
  const labels = liqCapture().objects.records.labels

  it('⛔ the fixture is the one this was written against', () => {
    expect(labels).toHaveLength(10)
    expect(labels.map((l) => l.t)).toContain('+5x: 120.426')
  })

  it('⭐⭐ every label: its `{1}` is its own `y`, formatted — three decimals, rounded, trimmed', () => {
    // `str.format("+{0}x: {1}", i_x, level)` and the label sits AT `level`, so the
    // vendor's record carries the exact number its text printed.
    const LEVERAGE = [5, 10, 20, 50, 100]
    for (const [i, l] of labels.entries()) {
      const sign = i < 5 ? '+' : '-'
      const lev = LEVERAGE[i % 5]
      const ours = `${sign}${formatMessageNumber(lev)}x: ${formatMessageNumber(l.y)}`
      expect(ours, `label ${l.id}`).toBe(l.t)
    }
  })

  it('⛔ CONTROL — the rule is ROUNDING at three: truncation, two or four decimals all miss', () => {
    const y = labels[0].y                                  // 120.42566666666667 → "120.426"
    expect(Math.trunc(y * 1000) / 1000).not.toBe(Number(labels[0].t.split(': ')[1]))
    expect(y.toFixed(2)).not.toBe(labels[0].t.split(': ')[1])
    expect(y.toFixed(4)).not.toBe(labels[0].t.split(': ')[1])
  })
})

describe('C — `{N,number,#.##}`, against the vendor\'s F12 lengths on 300 SPY bars', () => {
  it('⭐⭐ every bar the vendor answered: our rendering has the vendor\'s length', () => {
    const rows = W3.rows.filter((r) => Number.isFinite(r.F12_len_str_format))
    expect(rows.length).toBe(300)
    for (const r of rows) {
      const s = formatMessageNumber(r.close, '#.##')
      expect(s, `bar ${r.bar_index} close ${r.close}`).not.toBeNull()
      expect(s.length, `bar ${r.bar_index} close ${r.close} → ${s}`).toBe(r.F12_len_str_format)
    }
    // ⛔ NON-VACUITY: the fixture exercises both a trimmed and an integer close
    expect(new Set(rows.map((r) => r.F12_len_str_format))).toEqual(new Set([3, 5, 6]))
  })
})

describe('D — what no capture pins is WITHHELD, never approximated', () => {
  it('⛔ the four unpinned cases each come back null', () => {
    expect(formatMessageNumber(1234.5)).toBeNull()          // grouping unmeasured
    expect(formatMessageNumber(999.9994)).toBe('999.999')   // CONTROL — just below the bound
    expect(formatMessageNumber(0.0625)).toBeNull()          // exact tie at three decimals
    expect(exactTieAt(0.0625, 3)).toBe(true)
    expect(exactTieAt(0.06251, 3)).toBe(false)              // CONTROL — not a tie
    expect(formatMessageNumber(NaN)).toBeNull()             // na through str.format
    expect(formatMessageNumber(-0.0001)).toBeNull()         // would read "-0"
    expect(formatMessageNumber(-1.5)).toBe('-1.5')          // CONTROL — an ordinary negative
    expect(formatMessageNumber(5)).toBe('5')
  })

  const LF = String.fromCharCode(10)
  const Q = String.fromCharCode(34)
  const N = 30
  const BARS = Array.from({ length: N }, (_, i) => ({
    t: 1700000000 + i * 86400, o: 100, h: 104, l: 96, c: 100 + i / 8, v: 1000000,
  }))
  const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
  const run = (expr) => {
    const src = `//@version=5${LF}indicator(${Q}t${Q}, overlay = true)${LF}`
      + `if barstate.islast${LF}    label.new(bar_index, close, str.format(${Q}v {0}${Q}, ${expr}))${LF}`
    const lane = buildObjectLane(src, { tf: 'D', newestBarIsForming: false, bars: BARS })
    expect(lane.ok, lane.ok ? '' : `refused ${(lane.refusal || {}).guard}`).toBe(true)
    const r = runObjectLane(lane, { bars: N, series: SERIES, confirmed: true, readTime: (i) => BARS[i].t })
    expect(r.status, r.reason).toBe(OBJECT_STATUS.OK)
    const state = toRenderState(r.live, { bars: BARS.map((b) => ({ ...b })), tf: 'D' })
    return { r, state, held: r.live.filter((o) => o.family === 'label') }
  }

  it('⭐ a pinned value is drawn with the vendor\'s text', () => {
    const { held, state } = run('close')                    // 103.625 at the last bar
    expect(held.map((o) => o.props.text)).toEqual(['v 103.625'])
    expect(state.labels.map((l) => l.text)).toEqual(['v 103.625'])
  })

  it('⛔⛔ an unpinned value is HELD but NOT DRAWN, and the run says how many', () => {
    const { r, held, state } = run('close * 100')           // 10362.5 — past the bound
    expect(held).toHaveLength(1)
    expect(held[0].props.text).toBeNull()
    expect(state.labels).toHaveLength(0)
    expect(state.dropped.label).toBe(1)
    expect(r.stats.textsWithheld).toBeGreaterThan(0)
  })
})

describe('E — the whole capture, through the member door', () => {
  it('⭐⭐ liquidation-levels: ten labels, every text, every plot — MATCH', () => {
    const { verdict } = gradeCapture(liqCapture())
    expect(verdict.objects.verdict, verdict.objects.reason).toBe('MATCH')
    const labels = verdict.objects.counts.find((c) => c.family === 'labels')
    expect(labels).toMatchObject({ vendor: 10, ours: 10 })
    expect(verdict.objects.texts.find((t) => t.family === 'labels text').agree).toBe(true)
    expect(verdict.verdict, verdict.reason).toBe('MATCH')
  }, 60000)
})
