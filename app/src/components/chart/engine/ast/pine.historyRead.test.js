// app/src/components/chart/engine/ast/pine.historyRead.test.js
//
// ─── ⭐⭐ C38 — `x[e]` WITH A PER-BAR `e`, IN A PLOT: `barsAgo(x, e, limit)` ─────
//
// The rule is C29's rule 7, measured on TradingView and stated once
// (`interpret.js::historyBackOf` / `historyReadable`); the object lane has read
// it since C29. This file is the columnar lane's half: what the translator writes,
// what it still refuses by name, what the evaluator answers, and what the root
// WITHHOLDS. The vendor's own bars are in `vendorHarness.c38HistoryRead.test.js`.
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'
import { interpret, maxLookback, historyReadMask, historyBackOf, historyReadable, FN } from './interpret.js'
import { TABLE } from './parse.js'
import { DEFAULT_BUDGET } from './budget.js'
import { AUTO_MAX_BARS_BACK, historyReachOf } from './objectProgram.js'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import * as registry from '../nativeRegistry'

const HEAD = '//@version=6\nindicator("t")\n'
const host = (body, head = HEAD) => translatePine(`${head}${body}\n`, { strict: true })
const formula = (body, head) => {
  const t = host(body, head)
  expect(t.ok, JSON.stringify(t.refusal)).toBe(true)
  return t.outputs[t.selected].formula
}
const refusal = (body, head) => {
  const t = host(body, head)
  expect(t.ok, 'expected a refusal').toBe(false)
  return t.refusal
}
const BARS = Array.from({ length: 12 }, (_, i) => ({
  t: `2026-01-${String(i + 1).padStart(2, '0')}`, o: 10 + i, h: 12 + i, l: 9 + i, c: 100 + i, v: 1000 + i,
}))
const num = (value) => ({ type: 'num', value })
const series = (name) => ({ type: 'series', name })
const call = (name, args) => ({ type: 'call', name, args })
const op = (name, args) => ({ type: 'op', name, args })
const NA = op('/', [num(0), num(0)])
const run = (tree, opts) => Array.from(interpret(tree, BARS, {}, undefined, undefined, opts))

describe('C38 — the translator writes ONE read, bounded by ONE buffer', () => {
  it('no `max_bars_back`: the buffer is the measured automatic one — the constant, not a typed 400', () => {
    expect(formula('plot(close[bar_index - 3])'))
      .toMatch(new RegExp(`^barsAgo\\(close, .*, ${AUTO_MAX_BARS_BACK}\\)$`))
    expect(AUTO_MAX_BARS_BACK).toBe(400)
  })

  // ⭐⭐ H11 (CAP5, `vw-cap5-buffer-overrun-spy-1d-2026-10-04`) — a declared buffer
  // is NOT a ceiling: TradingView read `close[59]` under `max_bars_back = 50` with no
  // error. The reach is `historyReachOf(declared)` = max(declared, the measured 400),
  // and both lanes carry the same number.
  it('a declared `max_bars_back` below the automatic reach does not shrink it — both lanes read 400', () => {
    const head = '//@version=6\nindicator("t", max_bars_back = 77)\n'
    expect(formula('plot(close[bar_index - 3])', head)).toMatch(new RegExp(`, ${AUTO_MAX_BARS_BACK}\\)$`))
    const t = host('label.new(bar_index, close[bar_index - 3])', head)
    expect(JSON.stringify(t.objects)).toContain(`"limit":${AUTO_MAX_BARS_BACK},"auto":true`)
    expect(historyReachOf(77)).toBe(AUTO_MAX_BARS_BACK)
  })

  it('…and one above it raises the reach — the same declaration in both lanes', () => {
    const head = '//@version=6\nindicator("t", max_bars_back = 500)\n'
    expect(formula('plot(close[bar_index - 3])', head)).toMatch(/, 500\)$/)
    const t = host('label.new(bar_index, close[bar_index - 3])', head)
    expect(JSON.stringify(t.objects)).toContain('"limit":500,"auto":true')
    expect(historyReachOf(500)).toBe(500)
    expect(historyReachOf(null)).toBe(AUTO_MAX_BARS_BACK)
  })

  it('…and never more than the index can take: `na`, a ternary, `%`, `min`, a bounded `barssince`', () => {
    expect(formula('plot(close[bar_index % 3 == 0 ? na : 1])')).toBe('barsAgo(close, mod(barindex, 3) == 0 ? 0 / 0 : 1, 2)')
    expect(formula('plot(close[bar_index % 7])')).toBe('barsAgo(close, mod(barindex, 7), 7)')
    expect(formula('plot(close[math.min(bar_index, 5)])')).toBe('barsAgo(close, min(barindex, 5), 6)')
    expect(formula('plot(close[close > open ? 2 : bar_index % 9])')).toBe('barsAgo(close, close > open ? 2 : mod(barindex, 9), 9)')
    // the bound is a CEILING on the buffer, never past it
    expect(formula('plot(close[bar_index % 900])')).toBe(`barsAgo(close, mod(barindex, 900), ${AUTO_MAX_BARS_BACK})`)
  })

  it('the source is any column a literal offset takes — an expression, a window', () => {
    expect(formula('plot(ta.sma(close, 5)[bar_index % 4])')).toBe('barsAgo(sma(close, 5), mod(barindex, 4), 4)')
    expect(formula('plot((high - low)[bar_index % 4])')).toBe('barsAgo(high - low, mod(barindex, 4), 4)')
  })

  it('the lookback is still a TREE SUM: the buffer plus what the source needs', () => {
    const t = host('plot(ta.sma(close, 5)[bar_index % 4])')
    expect(maxLookback(t.outputs[t.selected].ast)).toBe(5 + 4)
    expect(TABLE.functions.barsAgo.lookback).toBe('arg2')
  })

  it('a LITERAL offset is untouched — still the `offset` node, one spelling per column', () => {
    expect(formula('plot(close[3])')).toBe('close[3]')
    expect(formula('n = 4\nplot(close[n / 2])')).toBe('close[2]')
  })
})

describe('C38 — what stays refused, by name', () => {
  it('the screener lane: a per-bar index is still `pine:offset-literal`', () => {
    const t = translatePine(`${HEAD}plot(close[bar_index % 3])\n`, {})
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe('pine:offset-literal')
  })

  it('a constant that is not a whole number of bars stays refused; an index over inputs stays a WINDOW', () => {
    expect(refusal('plot(close[1.5])').guard).toBe('pine:offset-literal')
    // an input-only index reads no bar: it is the window fold's, never a per-bar read
    expect(formula('rep = input.bool(false)\nplot(close[rep ? 0 : 1])')).toBe('close[1]')
    // …and at the member door, where an input arrives as an identifier and the
    // fold cannot reduce the ternary, it is still not a per-bar read: refused as before
    const door = translatePine(`${HEAD}rep = input.bool(false)\nplot(close[rep ? 0 : 1])\n`,
      { strict: true, declareInputs: 'all' })
    expect(door.ok).toBe(false)
    expect(door.refusal.guard).toBe('pine:offset-literal')
  })

  it('the SIGN belongs to the index expression: `x[-ta.lowestbars(…)]` reads that many bars back', () => {
    // Pine's `ta.lowestbars` is 0 or negative; this table's `lowestbars` is the
    // count of bars back. `-(-count)` is the count, and the buffer is its window.
    expect(formula('plot(bar_index[-ta.lowestbars(low, 100)])')).toBe('barsAgo(barindex, lowestbars(low, 100), 100)')
    expect(formula('fl = ta.lowestbars(low, 50)\nplot(low[-fl])')).toBe('barsAgo(low, lowestbars(low, 50), 50)')
    // a script that declares 5,000 out of habit still asks for the hundred it can reach
    const head = '//@version=6\nindicator("t", max_bars_back = 5000)\n'
    expect(formula('plot(bar_index[-ta.highestbars(high, 100)])', head)).toBe('barsAgo(barindex, highestbars(high, 100), 100)')
    // CONTROL — without the minus the count is Pine's own (≤ 0): a different tree
    expect(formula('plot(low[ta.lowestbars(low, 50)])')).toBe('barsAgo(low, -lowestbars(low, 50), 1)')
  })

  it('a CONSTANT negative index is the forward reference, and is refused by that name', () => {
    expect(refusal('plot(close[-1])').guard).toBe('pine:offset-negative')
    expect(refusal('n = 3\nplot(close[-n])').guard).toBe('pine:offset-negative')
    expect(refusal('n = input.int(3)\nplot(close[-n])').guard).toBe('pine:offset-negative')
  })

  it('an index that moves only with `barstate.*` — the forming bar is not what was measured', () => {
    const r = refusal('plot(close[barstate.isrealtime ? 1 : 0])')
    expect(r.guard).toBe('pine:offset-literal')
    expect(r.message).toMatch(/barstate\.\*/)
    // CONTROL — the same index over a price column IS served
    expect(formula('plot(close[close > open ? 1 : 0])')).toBe('barsAgo(close, close > open ? 1 : 0, 2)')
  })

  // ⭐ H11 (CAP5, `vw-cap5-max-bars-back-spy-1d-2026-10-04`): `max_bars_back(src, 50)`
  // then `src[e]` read the real bar on all 8,477 bars — the per-series call changes no
  // read, so it is served with the declaration's reach (it refused by name before).
  it('`max_bars_back(x, n)` — served: the per-series call is not a ceiling either (CAP5)', () => {
    expect(formula('max_bars_back(close, 50)\nplot(close[bar_index % 3])')).toBe('barsAgo(close, mod(barindex, 3), 3)')
  })

  it('a source the script reassigns — its history is the end-of-bar value', () => {
    const r = refusal('x = close\nx := x + 1\nplot(x[bar_index % 3])')
    expect(r.guard).toBe('pine:state')
  })

  it('a buffer past the lookback budget is refused by THAT budget at the member door — never served short', () => {
    const src = '//@version=6\nindicator("t", max_bars_back = 5000)\nplot(close[bar_index - 3])\n'
    const t = translatePine(src, { strict: true })
    const ast = t.ok ? t.outputs[t.selected].ast : null
    if (ast) expect(maxLookback(ast)).toBeGreaterThan(DEFAULT_BUDGET.maxLookback)
    const built = memberPaneDefinition({ source: src, id: 'u_member-pane-c38budget', name: 'c38' })
    const installed = built.ok ? registry.installUserDefinitions([built.definition]) : null
    try {
      const refusedBy = !built.ok ? `${built.guard}: ${built.reason}` : (installed.installed.length ? null : installed.errors.join(' | '))
      expect(refusedBy, 'a 5000-bar buffer was served').toBeTruthy()
      expect(refusedBy).toMatch(/lookback/)
    } finally {
      registry.uninstallUserDefinition('u_member-pane-c38budget')
    }
    // CONTROL — the same script inside the budget attaches
    const ok = memberPaneDefinition({ source: src.replace('5000', '500'), id: 'u_member-pane-c38budget', name: 'c38' })
    expect(ok.ok, ok.reason).toBe(true)
  })
})

describe('C38 — the evaluator: the measured rule, bar for bar', () => {
  const closeAt = (i) => 100 + i
  it('`historyBackOf` / `historyReadable` are the rule; the object lane imports the same two', () => {
    expect(historyBackOf(NaN)).toBe(0)
    expect(historyBackOf(3)).toBe(3)
    expect([0, 1, 399].every((k) => historyReadable(k, 400))).toBe(true)
    expect([400, 401, -1, 1.5, Infinity, NaN].some((k) => historyReadable(k, 400))).toBe(false)
  })

  it('an `na` count reads the CURRENT bar; a whole count below the buffer reads that bar', () => {
    const src = Float64Array.from(BARS.map((b) => b.c))
    const back = Float64Array.from([NaN, 1, 0, 3, NaN, 2, 5, 0, 1, 4, NaN, 11])
    const out = Array.from(FN.barsAgo(src, back, 12))
    expect(out[0]).toBe(closeAt(0))                 // na → the bar itself
    expect(out[1]).toBe(closeAt(0))
    expect(out[3]).toBe(closeAt(0))
    expect(out[6]).toBe(closeAt(1))
    expect(out[10]).toBe(closeAt(10))               // na → the bar itself
    expect(out[11]).toBe(closeAt(0))                // 11 back, the buffer's last readable count
  })

  it('a count the rule cannot read — at the buffer, negative, fractional — is not computable', () => {
    const src = Float64Array.from(BARS.map((b) => b.c))
    const back = Float64Array.from([0, 0, 0, 3, -1, 1.5, 2, 0, 0, 0, 0, 0])
    const out = Array.from(FN.barsAgo(src, back, 3))
    expect(Number.isNaN(out[3]) && Number.isNaN(out[4]) && Number.isNaN(out[5])).toBe(true)
    expect(out[6]).toBe(closeAt(4))                 // 2 < 3: readable
  })
})

describe('C38 — the root is WITHHELD, never answered off a `NaN`', () => {
  // count = bar index mod 4, buffer 3: bars 3, 7, 11 are AT the buffer
  const read = call('barsAgo', [series('close'), call('mod', [series('barindex'), num(4)]), num(3)])
  const isNa = op('?:', [call('na', [read]), num(1), num(0)])

  it('`na(x[e]) ? 1 : 0` is withheld on an unreadable bar — not a confident 1', () => {
    const out = run(isNa)
    for (const i of [3, 7, 11]) expect(Number.isNaN(out[i]), `bar ${i}`).toBe(true)
    for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) expect(out[i], `bar ${i}`).toBe(0)
    expect(Array.from(historyReadMask(isNa, BARS, {}))).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1])
  })

  it('…and so is every root bar within reach of one: a 2-bar window over the read', () => {
    const tree = op('?:', [call('na', [call('sma', [read, num(2)])]), num(1), num(0)])
    // reach = maxLookback(root) − maxLookback(read) = 2: bar j, j+1, j+2
    expect(Array.from(historyReadMask(tree, BARS, {}))).toEqual([0, 0, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1])
  })

  it('a read under an unbounded memory (`cum`) withholds everything from the first unreadable bar on', () => {
    const tree = call('cum', [read])
    expect(Array.from(historyReadMask(tree, BARS, {}))).toEqual([0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1])
  })

  it('a read BEFORE the first bar held: withheld — unless the series starts at the listing, where it is Pine\'s `na`', () => {
    // count 2 on every bar: bars 0 and 1 read a bar this window does not hold
    const early = op('?:', [call('na', [call('barsAgo', [series('close'), op('+', [num(2), op('*', [series('close'), num(0)])]), num(3)])]), num(1), num(0)])
    const windowed = run(early)
    expect(Number.isNaN(windowed[0]) && Number.isNaN(windowed[1])).toBe(true)
    expect(windowed.slice(2).every((v) => v === 0)).toBe(true)
    const listed = run(early, { historyFromListing: true })
    expect(listed.slice(0, 2)).toEqual([1, 1])       // Pine's own answer on its first two bars
    expect(listed.slice(2).every((v) => v === 0)).toBe(true)
  })

  it('a tree with no per-bar read, or one whose every count is readable, has no mask (no column moves)', () => {
    expect(historyReadMask(call('sma', [series('close'), num(3)]), BARS, {})).toBe(null)
    const fine = call('barsAgo', [series('close'), NA, num(3)])     // every count `na`: the bar itself
    expect(historyReadMask(fine, BARS, {})).toBe(null)
    expect(run(fine)).toEqual(BARS.map((b) => b.c))
  })

  it('a read under `tf` reads other bars: the whole tree is withheld', () => {
    const tree = { type: 'tf', value: 'W', args: [read] }
    expect(Array.from(historyReadMask(tree, BARS, {})).every((v) => v === 1)).toBe(true)
  })
})
