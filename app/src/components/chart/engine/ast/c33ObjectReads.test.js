// app/src/components/chart/engine/ast/c33ObjectReads.test.js
//
// ─── C33 — FOUR OBJECT-LANE READS, RAILED ONE MECHANISM AT A TIME ─────────────
//
//   1. `array.push(list, f(…))` / `list.push(f(…))` — a helper's drawing pushed
//      straight onto a drawing list is the two statements Pine runs
//      (`pineObjects.js::pushOfDrawCall`), and a helper whose body ends in a lone
//      `if … <ns>.new(…)` returns that object or `na` (`ifOnlyReturn`).
//   2. an `input.timeframe` default in a TEXT is the default only for a spelling a
//      capture prints under that Pine version (`INPUT_TIMEFRAME_TEXT_WITNESS`);
//      any other spelling is marked unknown on the property (the op still runs),
//      never printed and never a lost create.
//   3. a text over the program validator's nesting bound is fitted by replacing
//      each bar-invariant `if` with its taken arm, or refused by name — never a
//      document the door throws out (`fitTextNest`).
//   4. a `request.security` timeframe that is a function PARAMETER is the
//      caller's argument (`timeframeLiteralOf`).
//   5. `last_bar_time` is the newest bar's time in milliseconds
//      (`PINE_TO_CLOCK_SPELLING` / `PINE_CLOCK_TRANSFORM`).
//
// The vendor-grounded halves are `__tests__/vendorHarness/vendorHarness.c33ObjectReads.test.js`.
import { describe, it, expect } from 'vitest'
import { translatePine, INPUT_TIMEFRAME_TEXT_WITNESS, inputTimeframeTextWitnessed } from './pine'
import { evaluateObjects } from '../objectRuntime'
import { assertObjectProgram } from './objectProgram'
import { classifyDropKey, LOSS } from './objectLoss'

const LF = String.fromCharCode(10)
const src = (v, ...lines) => [`//@version=${v}`, 'indicator("t", overlay=true)', ...lines].join(LF)
const host = (s) => translatePine(s, { strict: true })
const opsOf = (t) => (t.objects && t.objects.ops) || []
const diag = (t) => t.objectDiagnostics || {}

/** Run a program over synthetic bars; trees answer a fixed rule (NaN otherwise). */
function run(t, bars = 12) {
  const trees = t.objects.trees
  const ev = (n, bar) => {
    if (!n) return NaN
    if (n.type === 'num') return n.value
    if (n.type === 'series') {
      if (n.name === 'barindex') return bar
      if (n.name === 'high') return 101 + bar
      if (n.name === 'low') return 99 + bar
      if (n.name === 'close') return 100 + bar
      return NaN
    }
    if (n.type === 'op') {
      const a = (n.args || []).map((x) => ev(x, bar))
      switch (n.name) {
        case '+': return a[0] + a[1]
        case '-': return a[0] - a[1]
        case '>': return a[0] > a[1] ? 1 : 0
        case '<': return a[0] < a[1] ? 1 : 0
        case '&&': return a[0] && a[1] ? 1 : 0
        case '!': return a[0] ? 0 : 1
        case '>=': return a[0] >= a[1] ? 1 : 0
        case '==': return a[0] === a[1] ? 1 : 0
        case '%': return a[0] % a[1]
        case '?:': return a[0] ? a[1] : a[2]
        default: return NaN
      }
    }
    if (n.type === 'call' && n.name === 'mod') return ev(n.args[0], bar) % ev(n.args[1], bar)
    return NaN
  }
  // ⭐ A translated program names its trees `{v:'tree', tree}`; the product's
  // binding (`objectColumns.js`) turns each into a graph read — done here by hand.
  const bind = (x) => (Array.isArray(x) ? x.map(bind)
    : x && typeof x === 'object'
      ? (x.v === 'tree' && Number.isInteger(x.tree) ? { v: 'graph', node: x.tree }
        : Object.fromEntries(Object.entries(x).map(([k, v]) => [k, bind(v)])))
      : x)
  return evaluateObjects(bind(t.objects), { barCount: bars, readNode: (i, bar) => ev(trees[i], bar), readTime: (i) => i })
}

const DRAW_BOX = [
  'draw_box(bool display, float top, string tf_text) =>',
  '    if display',
  '        box.new(bar_index, top, bar_index + 1, top - 1, text = tf_text)',
]
const SHOWLAST = [
  'showlast(arr, int n) =>',
  '    if array.size(arr) >= n',
  '        b = array.get(arr, 0)',
  '        box.delete(b)',
  '        array.remove(arr, 0)',
]

describe('C33 (1) — a helper\'s drawing pushed onto a list', () => {
  it('⭐ `array.push(list, f(…))` inlines f and pushes what it returned — no refusal', () => {
    const t = host(src(6, ...DRAW_BOX, 'var bs = array.new_box()',
      'array.push(bs, draw_box(true, high, "x"))', ...SHOWLAST, 'showlast(bs, 3)'))
    expect(diag(t).dropReasons['fn:in-expression']).toBeUndefined()
    const r = run(t)
    // showlast(…, 3) keeps two: the list evicts the oldest past two, Pine's own order.
    const boxes = r.live.filter((o) => o.family === 'box')
    expect(boxes.map((b) => b.createdBar)).toEqual([10, 11])
    expect(boxes.every((b) => b.props.text === 'x')).toBe(true)
  })

  it('⭐ the method form `list.push(f(…))` is the same statement', () => {
    const t = host(src(6, ...DRAW_BOX, 'var bs = array.new_box()',
      'bs.push(draw_box(true, high, "x"))', ...SHOWLAST, 'showlast(bs, 3)'))
    expect(diag(t).dropReasons['fn:in-expression']).toBeUndefined()
    expect(run(t).live.filter((o) => o.family === 'box').map((b) => b.createdBar)).toEqual([10, 11])
  })

  it('⭐ a lone `if` that does not run returns `na`: the list takes `na`, and deleting it deletes nothing', () => {
    // display = false → f returns na on every bar; the list fills with na and the
    // eviction deletes na — so no box is ever made, and nothing is lost.
    const t = host(src(6, ...DRAW_BOX, 'var bs = array.new_box()',
      'array.push(bs, draw_box(false, high, "x"))', ...SHOWLAST, 'showlast(bs, 3)',
      'label.new(bar_index, low, "control")'))
    expect(diag(t).dropReasons['fn:in-expression']).toBeUndefined()
    const r = run(t)
    expect(r.live.filter((o) => o.family === 'box')).toEqual([])
    // CONTROL: the program ran (the unconditional label is there).
    expect(r.live.filter((o) => o.family === 'label').length).toBeGreaterThan(0)
  })

  it('⭐ `x := f(…)` with a lone-`if` body: `x` is EMPTIED where the arm did not run — never last bar\'s handle', () => {
    // close = 100 + bar here, so the arm runs on bars 6, 7 and 8 only
    const t = host(src(6, ...DRAW_BOX, 'var box keep = na',
      'keep := draw_box(close > 105 and close < 109, high, "x")',
      'if not na(keep)', '    label.new(bar_index, low, "has")'))
    const r = run(t)
    expect(r.live.filter((o) => o.family === 'label').map((l) => l.createdBar)).toEqual([6, 7, 8])
    expect(r.live.filter((o) => o.family === 'box').map((b) => b.createdBar)).toEqual([6, 7, 8])
  })

  it('⛔ CONTROL: a drawing call anywhere else in an expression is still refused by name', () => {
    const t = host(src(6, ...DRAW_BOX, 'var bs = array.new_box()',
      'array.push(bs, true ? draw_box(true, high, "x") : na)'))
    expect(diag(t).dropReasons['fn:in-expression']).toBe(1)
  })
})

describe('C33 (2) — an `input.timeframe` default in a text', () => {
  const tfLabel = (v, def) => host(src(v, `tf = input.timeframe("${def}", "TF")`,
    'label.new(bar_index, high, "(" + tf + ")")'))
  const textOf = (t) => {
    const c = opsOf(t).find((o) => o.k === 'create')
    return c && c.props.text
  }

  // ⭐ C48 re-pin — the table was `{D: v6, W: v5}`, one corpus capture each. The
  // probes `vw-input-tf-text-v5` / `-v6` (2026-10-01) print EVERY default verbatim
  // under both versions, so the witness is now the version, and the rule the
  // default itself (`vendorHarness.c33ObjectReads` grades it on the two fixtures).
  it('the witness names the capture behind each Pine VERSION', () => {
    expect(Object.keys(INPUT_TIMEFRAME_TEXT_WITNESS)).toEqual(['5', '6'])
    for (const s of ['D', 'W', 'M', '60', '240', '1D', '']) {
      expect(inputTimeframeTextWitnessed(s, 5), s).toBe(true)
      expect(inputTimeframeTextWitnessed(s, 6), s).toBe(true)
      expect(inputTimeframeTextWitnessed(s, 4), s).toBe(false)
    }
    expect(inputTimeframeTextWitnessed('D', null)).toBe(false)
    expect(inputTimeframeTextWitnessed(null, 6)).toBe(false)
  })

  it('⭐ every default prints verbatim, under v5 and v6', () => {
    for (const v of [5, 6]) {
      for (const def of ['D', 'W', 'M', '60', '240', '1D', '']) {
        const t = tfLabel(v, def)
        const r = run(t)
        const labels = r.live.filter((o) => o.family === 'label')
        expect(labels.length, `${def} v${v}`).toBeGreaterThan(0)
        expect(labels.every((l) => l.props.text === `(${def})`), `${def} v${v}`).toBe(true)
        expect(textOf(t).unwitnessed, `${def} v${v}`).toBeUndefined()
        expect(opsOf(t).find((o) => o.k === 'create').propWithhold, `${def} v${v}`).toBeUndefined()
        expect(diag(t).textFormatRefusals, `${def} v${v}`).toBeUndefined()
      }
    }
  })

  it('⛔ a default under a version no capture prints one for is never printed', () => {
    for (const [v, def] of [[4, 'M'], [4, 'D']]) {
      const t = tfLabel(v, def)
      const c = opsOf(t).find((o) => o.k === 'create')
      // the op RUNS (ids stay Pine's) and its text is marked unknown on every bar …
      expect(c, `${def} v${v}`).toBeTruthy()
      expect(c.propWithholdKeys).toEqual(['text'])
      expect(Object.keys(diag(t).textFormatRefusals)).toEqual([`input.timeframe:unwitnessed '${def}' v${v}`])
      // … so a label that survives is held, not drawn.
      const r = run(t)
      expect(r.live.filter((o) => o.family === 'label')).toEqual([])
      expect(r.withheld && r.withheld.label).toBeGreaterThan(0)
    }
  })

  it('⭐ a clean `set_text` later in the bar clears the mark (the C17 rule it rides on)', () => {
    const t = host(src(4, 'tf = input.timeframe("M", "TF")',
      'l = label.new(bar_index, high, tf)', 'label.set_text(l, "ok")'))
    const r = run(t)
    const labels = r.live.filter((o) => o.family === 'label')
    expect(labels.length).toBeGreaterThan(0)
    expect(labels.every((l) => l.props.text === 'ok')).toBe(true)
  })
})

describe('C33 (3) — a text over the validator\'s nesting bound', () => {
  // `res_to_str` — average-day-range-adr-pivots' 17-arm label map.
  const ARMS = ['', '1', '3', '5', '15', '30', '45', '60', '120', '180', '240', '1D', '1W', '1M', '3M', '6M', '12M']
  const resToStr = ['res_to_str(_res) =>',
    ...ARMS.flatMap((a, i) => [`    ${i ? 'else if' : 'if'} _res == '${a}'`, `        '${a}x'`]),
    '    else', '        _res']

  it('⭐ a chain whose every test is decided draws the arm it always takes', () => {
    const t = host(src(6, 'tf = input.timeframe("D", "TF")', ...resToStr,
      'var tb = table.new(position.top_right, 2, 2)',
      'if barstate.islast', '    table.cell(tb, 0, 0, "w (" + res_to_str(tf) + ")")'))
    const cell = opsOf(t).find((o) => o.k === 'cell')
    expect(cell, JSON.stringify(diag(t).dropReasons)).toBeTruthy()
    expect(cell.props.text.node).toEqual({ t: 'cat', args: [{ t: 'cat', args: [{ t: 'lit', s: 'w (' }, { t: 'lit', s: 'D' }] }, { t: 'lit', s: ')' }] })
  })

  it('⛔ a chain that is NOT decided and too deep is refused by name, the rest of the script kept', () => {
    const lab = ['lab(float x) =>',
      ...ARMS.flatMap((a, i) => [`    ${i ? 'else if' : 'if'} x > ${i}`, `        'a${i}'`]), '    else', "        'z'"]
    const t = host(src(6, ...lab, 'plot(close)',
      'var tb = table.new(position.top_right, 2, 2)',
      'if barstate.islast',
      '    table.cell(tb, 0, 0, lab(close))',
      '    table.cell(tb, 1, 0, "kept")'))
    expect(t.ok).toBe(true)
    const cells = opsOf(t).filter((o) => o.k === 'cell')
    expect(cells.map((c) => c.props.text.node)).toEqual([{ t: 'lit', s: 'kept' }])
    expect(diag(t).dropReasons['cell:text']).toBe(1)
    expect(diag(t).textTooDeep || []).toEqual([expect.stringMatching(/^nest>16@/)])
  })
})

describe('C33 (4) — a request timeframe that is a parameter, on the object pass', () => {
  const HEAD = ['tfi = input.timeframe("W", "TF")', 'plot(close)']
  const yTree = (t) => {
    const c = opsOf(t).find((o) => o.k === 'create')
    return c ? JSON.stringify(t.objects.trees[c.props.y.tree]) : null
  }
  it('⭐ `f(string tf) => request.security(…, tf, …)` in a drawing asks for the caller\'s timeframe', () => {
    const viaParam = host(src(6, ...HEAD, 'f(string tf) =>',
      '    request.security(syminfo.tickerid, tf, close, lookahead = barmerge.lookahead_on)',
      'label.new(bar_index, f(tfi), "x")'))
    const direct = host(src(6, ...HEAD,
      'label.new(bar_index, request.security(syminfo.tickerid, tfi, close, lookahead = barmerge.lookahead_on), "x")'))
    expect(yTree(direct)).toBeTruthy()
    expect(yTree(viaParam)).toBe(yTree(direct))
  })

  it('⛔ the PLOT lane is unchanged: a newly served output would mint parameters ahead of saved ones', () => {
    const t = host(src(6, 'tfi = input.timeframe("W", "TF")', 'f(string tf) =>',
      '    request.security(syminfo.tickerid, tf, close, lookahead = barmerge.lookahead_on)', 'plot(f(tfi))'))
    expect(t.outputs[0].refusal && t.outputs[0].refusal.guard).toBe('pine:request')
  })
})

describe('C33 (6) — a getter\'s number in a text, its history, and a helper\'s own getter local', () => {
  const textOf = (t, k = 0) => opsOf(t).filter((o) => o.k === 'create' && o.family === 'label')[k].props.text.node

  // ⭐ C48 re-pin — this read "… and a FINITE number is held" (12 labels withheld):
  // no capture printed one. `vw-getter-history-spy-1d-2026-10-01` does (G01 / G06 /
  // G07 / G08 — `vendorHarness.c48GetterHistory`), so the number is printed.
  it('⭐ `str.tostring(line.get_y1(l))` is carried as the runtime\'s read — and a FINITE number prints (C48)', () => {
    const t = host(src(5, 'var line ln = line.new(0, 7.5, 1, 7.5)',
      'label.new(bar_index, high, "y=" + str.tostring(line.get_y1(ln)))',
      'label.new(bar_index, low, "control")'))
    expect(diag(t).dropReasons['create:label']).toBeUndefined()
    expect(textOf(t)).toEqual({ t: 'cat', args: [{ t: 'lit', s: 'y=' }, { t: 'val', v: { v: 'get', target: { r: 'reg', id: 'r0' }, prop: 'y1' } }] })
    const r = run(t)
    const texts = r.live.filter((o) => o.family === 'label').map((l) => l.props.text)
    expect(texts.filter((x) => x === 'y=7.5')).toHaveLength(12)
    expect(texts.filter((x) => x === 'control')).toHaveLength(12)
    expect(r.withheld).toBeUndefined()
  })

  it('⭐ on an EMPTY handle a getter — and its history — read `na`: "NaN", TradingView\'s own text', () => {
    const t = host(src(5, 'var line ln = na',
      'label.new(bar_index, high, str.tostring(line.get_y1(ln)) + "|" + str.tostring(line.get_y1(ln)[1]))'))
    const r = run(t)
    const labels = r.live.filter((o) => o.family === 'label')
    expect(labels.length).toBeGreaterThan(0)
    expect(labels.every((l) => l.props.text === 'NaN|NaN')).toBe(true)
    expect(r.withheld).toBeUndefined()
  })

  // ⭐ C48 re-pin — this read "… unmeasured, so what stands on it is held" (11 held).
  // `vw-getter-history` H04: one bar back on a live handle is the number the getter
  // answered a bar ago, 299 / 299. TWO bars back stays held (the control below).
  it('⭐ a getter\'s history ONE bar back on a LIVE handle is the number it answered then (C48); two bars back is held', () => {
    // in a GUARD, where no text rule can be what holds it
    const t = host(src(5, 'var line ln = line.new(0, 7.5, 1, 7.5)',
      'if line.get_y1(ln)[1] > 5', '    label.new(bar_index, high, "g")',
      'label.new(bar_index, low, "control")'))
    expect(diag(t).dropReasons['guard:create']).toBeUndefined()
    const r = run(t)
    const texts = r.live.filter((o) => o.family === 'label').map((l) => l.props.text)
    // bar 0 has no previous bar: `na > 5` is a KNOWN false. Every later bar reads 7.5.
    expect(texts.filter((x) => x === 'g')).toHaveLength(11)
    expect(texts.filter((x) => x === 'control')).toHaveLength(12)
    expect(r.stats.withheldUnknown).toBeUndefined()
    // CONTROL — two bars back: a number from there is unmeasured, and held
    const t2 = host(src(5, 'var line ln = line.new(0, 7.5, 1, 7.5)',
      'if line.get_y1(ln)[2] > 5', '    label.new(bar_index, high, "g")',
      'label.new(bar_index, low, "control")'))
    const r2 = run(t2)
    expect(r2.live.filter((o) => o.family === 'label').map((l) => l.props.text)).toEqual(Array(12).fill('control'))
    expect(r2.stats.withheldUnknown).toBe(10)
  })

  it('⭐ a helper\'s own local bound to a getter is a scalar written where it stands', () => {
    const t = host(src(5, 'f(a) =>', '    var line h1 = na', '    b1 = line.get_y1(h1)',
      '    label.new(bar_index, a, "b=" + str.tostring(b1))', 'f(high)'))
    expect(diag(t).dropReasons['create:label']).toBeUndefined()
    expect(diag(t).getterScalars.served.length).toBe(1)
    expect(run(t).live.filter((o) => o.family === 'label').every((l) => l.props.text === 'b=NaN')).toBe(true)
  })

  // ⭐ C48 re-pin — "… is held too": the same capture prints it (`ya`, H02 300 / 300).
  it('⭐ a getter-FED scalar that holds a finite number prints it — the same rule through the scalar (C48)', () => {
    const t = host(src(5, 'f(a) =>', '    var line h1 = line.new(0, 7.5, 1, 7.5)', '    b1 = line.get_y1(h1)',
      '    label.new(bar_index, a, "b=" + str.tostring(b1))', 'f(high)',
      'label.new(bar_index, low, "control")'))
    expect(diag(t).dropReasons['create:label']).toBeUndefined()
    expect(diag(t).getterScalars.served.length).toBe(1)
    const r = run(t)
    const texts = r.live.filter((o) => o.family === 'label').map((l) => l.props.text)
    expect(texts.filter((x) => x === 'b=7.5')).toHaveLength(12)
    expect(texts.filter((x) => x === 'control')).toHaveLength(12)
    expect(r.withheld).toBeUndefined()
  })

  it('⛔ a format the one formatter does not understand whole keeps its refusal', () => {
    // swing-highlow-zigzag: `str.tostring(line_h.get_y1(), "Swing H  (#,###.####)")`
    for (const fmt of ['"Swing H  (#,###.####)"', '"#,###.##"', 'format.mintick']) {
      const t = host(src(5, 'var line ln = line.new(0, 7.5, 1, 7.5)',
        `label.new(bar_index, high, str.tostring(line.get_y1(ln), ${fmt}))`))
      expect(diag(t).dropReasons['create:label'], fmt).toBe(1)
    }
    // CONTROL: a plain pattern is carried, and prints an empty handle's `na`
    const ok = host(src(5, 'var line ln = na',
      'label.new(bar_index, high, str.tostring(line.get_y1(ln), "#.00"))'))
    expect(diag(ok).dropReasons['create:label']).toBeUndefined()
    expect(textOf(ok)).toEqual({ t: 'val', v: { v: 'get', target: { r: 'reg', id: 'r0' }, prop: 'y1' }, fmt: '#.00' })
    const labels = run(ok).live.filter((o) => o.family === 'label')
    expect(labels.length).toBe(12)
    expect(labels.every((l) => l.props.text === 'NaN')).toBe(true)
  })

  it('⛔ CONTROL: a getter inside arithmetic is still refused by name', () => {
    const t = host(src(5, 'var line ln = line.new(0, 7.5, 1, 7.5)',
      'label.new(bar_index, high, str.tostring(line.get_y1(ln) + 1))'))
    expect(diag(t).dropReasons['create:label']).toBe(1)
  })
})

describe('C33 (7) — an `na` arm of a colour choice is no colour', () => {
  it('⭐ `c ? na : colour` under a live condition carries both arms', () => {
    const t = host(src(5, 'label.new(bar_index, high, "x", textcolor = close > open ? na : color.red)'))
    const c = opsOf(t).find((o) => o.k === 'create')
    expect(c.props.textcolor.node.then).toEqual({ c: 'lit', hex: '#00000000' })
    expect(c.props.textcolor.node.else.c).toBe('lit')
  })

  it('⭐ a DECIDED test that takes the `na` arm is no colour — never the renderer\'s default', () => {
    const t = host(src(5, 'off = input.bool(false, "Off")',
      'label.new(bar_index, high, "x", textcolor = off ? color.red : na)'))
    const c = opsOf(t).find((o) => o.k === 'create')
    expect(c.props.textcolor).toEqual({ v: 'color', node: { c: 'lit', hex: '#00000000' } })
  })

  it('⛔ a decided test that takes its COLOUR arm keeps the exact node it always had', () => {
    const t = host(src(5, 'on = input.bool(true, "On")',
      'label.new(bar_index, high, "x", textcolor = on ? color.red : na)'))
    const c = opsOf(t).find((o) => o.k === 'create')
    expect(c.props.textcolor.node.c).toBe('lit')
    expect(c.props.textcolor.node.hex).not.toBe('#00000000')
  })
})

describe('C33 (8) — a guard with a term nothing reads, gated by an input', () => {
  const blockUnder = (gate) => host(src(5, `gate = input.bool(${gate}, "G")`,
    'if gate and dayofweek(time, "GMT+10") == dayofweek.monday',
    '    label.new(bar_index, high, "gated")',
    'label.new(bar_index, low, "control")'))

  it('⭐ the create is CARRIED under an `and` of the read terms and one unknown', () => {
    const t = blockUnder('true')
    expect(diag(t).dropReasons['guard:create']).toBeUndefined()
    // counted, as the refusal was: a step this chart cannot always follow
    expect(diag(t).dropReasons['guard:partial']).toBe(1)
    // ...and the door reads that count as a drawing missing, never as a removal lost
    expect(classifyDropKey('guard:partial').cls).toBe(LOSS.PARTIAL)
    expect(classifyDropKey('guard:some-kind-nobody-classified').cls).toBe(LOSS.REMOVES)
    expect(t.objects.lostCreates).toBeUndefined()
    const latch = opsOf(t).find((o) => o.k === 'latch')
    expect(latch.cond.v).toBe('bool')
    expect(latch.cond.op).toBe('and')
    expect(latch.cond.args[latch.cond.args.length - 1]).toEqual({ v: 'unknown' })
    expect(opsOf(t).find((o) => o.k === 'create' && o.unknownGuard).family).toBe('label')
    expect(diag(t).guardPartial.length).toBe(1)
  })

  it('⭐ a read term that is false ⇒ KNOWN false on that bar: the block did not run, nothing is withheld', () => {
    // the gate is on, and a second READ term is false on every bar here
    const t = host(src(5, 'gate = input.bool(true, "G")',
      'if gate and low > high and dayofweek(time, "GMT+10") == dayofweek.monday',
      '    label.new(bar_index, high, "gated")',
      'label.new(bar_index, low, "control")'))
    const r = run(t, 30)
    expect(r.live.filter((o) => o.family === 'label').map((l) => l.props.text)).toEqual(Array(30).fill('control'))
    expect(r.withheld).toBeUndefined()
    expect(r.stats.withheldUnknown).toBeUndefined()
  })

  it('⛔ every read term true ⇒ UNKNOWN: never drawn, and past the collector\'s trigger the family is withheld whole', () => {
    const t = blockUnder('true')
    // few bars: ours + the creates Pine may have made stay under the trigger
    const few = run(t, 20)
    expect(few.live.filter((o) => o.family === 'label').map((l) => l.props.text)).toEqual(Array(20).fill('control'))
    expect(few.stats.withheldUnknown).toBe(20)
    // many bars: 300 controls + up to 300 creates Pine may have made > 50 + 5
    const many = run(t, 300)
    expect(many.live.filter((o) => o.family === 'label')).toEqual([])
    expect(many.withheld.label).toBeGreaterThan(0)
  })

  it('⛔ a program whose EVERY create stands under such a guard is no program: the door keeps its own sentence', () => {
    const t = host(src(5, 'gate = input.bool(true, "G")',
      'if gate and dayofweek(time, "GMT+10") == dayofweek.monday',
      '    label.new(bar_index, high, "gated")'))
    expect(t.objects).toBeFalsy()
    expect(diag(t).dropReasons['guard:partial']).toBe(1)
  })

  it('⛔ a latch with an unread term that NOTHING surviving reads is not carried', () => {
    // the one step under the guard is refused for a reason of its own (a getter
    // inside arithmetic), so its latch would be evaluated every bar for nobody —
    // and would put a program with no unknown step on the runtime's taint path.
    const t = host(src(5, 'gate = input.bool(true, "G")', 'var line ln = line.new(0, 7.5, 1, 7.5)',
      'if gate and dayofweek(time, "GMT+10") == dayofweek.monday',
      '    label.new(bar_index, high, str.tostring(line.get_y1(ln) + 1))',
      'label.new(bar_index, low, "control")'))
    expect(diag(t).dropReasons['create:label']).toBe(1)
    expect(JSON.stringify(t.objects)).not.toContain('"v":"unknown"')
    expect(opsOf(t).filter((o) => o.k === 'latch')).toEqual([])
    expect(() => assertObjectProgram(t.objects)).not.toThrow()
    // CONTROL: the same guard over a step that survives keeps its latch
    expect(JSON.stringify(blockUnder('true').objects)).toContain('"v":"unknown"')
  })

  it('⛔ once TradingView\'s collector MAY have cut a family, a getter on a live object of it is unknown', () => {
    // one line held in `ln`; 60 creates Pine may have made push the possible line
    // count past the collector's trigger (50 + 5) at bar 54 — from there
    // TradingView may have removed `ln`'s line, where the getter reads `na`.
    const t = host(['//@version=5', 'indicator("t", overlay=true, max_labels_count=500)',
      'gate = input.bool(true, "G")', 'var line ln = line.new(0, 7.5, 1, 7.5)',
      'if gate and dayofweek(time, "GMT+10") == dayofweek.monday',
      '    line.new(bar_index, high, bar_index + 1, high)',
      'if line.get_y1(ln) > 5', '    label.new(bar_index, low, "y")'].join(LF))
    const r = run(t, 60)
    const labels = r.live.filter((o) => o.family === 'label')
    // 54 bars read a known 7.5 (bars 0..53: 1 + 54 possible = 55, not past it) …
    expect(labels.length).toBe(54)
    expect(labels.every((l) => l.props.text === 'y')).toBe(true)
    // … and the six after it are held, never drawn off a line that may be gone.
    expect(r.stats.withheldUnknown).toBe(60 + 6)
    expect(r.live.filter((o) => o.family === 'line')).toEqual([])
  })

  it('⛔ the validator: an unknown operand only under an `and`; a state text never in a cell', () => {
    const base = { programVersion: 1, regs: [{ id: 'r0', family: 'line' }], colls: [], trees: [] }
    const label = (extra) => ({ k: 'create', family: 'label', site: 's1', into: null, when: null,
      props: { x: { v: 'bar' }, y: { v: 'const', value: 1 }, text: { v: 'text', node: { t: 'lit', s: 'a' } } }, ...extra })
    const latch = (cond) => ({ k: 'latch', id: 'l0', cond })
    const ok = { ...base, ops: [latch({ v: 'bool', op: 'and', args: [{ v: 'const', value: 1 }, { v: 'unknown' }] }), label({ when: { v: 'latch', id: 'l0' } })] }
    expect(() => assertObjectProgram(ok)).not.toThrow()
    const bare = { ...base, ops: [label({ when: { v: 'unknown' } })] }
    expect(() => assertObjectProgram(bare)).toThrow(/only under an `and`/)
    const underOr = { ...base, ops: [latch({ v: 'bool', op: 'or', args: [{ v: 'const', value: 1 }, { v: 'unknown' }] }), label({ when: { v: 'latch', id: 'l0' } })] }
    expect(() => assertObjectProgram(underOr)).toThrow(/only under an `and`/)
    const get = { v: 'get', target: { r: 'reg', id: 'r0' }, prop: 'y1' }
    const table = { k: 'create', family: 'table', site: 's2', into: null, when: null, props: { columns: { v: 'const', value: 1 }, rows: { v: 'const', value: 1 } } }
    const cell = { ...base, regs: [...base.regs, { id: 'r1', family: 'table' }], ops: [{ ...table, into: 'r1' },
      { k: 'cell', target: { r: 'reg', id: 'r1' }, col: { v: 'const', value: 0 }, row: { v: 'const', value: 0 }, when: null,
        props: { text: { v: 'text', node: { t: 'val', v: get } } } }] }
    expect(() => assertObjectProgram(cell)).toThrow(/reads object state and is legal only/)
    const tooFar = { ...base, ops: [label({ props: { x: { v: 'bar' }, y: { ...get, back: 9 }, text: { v: 'text', node: { t: 'lit', s: 'a' } } } })] }
    expect(() => assertObjectProgram(tooFar)).toThrow(/history is read 1\.\./)
  })

  it('⛔ CONTROL: with no input gate among the terms the guard keeps its refusal', () => {
    const t = host(src(5, 'if close > open and dayofweek(time, "GMT+10") == dayofweek.monday',
      '    label.new(bar_index, high, "gated")', 'label.new(bar_index, low, "control")'))
    expect(diag(t).dropReasons['guard:create']).toBe(1)
    expect(t.objects.lostCreates).toEqual(['label'])
  })
})

describe('C33 (5) — `last_bar_time`', () => {
  it('⭐ is the newest bar\'s `lastbartime` in milliseconds, for a script that declares a version', () => {
    const t = host(src(6, 'plot(last_bar_time)'))
    expect(t.outputs[0].refusal).toBeFalsy()
    expect(t.outputs[0].ast).toEqual({ type: 'op', name: '*', args: [{ type: 'series', name: 'lastbartime' }, { type: 'num', value: 1000 }] })
  })

  it('⛔ an unversioned source keeps the refusal naming the unit', () => {
    const t = translatePine(['indicator("t")', 'plot(last_bar_time)'].join(LF), { strict: true })
    expect(t.outputs[0].refusal && t.outputs[0].refusal.guard).toBe('pine:builtin')
  })
})
