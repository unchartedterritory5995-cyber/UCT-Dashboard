// app/src/components/chart/engine/ast/textRefusalNames.test.js
//
// ─── ⭐⭐ W3-S1 (2026-11-02) — A CELL'S TEXT IS DRAWN BY A PUBLISHED RULE, OR REFUSED BY NAME ─
//
// The W3 census (`docs/pine/census/w3-object-why-2026-11-02.json`) counted 22 table cells
// dropped as `cell:text` whose `cellTextWhy` read "no refusal recorded": the text reader
// gave up without saying on what. Read at their source lines they are seven SHAPES
// (`docs/pine/capture-queue-2026-11-02-w3.md`), and this file pins what S1 did with each:
//
//   A  `str.format`'s `{N,number,percent}` element is REFUSED BY NAME (r3): the published rule
//      names no sign, and no capture shows a percent, so nothing is drawn until Q-W3-3 matches
//      (`pineTextFormat.js::PERCENT_CAPTURED`); the formatting code is kept and unit-railed;
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
import { assertObjectProgram } from './objectProgram'
import {
  compileMessagePattern, formatMessageNumber, percentMessageNumber, percentWithheldWhy,
  percentFormatUncaptured, percentCornerWhy, PERCENT_CAPTURED, servedPreset, isMessageNumberFormat,
  MESSAGE_NUMBER_PRESETS, MESSAGE_NUMBER_PATTERNS,
} from '../pineTextFormat.js'
import { buildObjectLane, runObjectLane } from '../runtime/objectLane.js'
import { OBJECT_STATUS } from '../objectRuntime'
import { toRenderState } from '../objectRenderState'
import { probeObjectRuntime } from '../runtime/runtimeColumns'

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
  loopTernary: script('if barstate.islast', `    ${TBL}`, '    for k = 0 to 2', '        bool onMark = k == 1', '        table.cell(t, 0, k, (onMark ? "< " : "") + str.tostring(close + k * syminfo.mintick, format.mintick))'),
  loopLocal: script('if barstate.islast', `    ${TBL}`, '    float[] rs = array.from(close, open, high, low)', '    for i = 0 to 3', '        float x = array.get(rs, i)', '        string xTxt = na(x) ? "-" : str.tostring(x, "#.#")', '        table.cell(t, i + 1, 2, xTxt)'),
  control: script('if barstate.islast', `    ${TBL}`, '    table.cell(t, 0, 0, str.format("{0,number,#.##}", close))', '    table.cell(t, 1, 0, "C " + str.tostring(close, "#.##"))'),
  helperParam: script('f_cell(table _t, int _r, string _s) =>', '    table.cell(_t, 0, _r, _s)', 'if barstate.islast', `    ${TBL}`, '    f_cell(t, 0, "hello")', '    f_cell(t, 1, "A " + str.tostring(close, "#.##"))'),
}

describe('A — `{N,number,percent}` is REFUSED BY NAME until capture Q-W3-3 matches (r3, B1+B2)', () => {
  // The rule's words ("multiplies by 100, rounds to the nearest whole number") name no sign, no
  // sign character and no placement, and no capture shows a percent: every percent value,
  // positive or negative, is withheld. The formatting code is KEPT behind `PERCENT_CAPTURED`.
  const SAMPLE = [0.5, 0.1, 0.2, 0.296, 0.004, 0, 1, 9.994, -0.126, -0.004, -0.575, -0.124, -0.5, 0.575, 0.125, -0.125, 10, NaN]
  it('⛔ the gate is shut and nothing is served', () => {
    expect(PERCENT_CAPTURED).toBe(false)
    expect(servedPreset('percent')).toBe(false)
    expect(isMessageNumberFormat('percent')).toBe(false)
    expect(Object.keys(MESSAGE_NUMBER_PRESETS)).toEqual(['percent']) // the rule stays on file
    expect(Object.keys(MESSAGE_NUMBER_PATTERNS)).toEqual(['#.##'])
  })

  it('⛔ the grammar refuses the keyword BY NAME, spaced or not, as master did', () => {
    expect(compileMessagePattern('{0,number,percent}', 1)).toEqual({ ok: false, why: 'format:number-pattern:percent' })
    expect(compileMessagePattern('Expected return is {0, number, percent} - {1, number, percent}', 2).why).toBe('format:number-pattern: percent')
    expect(compileMessagePattern('{0, number ,	percent }', 1).ok).toBe(false)
    expect(compileMessagePattern('{0,number,integer}', 1).why).toBe('format:number-pattern:integer')
    expect(compileMessagePattern('{0,number,currency}', 1).why).toBe('format:number-pattern:currency')
    expect(compileMessagePattern('{0,number,#.##}', 1).ok).toBe(true) // control: the captured pattern still reads
  })

  it('⛔ the type keyword is trimmed as Java String.trim does: U+0000..U+0020 only, never NBSP', () => {
    const NBSP = String.fromCharCode(0xa0)
    expect(compileMessagePattern('{0, number ,#.##}', 1).ok).toBe(true)
    expect(compileMessagePattern(`{0,${NBSP}number,#.##}`, 1).why).toBe(`format:element:${NBSP}number`)
    expect(compileMessagePattern(`{0,number${NBSP},#.##}`, 1).why).toBe(`format:element:number${NBSP}`)
  })

  it('⛔ every value, positive AND negative, is withheld by name `percent:uncaptured`', () => {
    for (const n of SAMPLE) {
      expect(percentMessageNumber(n), String(n)).toBeNull()
      expect(percentWithheldWhy(n), String(n)).toBe('percent:uncaptured')
      expect(formatMessageNumber(n, 'percent'), String(n)).toBeNull()
    }
    expect(formatMessageNumber(0.5, '#.##')).toBe('0.5') // control: the captured pattern still formats
  })

  it('⛔ the translator drops the cell BY NAME, with the capture row in the sentence', () => {
    for (const src of [P.percent, P.percentSpaced]) {
      const { cells: got, dropped, why } = cells(src)
      expect(got).toHaveLength(0)
      expect(dropped['cell:text']).toBeGreaterThan(0)
      expect(why[0]).toMatch(/number pattern `[ ]?percent` no capture or published example pins/)
      expect(why[0]).toMatch(/Q-W3-3/)
    }
  })

  it('⛔ the document validator refuses a forged `percent` node', () => {
    const t = translatePine(P.control, {})
    const forged = JSON.parse(JSON.stringify(t.objects))
    findNum(forged.ops.find((o) => o.k === 'cell').props.text.node).fmt = 'percent'
    expect(() => assertObjectProgram(forged)).toThrow(/str\.format pattern "percent" is not one a capture or published rule pins/)
  })

  it('⛔ the object lane draws NOTHING for a percent label, whatever the value', () => {
    const N = 12
    for (const close of [150, 100 * 0.874, 112.5]) {
      const BARS = Array.from({ length: N }, (_, i) => ({ t: 1700000000 + i * 86400, o: 100, h: 160, l: 90, c: close, v: 1000000 }))
      const src = script('if barstate.islast', '    label.new(bar_index, close, str.format("Return {0,number,percent}", close / open - 1))')
      const lane = buildObjectLane(src, { tf: 'D', newestBarIsForming: false, bars: BARS })
      expect(lane.ok, `close ${close}`).toBe(false)
    }
  })

  it('⭐ KEPT, NOT SERVED — the reference\'s three examples, character for character', () => {
    expect(percentFormatUncaptured(0.5)).toBe('50%')
    expect(percentFormatUncaptured(0.1)).toBe('10%')
    expect(percentFormatUncaptured(0.2)).toBe('20%')
  })

  it('KEPT, NOT SERVED — "rounds the result to the nearest whole number": rounded, not truncated, either sign', () => {
    expect(percentFormatUncaptured(0.296)).toBe('30%')
    expect(percentFormatUncaptured(0.294)).toBe('29%')
    expect(percentFormatUncaptured(-0.126)).toBe('-13%')
    expect(percentFormatUncaptured(-0.124)).toBe('-12%')
    expect(percentFormatUncaptured(0)).toBe('0%')
    expect(percentFormatUncaptured(1)).toBe('100%')
    expect(percentFormatUncaptured(9.994)).toBe('999%')
  })

  it('KEPT, NOT SERVED — r2 off a tie in EITHER reading the value is drawn: the neighbours of the decimal ties', () => {
    // each sits 0.1 % from a decimal tie: binary and decimal readings, HALF_UP and HALF_EVEN agree
    const drawn = [
      [0.574, '57%'], [0.576, '58%'], [0.144, '14%'], [0.146, '15%'], [0.034, '3%'], [0.036, '4%'],
      [-0.574, '-57%'], [-0.576, '-58%'], [-0.144, '-14%'], [-0.146, '-15%'],
    ]
    for (const [n, out] of drawn) {
      expect(percentCornerWhy(n), String(n)).toBeNull()
      expect(percentFormatUncaptured(n), String(n)).toBe(out)
    }
    expect(percentFormatUncaptured(0.004)).toBe('0%') // a positive zero is the rule's own "0%"
  })

  it('KEPT, NOT SERVED — WITHHELD where the rule\'s words do not settle the characters', () => {
    expect(percentFormatUncaptured(0.125)).toBeNull() // an exact tie at the whole percent (12.5)
    expect(percentFormatUncaptured(-0.125)).toBeNull()
    expect(percentFormatUncaptured(10)).toBeNull() // 1000 %: the grouping comma is unmeasured
    expect(percentFormatUncaptured(-10)).toBeNull()
    // the bound is on the ROUNDED whole: 999.6 % rounds to 1000 ("1,000%" under `#,###%`)
    expect(percentFormatUncaptured(9.996)).toBeNull()
    expect(percentFormatUncaptured(-9.996)).toBeNull()
    expect(percentFormatUncaptured(-0.004)).toBeNull() // rounds to a negative zero
    expect(percentCornerWhy(-0.004)).toBe('percent:negative-zero')
    // ⛔ r2 — `-0` itself: Java's DecimalFormat prints "-0%"; the docs do not say
    expect(percentFormatUncaptured(-0)).toBeNull()
    expect(percentCornerWhy(-0)).toBe('percent:negative-zero')
    expect(percentCornerWhy(0)).toBeNull()
    expect(percentCornerWhy(0.125)).toBe('percent:tie')
    expect(percentCornerWhy(9.996)).toBe('percent:grouping')
    expect(percentCornerWhy(NaN)).toBe('percent:na')
    expect(percentFormatUncaptured(NaN)).toBeNull()
    expect(percentFormatUncaptured(Infinity)).toBeNull()
    expect(percentFormatUncaptured('0.5')).toBeNull()
  })

  it('KEPT, NOT SERVED — r2 a DECIMAL half tie is withheld by name although the binary product is not x.5', () => {
    // 0.575 * 100 === 57.49999999999999: a binary product draws "57%", a decimal reading
    // "58%" under HALF_UP and HALF_EVEN alike; no published source says which TradingView uses
    const ties = [0.035, 0.145, 0.275, 0.285, 0.545, 0.555, 0.565, 0.575]
    expect(0.575 * 100).toBe(57.49999999999999)
    for (const n of [...ties, ...ties.map((v) => -v)]) {
      expect(percentCornerWhy(n), String(n)).toBe('percent:decimal-tie')
      expect(percentFormatUncaptured(n), String(n)).toBeNull()
    }
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
    expect(viaPlus.why[0]).toMatch(/a `\?:` whose test or arm moves per pass: `onMark \? "< " : ""`/)
    const viaLocal = whyOf(P.loopLocal)
    expect(viaLocal.why[0]).toMatch(/a `\?:` whose test or arm moves per pass: `na\(x\) \? "-" : str\.tostring\(x, "#\.#"\)`/)
  })

  it('⛔ the naming changes NO decision: the drop counts are what they were', () => {
    // one dropped cell OP per probe (a loop's cell is one op, however many passes), and
    // the loop probes' `loop:empty` beside it — measured on the merge base before the
    // names landed (W3-S1 probes, 2026-11-02)
    for (const src of [P.date, P.numberBare, P.integer]) expect(cells(src).dropped).toEqual({ 'cell:text': 1 })
    for (const src of [P.loopList, P.loopHelper, P.loopTernary, P.loopLocal]) {
      expect(cells(src).dropped).toEqual({ 'cell:text': 1, 'loop:empty': 1 })
    }
  })

  it("⛔ a create's content slot names the text reader's refusal too (`createDropWhy`)", () => {
    const t = translatePine(script('if barstate.islast', '    label.new(bar_index, close, str.format("{0,date,yyyy-MM-dd}", time))'), {})
    const why = (t.objectDiagnostics || {}).createDropWhy || []
    expect(why.length, 'the label create is dropped and named').toBeGreaterThan(0)
    for (const w of why) expect(w).not.toContain('no refusal recorded')
    expect(why.join(' | ')).toMatch(/text: pine:text-value `str\.format` has a `\{N,date,…\}` element/)
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

describe("D — the text reader's refusal never takes the place of an admitting one (C18 door)", () => {
  // A text bound below a stepped-over loop (`bias`) writes the admitting `pine:block` refusal; the
  // label's text then BUILDS (with a runtime placeholder for `bias`) but nests past
  // TEXT_NODE_MAX_NEST, so `fitTextNest` refuses it BY NAME (`pine:text-value`) and `valueRef` asks
  // the runtime lane for the WHOLE text. That ask reads `lastCanonRefusal`: a text refusal written
  // there would close the lane and drop a label the door carries (muts2.json M19).
  const chain = (n, tail) => {
    let e = tail
    for (let k = n; k >= 1; k--) e = `close > open + ${k} ? "L${k}" : (${e})`
    return e
  }
  const LOOPNET = ['if barstate.islast', '    int i = 0', '    float net = 0.0', '    while i < 3', '        net -= close[i]', '        i += 1',
    '    bias = net > 0 ? "LONG" : "SHORT"']
  const door = (src) => translatePine(src, { strict: true, objects: true, objectRuntimeCheck: probeObjectRuntime })

  it('⛔ a too-deep text after an admitting refusal is still read whole from the runtime lane', () => {
    const t = door(script(...LOOPNET, `    label.new(bar_index, close, ${chain(18, 'bias')})`, 'plot(close)'))
    const d = t.objectDiagnostics || {}
    expect(d.dropReasons || {}).toEqual({})
    expect(((t.objects && t.objects.ops) || []).filter((o) => o.k === 'create' && o.family === 'label')).toHaveLength(1)
    const at = (t.objects && t.objects.runtime && t.objects.runtime.at) || []
    expect(at.filter((a) => a.kind === 'text').map((a) => a.node && a.node.type)).toContain('ternary')
  })

  it('⛔ CONTROL — with no admitting refusal the same depth is dropped, named `pine:text-value`', () => {
    const t = door(script('if barstate.islast', `    label.new(bar_index, close, ${chain(18, '"x"')})`, 'plot(close)'))
    const d = t.objectDiagnostics || {}
    expect(d.dropReasons).toEqual({ 'create:label': 1 })
    expect((d.createDropWhy || []).join(' | ')).toMatch(/text: pine:text-value this text's node nests deeper than the runtime reads/)
  })
})

