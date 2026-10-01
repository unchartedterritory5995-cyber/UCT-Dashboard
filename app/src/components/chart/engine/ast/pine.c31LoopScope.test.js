// app/src/components/chart/engine/ast/pine.c31LoopScope.test.js
//
// ─── C31 — A LOOP INSIDE A BLOCK IS STEPPED OVER, NOT A WALL FOR THE BLOCK ────
//
// The OBJECT lane's block reader now steps over a loop (`ctx.loopStepOver`, the
// block harvest) — `vendorHarness.c31Loops.test.js` rails that against the
// captures. THIS file pins the plot lane: a loop's writes refuse by name wherever
// the loop stands (scalars, both array spellings, a nested `if` of the body),
// and the main walk still refuses the block at its loop, so no plot and no
// parameter address moves.
//
// ⭐ AND THE TEXT FOLD (`unrollTextLoop`): a counted `for` with literal ascending
// bounds whose body only appends to TEXT is folded pass by pass. Descending
// bounds (unwitnessed) and numeric accumulators (ruling R7) are NOT folded.
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'

const HEAD = ['//@version=6', 'indicator("t", overlay=true)', 'plot(close, "real")']
const src = (...lines) => [...HEAD, ...lines].join('\n')
const refusalNames = (t) => (t.refusals || []).map((r) => `${r.guard}|${r.message}`)
const refusesName = (t, name) => refusalNames(t).some((s) => s.includes(`\`${name}\``) || s.includes(`— ${name}`))
const outputOk = (t, title) => (t.outputs || []).some((o) => o.title === title && !o.refusal && o.tree)

describe('C31 — a loop inside a block, on the PLOT lane: its writes refuse', () => {
  it('⛔ a scalar the loop writes refuses when read after it', () => {
    const t = translatePine(src(
      'int n = 0',
      'if close > open',
      '    for i = 0 to 9',
      '        n := n + 1',
      'plot(n, "n")',
    ))
    expect(outputOk(t, 'n')).toBe(false)
    expect(refusesName(t, 'n'), refusalNames(t).join('\n')).toBe(true)
  })

  it('⛔ THE MAIN WALK STILL REFUSES THE BLOCK AT ITS LOOP — the step-over belongs to the object lane', () => {
    // A chain the main walk folded would reach inputs a refused one never did,
    // and a saved script's parameter ids are an address (`paramIds.test.js`).
    const t = translatePine(src(
      'float m = 0.0',
      'if close > open',
      '    for i = 0 to 9',
      '        x = i * 2',
      '    m := high - low',
      'plot(m, "m")',
    ))
    expect(outputOk(t, 'm')).toBe(false)
  })

  it('⛔ an array the loop pushes into (method form) refuses when read after it', () => {
    const t = translatePine(src(
      'var a = array.new<float>(0)',
      'if close > open',
      '    for i = 0 to 3',
      '        a.push(close[i])',
      'plot(array.size(a), "sz")',
    ))
    expect(outputOk(t, 'sz')).toBe(false)
  })

  it('⛔ an array the loop writes (namespace form) refuses when read after it', () => {
    const t = translatePine(src(
      'var a = array.new<float>(4, 0.0)',
      'if close > open',
      '    i = 0',
      '    while i < 4',
      '        array.set(a, i, close)',
      '        i := i + 1',
      'plot(array.get(a, 0), "a0")',
    ))
    expect(outputOk(t, 'a0')).toBe(false)
  })

  it('⛔ a name the loop writes in a NESTED `if` of its body refuses too', () => {
    const t = translatePine(src(
      'float best = 0.0',
      'if close > open',
      '    for i = 0 to 5',
      '        if high[i] > best',
      '            best := high[i]',
      'plot(best, "best")',
    ))
    expect(outputOk(t, 'best')).toBe(false)
    expect(refusesName(t, 'best'), refusalNames(t).join('\n')).toBe(true)
  })
})

describe('C31 — a text loop folds exactly; anything else is stepped over by name', () => {
  // A helper whose text is built by the loop and returned by NAME (the
  // ema-ribbon `f_strengthBar` shape), read by a plot through its length so the
  // plot lane can see whether the text folded.
  const helper = (header, body = '        r += i < 3 ? "#" : "."') => [
    'f_bar(float v) =>',
    '    string r = ""',
    `    ${header}`,
    body,
    '    r',
    'plot(str.length(f_bar(close)), "len")',
  ]

  it('⭐ ascending literal bounds: the helper folds', () => {
    const t = translatePine(src(...helper('for i = 0 to 9')))
    expect(t.notes.filter((n) => /f_bar/.test(n.message || '')).map((n) => n.message)).toEqual([])
    expect(refusesName(t, 'r')).toBe(false)
  })

  it('⛔ descending bounds are NOT folded (no capture witnesses Pine\'s count-down)', () => {
    const t = translatePine(src(...helper('for i = 9 to 0')))
    expect(outputOk(t, 'len')).toBe(false)
  })

  it('⛔ a NUMERIC accumulator is not folded (ruling R7), even with literal bounds', () => {
    const t = translatePine(src(
      'f_sum(float v) =>',
      '    float s = 0.0',
      '    for i = 0 to 2',
      '        s += v',
      '    s',
      'plot(f_sum(close), "sum")',
    ))
    expect(outputOk(t, 'sum')).toBe(false)
  })
})
