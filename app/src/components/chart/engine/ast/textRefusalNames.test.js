// app/src/components/chart/engine/ast/textRefusalNames.test.js
//
// ─── ⭐⭐ W3-S1 (2026-11-02) — A CELL'S TEXT IS DRAWN BY A PUBLISHED RULE, OR REFUSED BY NAME ─
//
// The W3 census (`docs/pine/census/w3-object-why-2026-11-02.json`) counted 22 table cells
// dropped as `cell:text` whose `cellTextWhy` read "no refusal recorded": the text reader
// gave up without saying on what. Read at their source lines they are seven SHAPES
// (`docs/pine/capture-queue-2026-11-02-w3.md`), and this file pins what S1 did with each:
//
//   A  `str.format`'s `{N,number,percent}` element is READ — TradingView's published rule
//      (`pineTextFormat.js::MESSAGE_NUMBER_PRESETS`, the reference's own examples), with
//      every corner the rule's words do not settle WITHHELD per value;
//   B  every other shape is refused BY NAME: `cellTextWhy` carries the guard and the
//      spelled shape, never "no refusal recorded" — the `{N,date,…}` and bare `{N,number}`
//      elements, the `integer` preset, and the per-pass loop shapes (an element picked out of
//      a list by the counter, a helper over a per-pass value, a `?:` that moves per pass);
//   C  controls: what drew before draws unchanged.
//
// ⛔ The named refusal rides `lastTextRefusal`, NOT `lastCanonRefusal`: the latter is read
// to DECIDE (`rtAdmits`), and a `pine:block` written there would have opened the runtime
// lane to cells it never served. A rail below asserts the drop COUNT is unchanged by the
// naming.
import { describe, it, expect } from 'vitest'

import { translatePine } from './pine'
import {
  compileMessagePattern, formatMessageNumber, percentMessageNumber,
  MESSAGE_NUMBER_PRESETS, MESSAGE_NUMBER_PATTERNS,
} from '../pineTextFormat.js'
import { buildObjectLane, runObjectLane } from '../runtime/objectLane.js'
import { OBJECT_STATUS } from '../objectRuntime'
import { toRenderState } from '../objectRenderState'

const LF = String.fromCharCode(10)
const HEAD = ['//@version=6', 'indicator("t", overlay = true)']
const TBL = 'var table t = table.new(position.top_right, 5, 5)'
const script = (...lines) => [...HEAD, ...lines].join(LF) + LF

/** The object program's cell ops and the text reader's diagnostics for one script. */
const cells = (src) => {
  const t = translatePine(src, {})
  const ops = (t.objects && t.objects.ops) || []
  const d = t.objectDiagnostics || {}
  return { t, cells: ops.filter((o) => o.k === 'cell'), why: d.cellTextWhy || [], dropped: d.dropReasons || {} }
}
const findNum = (node) => {
  if (!node || typeof node !== 'object') return null
  if (node.t === 'num') return node
  for (const v of Object.values(node)) {
    const hit = findNum(v)
    if (hit) return hit
  }
  return null
}

// ── the probe scripts: this branch's own text, one per shape ──────────────────
const P = {
  percent: script('if barstate.islast', `    ${TBL}`, '    table.cell(t, 0, 0, str.format("{0,number,percent}", close / open - 1))'),
  percentSpaced: script('if barstate.islast', `    ${TBL}`, '    table.cell(t, 0, 0, str.format("Expected return is {0, number, percent}", close / open - 1))'),
  date: script('if barstate.islast', `    ${TBL}`, '    table.cell(t, 0, 0, str.format("{0,date,yyyy-MM-dd}", time))'),
  numberBare: script('if barstate.islast', `    ${TBL}`, '    table.cell(t, 0, 0, str.format("{0,number}", close))'),
  integer: script('if barstate.islast', `    ${TBL}`, '    table.cell(t, 0, 0, str.format("{0,number,integer}", close))'),
  loopList: script('if barstate.islast', `    ${TBL}`, '    string[] headers = array.from("A", "B", "C")', '    for i = 0 to 2', '        table.cell(t, i, 0, array.get(headers, i))'),
  loopHelper: script('f_txt(float v) =>', '    v > 0 ? "up" : "down"', 'if barstate.islast', `    ${TBL}`, '    float[] vals = array.from(close - open, open - close)', '    for i = 0 to 1', '        table.cell(t, i, 1, f_txt(array.get(vals, i)))'),
  loopTernary: script('if barstate.islast', `    ${TBL}`, '    for k = 0 to 2', '        bool isAxis = k == 1', '        table.cell(t, 0, k, (isAxis ? "< " : "") + str.tostring(close + k * syminfo.mintick, format.mintick))'),
  loopLocal: script('if barstate.islast', `    ${TBL}`, '    float[] rs = array.from(close, open, high, low)', '    for i = 0 to 3', '        float rv = array.get(rs, i)', '        string rTxt = na(rv) ? "-" : str.tostring(rv, "#.#")', '        table.cell(t, i + 1, 2, rTxt)'),
  control: script('if barstate.islast', `    ${TBL}`, '    table.cell(t, 0, 0, str.format("{0,number,#.##}", close))', '    table.cell(t, 1, 0, "C " + str.tostring(close, "#.##"))'),
  helperParam: script('f_cell(table _t, int _r, string _s) =>', '    table.cell(_t, 0, _r, _s)', 'if barstate.islast', `    ${TBL}`, '    f_cell(t, 0, "hello")', '    f_cell(t, 1, "A " + str.tostring(close, "#.##"))'),
}

describe('A — `{N,number,percent}` is read by the published rule', () => {
  it('⭐ the grammar admits the keyword, spaced as the reference spells it, and nothing else new', () => {
    expect(compileMessagePattern('{0,number,percent}', 1)).toEqual({ ok: true, parts: [{ arg: 0, fmt: 'percent' }] })
    expect(compileMessagePattern('Expected return is {0, number, percent} - {1, number, percent}', 2))
      .toEqual({ ok: true, parts: [{ lit: 'Expected return is ' }, { arg: 0, fmt: 'percent' }, { lit: ' - ' }, { arg: 1, fmt: 'percent' }] })
    expect(Object.keys(MESSAGE_NUMBER_PRESETS)).toEqual(['percent'])
    expect(Object.keys(MESSAGE_NUMBER_PATTERNS)).toEqual(['#.##'])
    // ⛔ the other two presets the reference names stay refused BY NAME (capture row Q-W3-3)
    expect(compileMessagePattern('{0,number,integer}', 1).why).toBe('format:number-pattern:integer')
    expect(compileMessagePattern('{0,number,currency}', 1).why).toBe('format:number-pattern:currency')
    expect(compileMessagePattern('{0,number, #.##}', 1).why).toBe('format:number-pattern: #.##')
  })

  it('⭐ the reference\'s three examples, character for character', () => {
    expect(percentMessageNumber(0.5)).toBe('50%')
    expect(percentMessageNumber(0.1)).toBe('10%')
    expect(percentMessageNumber(0.2)).toBe('20%')
    expect(formatMessageNumber(0.5, 'percent')).toBe('50%')
  })

  it('⭐ "rounds the result to the nearest whole number": rounded, not truncated, either sign', () => {
    expect(percentMessageNumber(0.296)).toBe('30%')
    expect(percentMessageNumber(0.294)).toBe('29%')
    expect(percentMessageNumber(-0.126)).toBe('-13%')
    expect(percentMessageNumber(-0.124)).toBe('-12%')
    expect(percentMessageNumber(0)).toBe('0%')
    expect(percentMessageNumber(1)).toBe('100%')
    expect(percentMessageNumber(9.994)).toBe('999%')
  })

  it('⛔ WITHHELD where the rule\'s words do not settle the characters', () => {
    expect(percentMessageNumber(0.125)).toBeNull() // an exact tie at the whole percent (12.5)
    expect(percentMessageNumber(-0.125)).toBeNull()
    expect(percentMessageNumber(10)).toBeNull() // 1000 %: the grouping comma is unmeasured
    expect(percentMessageNumber(-10)).toBeNull()
    expect(percentMessageNumber(-0.004)).toBeNull() // rounds to a negative zero
    expect(percentMessageNumber(NaN)).toBeNull()
    expect(percentMessageNumber(Infinity)).toBeNull()
    expect(percentMessageNumber('0.5')).toBeNull()
    expect(formatMessageNumber(0.125, 'percent')).toBeNull()
  })

  it('⭐ the translator carries the cell with a message number under the `percent` preset', () => {
    for (const src of [P.percent, P.percentSpaced]) {
      const { cells: got, dropped } = cells(src)
      expect(dropped['cell:text']).toBeUndefined()
      expect(got).toHaveLength(1)
      expect(got[0].props.text.v).toBe('text')
      expect(findNum(got[0].props.text.node)).toMatchObject({ t: 'num', form: 'message', fmt: 'percent' })
    }
  })

  describe('the object runtime draws the rule\'s text, and holds back a withheld value', () => {
    const N = 12
    const barsOf = (c) => Array.from({ length: N }, (_, i) => ({ t: 1700000000 + i * 86400, o: 100, h: 160, l: 90, c, v: 1000000 }))
    const run = (close, text) => {
      const BARS = barsOf(close)
      const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
      const src = script('if barstate.islast', `    label.new(bar_index, close, ${text})`)
      const lane = buildObjectLane(src, { tf: 'D', newestBarIsForming: false, bars: BARS })
      expect(lane.ok, lane.ok ? '' : `refused ${(lane.refusal || {}).guard}`).toBe(true)
      const r = runObjectLane(lane, { bars: N, series: SERIES, confirmed: true, readTime: (i) => BARS[i].t })
      expect(r.status, r.reason).toBe(OBJECT_STATUS.OK)
      const state = toRenderState(r.live, { bars: BARS.map((b) => ({ ...b })), tf: 'D' })
      return { r, held: r.live.filter((o) => o.family === 'label'), state }
    }
    it('⭐ close / open − 1 = 0.5 draws "Return 50%"', () => {
      const { held, state } = run(150, 'str.format("Return {0,number,percent}", close / open - 1)')
      expect(held.map((o) => o.props.text)).toEqual(['Return 50%'])
      expect(state.labels.map((l) => l.text)).toEqual(['Return 50%'])
    })
    it('⛔ an exact tie (0.125) is HELD, NOT DRAWN, and counted', () => {
      const { r, held, state } = run(112.5, 'str.format("Return {0,number,percent}", close / open - 1)')
      expect(held).toHaveLength(1)
      expect(held[0].props.text).toBeNull()
      expect(state.labels).toHaveLength(0)
      expect(r.stats.textsWithheld).toBeGreaterThan(0)
    })
  })
})

describe('B — every other S1 shape is refused BY NAME, never "no refusal recorded"', () => {
  const whyOf = (src) => {
    const got = cells(src)
    expect(got.dropped['cell:text'], 'the cell is still dropped').toBeGreaterThan(0)
    expect(got.why.length, 'a reason is recorded').toBeGreaterThan(0)
    for (const w of got.why) expect(w).not.toContain('no refusal recorded')
    return got
  }

  it('⛔ `{N,date,…}` — the text reader\'s own refusal, naming the element', () => {
    const { why } = whyOf(P.date)
    expect(why[0]).toMatch(/pine:text-value/)
    expect(why[0]).toMatch(/`str\.format` has a `\{N,date,…\}` element/)
  })

  it('⛔ a bare `{N,number}` element names itself (capture row Q-W3-2)', () => {
    const { why } = whyOf(P.numberBare)
    expect(why[0]).toMatch(/`\{N,number\}` element with no pattern/)
  })

  it('⛔ the `integer` preset names the pattern (capture row Q-W3-3)', () => {
    const { why } = whyOf(P.integer)
    expect(why[0]).toMatch(/number pattern `integer` no capture or published example pins/)
  })

  it('⛔ a string list read by the counter: `loop:per-pass`, the shape spelled', () => {
    const { why } = whyOf(P.loopList)
    expect(why[0]).toMatch(/^cell@\d+: loop:per-pass the `text` slot moves per pass of the loop and is /)
    expect(why[0]).toMatch(/an element picked out of a list by the counter: `array\.get\(headers, i\)`/)
  })

  it('⛔ a helper called over a per-pass value, spelled with its argument', () => {
    const { why } = whyOf(P.loopHelper)
    expect(why[0]).toMatch(/loop:per-pass/)
    expect(why[0]).toMatch(/a helper called over a per-pass value: `f_txt\(array\.get\(vals, i\)\)`/)
  })

  it('⛔ a `?:` whose test moves per pass, reached through a `+` and through a local', () => {
    const viaPlus = whyOf(P.loopTernary)
    expect(viaPlus.why[0]).toMatch(/loop:per-pass/)
    expect(viaPlus.why[0]).toMatch(/a `\?:` whose test or arm moves per pass: `isAxis \? "< " : ""`/)
    const viaLocal = whyOf(P.loopLocal)
    expect(viaLocal.why[0]).toMatch(/a `\?:` whose test or arm moves per pass: `na\(rv\) \? "-" : str\.tostring\(rv, "#\.#"\)`/)
  })

  it('⛔ the naming changes NO decision: the drop counts are what they were', () => {
    // one dropped cell per probe below, exactly as before the names landed
    for (const src of [P.date, P.numberBare, P.integer]) expect(cells(src).dropped['cell:text']).toBe(1)
    expect(cells(P.loopList).dropped['cell:text']).toBe(3)
    expect(cells(P.loopHelper).dropped['cell:text']).toBe(2)
    expect(cells(P.loopTernary).dropped['cell:text']).toBe(3)
    expect(cells(P.loopLocal).dropped['cell:text']).toBe(4)
  })
})

describe('C — controls: what drew before draws unchanged', () => {
  it('`{N,number,#.##}` and `str.tostring(x, "#.##")` cells are carried, nothing refused', () => {
    const { cells: got, dropped, why } = cells(P.control)
    expect(dropped['cell:text']).toBeUndefined()
    expect(why).toEqual([])
    expect(got).toHaveLength(2)
    expect(findNum(got[0].props.text.node)).toMatchObject({ t: 'num', form: 'message', fmt: '#.##' })
    expect(findNum(got[1].props.text.node)).toMatchObject({ t: 'num', fmt: '#.##' })
  })
  it('a helper that performs `table.cell` with a string parameter carries both cells (the S1-G shape of the census reads; its silent cell was a `{N,time,…}` element in the argument)', () => {
    const { cells: got, dropped, why } = cells(P.helperParam)
    expect(dropped['cell:text']).toBeUndefined()
    expect(why).toEqual([])
    expect(got).toHaveLength(2)
    expect(got[0].props.text.node).toEqual({ t: 'lit', s: 'hello' })
    expect(got[1].props.text.node).toMatchObject({ t: 'cat', args: [{ t: 'lit', s: 'A ' }, { t: 'num', fmt: '#.##' }] })
  })
  it('the bare `{N}` rendering is what the liquidation-levels capture pinned', () => {
    expect(formatMessageNumber(120.42566666666667)).toBe('120.426')
    expect(formatMessageNumber(5)).toBe('5')
    expect(formatMessageNumber(1000)).toBeNull()
  })
})
