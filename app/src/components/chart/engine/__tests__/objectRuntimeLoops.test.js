// app/src/components/chart/engine/__tests__/objectRuntimeLoops.test.js
//
// ─── ⭐⭐ C20 — TEXT, COLOURS AND `while` DRAWINGS READ FROM THE RUNTIME LANE ──────
//
// C18 read a last-bar drawing's NUMBERS from one run of the script, at the
// drawing's own statement. C20 extends the same read, under the same four serving
// conditions (from the listing, inputs at defaults, the run completes, the probe
// runs agree), to:
//   (a) TEXT the run holds — `{t:'str'}`; a NUMBER in a text is still formatted by
//       the object runtime (`{t:'num', fmt}`), never by the run;
//   (b) COLOURS — `color.new(c, t)` as `{c:'new'}` (the object lane's own
//       transparency formula, per bar), any other colour as `{c:'rt'}`, served
//       only OPAQUE;
//   (c) drawings CREATED inside a `while` — the loop becomes a counted loop over
//       the run's own pass count, each body op REACHED and valued per pass.
// Every rule has a case, and each case is paired with the control that shows the
// rule is what decides it.
import { describe, it, expect, vi, afterEach } from 'vitest'

import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../objectColumns'
import { evaluateObjects } from '../objectRuntime'
import { assertObjectProgram, withObjectTransparency } from '../ast/objectProgram'
import { translatePine } from '../ast/pine'
import { probeObjectRuntime } from '../runtime/runtimeColumns'

const N = 12
const BARS = Array.from({ length: N }, (_, i) => ({
  t: `2026-01-${String(i + 2).padStart(2, '0')}`, o: 100 + i, h: 102 + i, l: 99 + i, c: 101 + i, v: 1000,
}))
const LAST = BARS[N - 1].c
const HEAD = '//@version=6\nindicator("t", overlay = true, max_lines_count = 500, max_labels_count = 500)\n'

afterEach(() => { vi.unstubAllEnvs() })

const door = (src) => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  const d = memberPaneDefinition({ source: HEAD + src, id: 'u_c20_rt', name: 'rt' })
  expect(d.ok, d.reason).toBe(true)
  return d
}
const draw = (d, { historyFromListing = true, bars = BARS } = {}) => {
  const reader = objectReaderFor(d.definition, bars, { tf: 'D', newestBarIsForming: false, historyFromListing })
  if (!reader) return { reader: null, live: [], run: null }
  const run = evaluateObjects(reader.program, {
    barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
  })
  return { reader, live: [...run.live].sort((a, b) => a.id - b.id), run }
}
const plain = (src) => translatePine(HEAD + src, { strict: true, objects: true })
const checked = (src) => translatePine(HEAD + src, { strict: true, objects: true, objectRuntimeCheck: probeObjectRuntime })

// A `while` that draws a line AND (on odd passes) a label, per pass.
const LOOP = 'if barstate.islast\n    int i = 0\n    while i < 4\n'
  + '        line.new(bar_index - 5, close + i, bar_index, close + i)\n'
  + '        if i % 2 == 1\n            label.new(bar_index, close - i, str.tostring(i * 1.5, "#.##"))\n'
  + '        i += 1\nplot(close)\n'

describe('⭐⭐ (c) drawings made inside a `while`, pass by pass', () => {
  it('each pass makes its drawings, in Pine\'s creation order, at the values that pass computed', () => {
    const d = door(LOOP)
    expect(() => assertObjectProgram(d.definition.objects)).not.toThrow()
    const { live, reader } = draw(d)
    expect(reader.runtime).toEqual({ served: true, reason: null })
    expect(live.map((o) => (o.family === 'line' ? ['line', o.props.y1] : ['label', o.props.y, o.props.text])))
      .toEqual([
        ['line', LAST], ['line', LAST + 1], ['label', LAST - 1, '1.5'],
        ['line', LAST + 2], ['line', LAST + 3], ['label', LAST - 3, '4.5'],
      ])
  })

  it('⛔ CONTROL — without the member door\'s check the loop is the reader\'s refusal, as before', () => {
    const t = plain(LOOP)
    expect(t.objectDiagnostics.loopBlockedCalls).toEqual(['label.new', 'line.new'])
    expect(t.objects).toBe(null)
  })

  it('a `continue` above a drawing skips it on that pass (the REACHED signal, not the guards)', () => {
    const src = 'if barstate.islast\n    int i = 0\n    while i < 4\n        i += 1\n'
      + '        if i == 2\n            continue\n        label.new(bar_index, i, "x")\nplot(close)\n'
    expect(draw(door(src)).live.map((o) => o.props.y)).toEqual([1, 3, 4])
  })

  it('a loop that is not reached on the last bar draws nothing', () => {
    const src = LOOP.replace('if barstate.islast', 'if barstate.islast and close < 0')
    const { live, reader } = draw(door(src))
    expect(reader.runtime.served).toBe(true)
    expect(live).toEqual([])
  })

  it('⛔ a series that does not start at the listing: every pass withheld (ruling R-W)', () => {
    const { live, reader } = draw(door(LOOP), { historyFromListing: false })
    expect(reader.runtime).toEqual({ served: false, reason: 'runtime:not-from-listing' })
    expect(live).toEqual([])
  })

  it('⛔ more passes than a per-pass buffer holds: the bar is unknown, never read short', () => {
    const src = 'if barstate.islast\n    int i = 0\n    while i < 600\n        label.new(bar_index, i, "x")\n        i += 1\nplot(close)\n'
    const { live, reader } = draw(door(src))
    expect(reader.runtime.served).toBe(true)
    expect(live).toEqual([])
    // ⛔ CONTROL — at the buffer's size it is served whole (pooled to 500 by Pine's collector)
    const ok = draw(door(src.replace('600', '500')))
    expect(ok.live.length).toBe(500)
    expect(ok.live[0].props.y).toBe(0)
  })

  it('⛔ a drawing in a NESTED loop keeps the reader\'s refusal', () => {
    const src = 'if barstate.islast\n    int i = 0\n    while i < 2\n        int j = 0\n        while j < 2\n'
      + '            label.new(bar_index, j, "x")\n            j += 1\n        i += 1\nplot(close)\n'
    const t = checked(src)
    expect(t.objectDiagnostics.loopBlockedCalls).toEqual(['label.new'])
    expect(t.objects).toBe(null)
  })

  it('⛔ a loop that KEEPS a handle (or edits one) keeps the reader\'s refusal — only statement creates are carried', () => {
    const src = 'if barstate.islast\n    int i = 0\n    while i < 2\n        l = label.new(bar_index, i, "x")\n'
      + '        label.set_y(l, 5)\n        i += 1\nplot(close)\n'
    const t = checked(src)
    expect(t.objectDiagnostics.loopBlocked).toBeGreaterThan(0)
    expect(t.objects).toBe(null)
  })

  it('⛔ a loop that runs on EVERY bar keeps the reader\'s refusal', () => {
    const src = 'int i = 0\nwhile i < 2\n    label.new(bar_index, i, "x")\n    i += 1\nplot(close)\n'
    const t = checked(src)
    expect(t.objectDiagnostics.loopBlockedCalls).toEqual(['label.new'])
  })

  it('a value inside the loop is ALWAYS the run\'s, even where the columnar lane has an answer', () => {
    // `ta.sma` inside a loop: Pine evaluates the call every pass; a per-bar column
    // reused for every pass is not what Pine draws
    const t = checked(LOOP)
    const at = t.objects.runtime.at
    expect(at.filter((a) => a.loop).length).toBeGreaterThan(0)
    expect(at.some((a) => a.passes)).toBe(true)
  })
})

describe('⭐ the runtime lane is asked only when it could help, and a script it cannot build costs ONE pass', () => {
  const spy = () => {
    const calls = []
    const check = (s, specs) => { calls.push(specs.length); return probeObjectRuntime(s, specs) }
    return { calls, check }
  }
  it('a script the lane cannot build: one compile check with no values, and the plain pass stands', () => {
    // `request.security` is refused by the check (the object reader has no other bars)
    const src = 'o = request.security(syminfo.tickerid, "W", close)\nplot(o)\n' + LOOP
    const { calls, check } = spy()
    const t = translatePine(HEAD + src, { strict: true, objects: true, objectRuntimeCheck: check })
    expect(calls).toEqual([0])
    expect(t.objectDiagnostics.runtimeRefused).toBeTruthy()
    expect(t.objects).toEqual(plain(src).objects)
  })
  it('a script with nothing the lane could supply is never checked', () => {
    const { calls, check } = spy()
    translatePine(HEAD + 'if barstate.islast\n    label.new(bar_index, close, "x")\nplot(close)\n',
      { strict: true, objects: true, objectRuntimeCheck: check })
    translatePine(HEAD + 'label.new(bar_index, close, str.tostring(close))\nplot(close)\n',
      { strict: true, objects: true, objectRuntimeCheck: check })
    expect(calls).toEqual([])
  })
  it('⛔ CONTROL — a script it can build: checked with no values, then with its values', () => {
    const { calls, check } = spy()
    translatePine(HEAD + LOOP, { strict: true, objects: true, objectRuntimeCheck: check })
    expect(calls[0]).toBe(0)
    expect(calls.length).toBeGreaterThan(1)
    expect(calls[calls.length - 1]).toBeGreaterThan(0)
  })
})

describe('⭐⭐ (a) text only the run holds', () => {
  const NET = 'if barstate.islast\n    int i = 0\n    float net = 0.0\n    while i < 3\n        net -= close[i]\n        i += 1\n'
    + '    bias = net > 0 ? "LONG" : "SHORT"\n'
    + '    label.new(bar_index, close, "NET: " + bias + "\\n" + str.tostring(math.abs(net), "#.#"))\nplot(close)\n'

  it('a word chosen by the run, beside a number the OBJECT runtime formats', () => {
    const d = door(NET)
    const at = d.definition.objects.runtime.at
    expect(at.filter((a) => a.kind === 'text').map((a) => a.node.name)).toEqual(['bias'])
    const sum = BARS.slice(-3).reduce((a, b) => a + b.c, 0)
    expect(draw(d).live.map((o) => o.props.text)).toEqual([`NET: SHORT\n${Number(sum.toFixed(1))}`])
  })

  it('⛔ the number is never formatted by the run: no text value carries a `str.tostring`', () => {
    const at = door(NET).definition.objects.runtime.at
    for (const a of at.filter((x) => x.kind === 'text')) expect(JSON.stringify(a.node)).not.toMatch(/str\.tostring/)
  })

  it('⛔ a script that reads `timeframe.period` asks the run for no text, colour or loop (C15)', () => {
    const src = NET.replace('bias = net > 0', 'tfx = timeframe.period\n    bias = net > 0')
    const at = (checked(src).objects || { runtime: { at: [] } }).runtime
    expect(((at && at.at) || []).filter((a) => a.kind || a.loop)).toEqual([])
    // ⛔ CONTROL — the same script without it does
    expect(checked(NET).objects.runtime.at.some((a) => a.kind === 'text')).toBe(true)
  })
})

describe('⭐⭐ (b) colours the run computes', () => {
  const COL = (color) => 'if barstate.islast\n    int i = 0\n    float net = 0.0\n    while i < 3\n        net -= close[i]\n        i += 1\n'
    + '    c = net > 0 ? color.green : color.red\n'
    + `    label.new(bar_index, close, "x", color = ${color})\nplot(close)\n`

  it('`color.new(c, 70)`: the run\'s opaque colour with TradingView\'s alpha (77, not the run\'s byte 76)', () => {
    // measured on max-pain's NET label: color.new(color.red, 70) is #F236454D
    const { live } = draw(door(COL('color.new(c, 70)')))
    expect(live.map((o) => o.props.color)).toEqual(['#F236454D'])
    expect(withObjectTransparency('#F23645', 70)).toBe('#F236454D')
  })

  it('an opaque colour the run chose is served as the run chose it', () => {
    expect(draw(door(COL('c'))).live.map((o) => o.props.color)).toEqual(['#F23645'])
  })

  it('⛔ a colour the run made TRANSPARENT itself is unknown — its packed alpha does not round-trip', () => {
    const src = COL('d').replace('    c = net', '    d = color.new(net > 0 ? color.green : color.red, 70)\n    c = net')
    const { live, reader } = draw(door(src))
    expect(reader.runtime.served).toBe(true)
    expect(live).toEqual([])
  })

  it('⛔ a transparency this engine has not measured (a fraction) holds the object, never a default colour', () => {
    const src = COL('color.new(c, tr)').replace('    c = net', '    tr = 70.5 + i * 0\n    c = net')
    expect(draw(door(src)).live).toEqual([])
    // ⛔ CONTROL — a whole transparency, computed the same way, is served
    expect(draw(door(src.replace('70.5', '70'))).live.map((o) => o.props.color)).toEqual(['#F236454D'])
  })
})
