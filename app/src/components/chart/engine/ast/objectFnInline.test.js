// app/src/components/chart/engine/ast/objectFnInline.test.js
//
// ⭐⭐ A USER FUNCTION THAT DRAWS — RAILS FOR THE CALL-SITE INLINER.
//
// See `objectFnInline.js` for the measurement. Every case here drives the real
// `translatePine` (host lane) and reads the object program it produced; the
// end-to-end cases also run `evaluateObjects`, because an op that is emitted and
// then never fires is the failure this wave exists to stop.
import { describe, it, expect } from 'vitest'
import { translatePine, lexPine } from './pine'
import { evaluateObjects } from '../objectRuntime'
import { guardIsBarInvariant, guardIsLastBarOnly, oneExecutionTokens, taCallIn } from './objectFnInline'

const LF = String.fromCharCode(10)
const src = (...lines) => ['//@version=5', 'indicator("t", overlay=true)', ...lines].join(LF)
const host = (s) => translatePine(s, { strict: true })
const opsOf = (t) => (t.objects && t.objects.ops) || []
const creates = (t) => opsOf(t).filter((o) => o.k === 'create')
const diag = (t) => t.objectDiagnostics || {}

/** Run a program over synthetic bars with every tree answering a fixed rule. */
function run(t, bars = 40) {
  const trees = t.objects.trees
  const BARS = Array.from({ length: bars }, (_, i) => ({ c: 100 + i, h: 101 + i, l: 99 + i, o: 100 }))
  // ⭐ Only the shapes these fixtures produce are evaluated here; anything else
  // is NaN, which makes an op that depends on it visibly not fire.
  const ev = (n, bar) => {
    if (!n) return NaN
    if (n.type === 'num') return n.value
    if (n.type === 'series') {
      if (n.name === 'barindex') return bar
      if (n.name === 'high') return BARS[bar].h
      if (n.name === 'low') return BARS[bar].l
      if (n.name === 'close') return BARS[bar].c
      if (n.name === 'open') return BARS[bar].o
      return NaN
    }
    if (n.type === 'op') {
      const a = (n.args || []).map((x) => ev(x, bar))
      switch (n.name) {
        case '+': return a[0] + a[1]
        case '-': return a[0] - a[1]
        case '*': return a[0] * a[1]
        case '/': return a[0] / a[1]
        case '>': return a[0] > a[1] ? 1 : 0
        case '<': return a[0] < a[1] ? 1 : 0
        case '?:': return a[0] ? a[1] : a[2]
        default: return NaN
      }
    }
    return NaN
  }
  return evaluateObjects(t.objects, {
    barCount: bars,
    readNode: (i, bar) => ev(trees[i], bar),
    readTime: (i) => i,
  })
}

describe('⭐⭐ a definition is not code that runs where it is written', () => {
  it('⛔ a function that is NEVER CALLED draws nothing', () => {
    const t = host(src('f() =>', '    label.new(bar_index, high, "x")'))
    expect(creates(t)).toEqual([])
  })

  it('⛔ a CONDITIONAL call carries the call\'s guard onto the create', () => {
    const t = host(src('f() =>', '    label.new(bar_index, high, "x")', 'if close > open', '    f()'))
    const c = creates(t)
    expect(c.length).toBe(1)
    expect(c[0].when, 'the create ran on every bar — the guard of the CALL was lost').not.toBeNull()
    expect(diag(t).inlinedCalls).toBe(1)
  })

  it('⭐ CONTROL — the same body written at the top level draws unconditionally', () => {
    const t = host(src('label.new(bar_index, high, "x")'))
    expect(creates(t).length).toBe(1)
    expect(creates(t)[0].when).toBeNull()
  })
})

describe('⭐⭐ parameters and call sites', () => {
  it('two calls with two arguments are two creates reading two values', () => {
    const t = host(src('f(y) =>', '    label.new(bar_index, y, "x")', 'f(high)', 'f(low)'))
    const c = creates(t)
    expect(c.length).toBe(2)
    expect(c[0].props.y).not.toEqual(c[1].props.y)
    expect(diag(t).droppedOps).toBe(0)
  })

  it('⭐⭐ every call site owns its `var` — the fib-level idiom keeps one line PER call', () => {
    const t = host([
      '//@version=4', 'study("t", overlay=true)',
      'Fib_line(x) =>',
      '    var line ln = na',
      '    line.delete(ln)',
      '    ln := line.new(bar_index - 10, x, bar_index, x)',
      'a = Fib_line(high)',
      'b = Fib_line(low)',
    ].join(LF))
    const intos = creates(t).map((o) => o.into)
    expect(intos.length).toBe(2)
    expect(new Set(intos).size, 'both call sites wrote ONE register').toBe(2)
    const r = run(t)
    expect(r.status).toBe('ok')
    // one live line per call site, not one in total and not one per bar
    expect(r.live.filter((o) => o.family === 'line').length).toBe(2)
  })

  it('⛔ a named-argument KEY is not the parameter, and a NAMESPACE is not either', () => {
    // The body's parameter is called `color` AND it calls `color.new(…)`. The
    // key `color =` must stay a key, the bare `color` must become the argument,
    // and `color.new` must stay the NAMESPACE — rewritten to `myCol.new(…)` it
    // would be a call on a variable, and the colour would be lost.
    const t = host(src(
      'myCol = color.red',
      'lab(txt, x, y, color, size) =>',
      '    label.new(x, y, txt, color = color.new(color, 50), size = size)',
      'lab("a", bar_index, high, myCol, size.small)',
    ))
    expect(diag(t).refusedCalls, JSON.stringify(diag(t).refusedCalls)).toBeUndefined()
    expect(creates(t).length).toBe(1)
    expect(creates(t)[0].props.color, JSON.stringify(diag(t))).toBeTruthy()
  })

  it('⭐ a declared DEFAULT fills a missing argument; an unknown NAMED argument refuses', () => {
    const ok = host(src('f(y, off = 2) =>', '    label.new(bar_index, y + off, "x")', 'f(high)'))
    expect(creates(ok).length).toBe(1)
    expect(diag(ok).droppedOps).toBe(0)
    const bad = host(src('f(y) =>', '    label.new(bar_index, y, "x")', 'f(zz = high)',
      'label.new(bar_index, low, "y")'))
    expect(diag(bad).dropReasons['fn:arity']).toBe(1)
  })
})

describe('⭐⭐ what the inliner REFUSES, and that a refusal is a DROP', () => {
  it('⛔ a conditional call whose body reads history refuses by name', () => {
    const t = host(src('f() =>', '    label.new(bar_index, ta.highest(high, 10), "x")',
      'if close > open', '    f()'))
    expect(creates(t)).toEqual([])
    expect(diag(t).droppedOps).toBeGreaterThan(0)
    expect(diag(t).dropReasons['fn:conditional-history']).toBe(1)
    expect(t.ok).toBe(false)
  })

  it('⭐ CONTROL — the SAME body under an UNCONDITIONAL call inlines', () => {
    const t = host(src('f() =>', '    label.new(bar_index, ta.highest(high, 10), "x")', 'f()'))
    expect(creates(t).length).toBe(1)
    expect(diag(t).droppedOps).toBe(0)
  })

  // ⭐ 2026-09-27: a drawing METHOD is inlined like a function (`recv.m(…)` IS
  // `m(recv, …)`); see `runtime/__tests__/methodDrawings.test.js` for the member
  // door. It still refuses `method` where the body is not decidable from tokens.
  it('⭐ a drawing METHOD on a user-type receiver is INLINED, not refused', () => {
    const t = host([
      '//@version=6', 'indicator("t", overlay=true)',
      'type Z', '    float p',
      'method draw(Z z) =>', '    label.new(bar_index, z.p, "x")',
      'z = Z.new(high)', 'z.draw()', 'label.new(bar_index, low, "y")',
    ].join(LF))
    expect((diag(t).dropReasons || {})['fn:method']).toBeUndefined()
    expect(diag(t).inlinedCalls).toBe(1)
  })

  it('⛔ an OVERLOADED drawing method is refused, and the refusal makes the program dirty', () => {
    const t = host([
      '//@version=6', 'indicator("t", overlay=true)',
      'type Z', '    float p',
      'method draw(Z z) =>', '    label.new(bar_index, z.p, "x")',
      'method draw(float f) =>', '    label.new(bar_index, f, "f")',
      'z = Z.new(high)', 'z.draw()', 'label.new(bar_index, low, "y")',
    ].join(LF))
    expect(diag(t).dropReasons['fn:method']).toBe(1)
    expect(t.ok).toBe(false)
  })

  it('⛔ a drawing function called INSIDE an expression is refused by name', () => {
    const t = host(src('f(y) =>', '    label.new(bar_index, y, "x")', '    1',
      'v = 1 + f(high)', 'label.new(bar_index, low, "y")'))
    expect(diag(t).dropReasons['fn:in-expression']).toBe(1)
  })

  it('⭐ an `if (…)`, a user TYPE constructor and a PURE helper are not history', () => {
    const t = host([
      '//@version=6', 'indicator("t", overlay=true)',
      'type P', '    float v',
      'g(a) => a * 2',
      'f(q) =>',
      '    p = P.new(q)',
      '    if (q > 1)',
      '        label.new(bar_index, g(q), "x")',
      'if close > open',
      '    f(high)',
    ].join(LF))
    expect(diag(t).dropReasons['fn:conditional-history']).toBeUndefined()
    expect(diag(t).inlinedCalls).toBe(1)
  })

  it('⛔ …but a helper that reads history makes the conditional call refuse, and says which', () => {
    const t = host(src(
      'g(a) => ta.sma(a, 5)',
      'f(q) =>',
      '    label.new(bar_index, g(q), "x")',
      'if close > open',
      '    f(high)',
    ))
    expect(diag(t).dropReasons['fn:conditional-history']).toBe(1)
    expect((diag(t).refusedCalls || []).join(' ')).toMatch(/user function `g`/)
  })
})

describe('⭐⭐ a body\'s own locals', () => {
  it('⭐ `x := e` then a read IN THE SAME BLOCK is `e` — the doji idiom', () => {
    const t = host(src(
      'drawH(len) =>',
      '    isDoji = math.abs(open - close) < (high - low) * 0.1',
      '    var int lastIdx = na',
      '    if isDoji',
      '        lastIdx := bar_index',
      '        line.new(x1 = lastIdx, y1 = close, x2 = lastIdx + len, y2 = close)',
      'drawH(25)',
    ))
    expect(diag(t).droppedOps, JSON.stringify(diag(t).dropReasons)).toBe(0)
    expect(creates(t).length).toBe(1)
  })

  it('⛔ a MUTABLE local read OUTSIDE that block refuses — it is never its initialiser', () => {
    // `lvl` is `na` on the first bar and the PREVIOUS bar's high after that
    // (`var` persists). Binding the initialiser would place every label at
    // `na` and call the program clean; the honest answer is a refusal.
    const t = host(src(
      'f() =>',
      '    var float lvl = na',
      '    label.new(bar_index, lvl, "x")',
      '    lvl := high',
      'f()',
    ))
    expect(creates(t)).toEqual([])
    expect(diag(t).droppedOps).toBeGreaterThan(0)
  })

  it('⭐ the function\'s returned HANDLE lands in the caller\'s register', () => {
    const t = host(src(
      'line_(p) =>',
      '    ret = line.new(bar_index, p, bar_index, p)',
      'upd(id, p) =>',
      '    line.set_x2(id, bar_index)',
      '    line.set_y2(id, p)',
      'var line l = na',
      'if barstate.isfirst',
      '    l := line_(high)',
      'upd(l, close)',
    ))
    const copy = opsOf(t).find((o) => o.k === 'setreg' && o.value && o.value.r === 'reg')
    expect(copy, 'no copy of the returned handle').toBeTruthy()
    expect(diag(t).droppedOps).toBe(0)
  })
})

// ⭐⭐ C13 (2026-09-29) — A GUARD THAT CANNOT CHANGE FROM BAR TO BAR.
// `high-low-open-mid-ranges` (NYSE:RDDT 1D) calls its range helpers under
// `if tfbool` / `if i_q` / `if i_t` — three `input.bool`s — and every call was
// refused as conditional-history. A guard built only from inputs and constants
// holds on every bar or on none, so the call's history IS the every-bar history.
describe('⭐⭐ a conditional call under a BAR-INVARIANT guard inlines', () => {
  const body = ['f() =>', '    label.new(bar_index, ta.highest(high, 10), "x")']

  it('⭐ `if <input.bool>` — the call inlines and carries its guard', () => {
    const t = host(src('show = input.bool(true, "Show")', ...body, 'if show', '    f()'))
    expect(diag(t).dropReasons && diag(t).dropReasons['fn:conditional-history']).toBeUndefined()
    expect(diag(t).inlinedCalls).toBe(1)
    expect(creates(t).length).toBe(1)
    expect(creates(t)[0].when, 'the call\'s guard was lost').not.toBeNull()
  })

  it('⭐ a name DERIVED only from inputs and constants is invariant too (`a and not b`, `x == "Right"`)', () => {
    const t = host(src('a = input.bool(true, "A")', 'b = input.bool(false, "B")',
      'ex = input.string("Right", "Extend", options=["Right", "None"])',
      'show = a and not b and ex == "Right"', ...body, 'if show', '    f()'))
    expect(diag(t).dropReasons && diag(t).dropReasons['fn:conditional-history']).toBeUndefined()
    expect(diag(t).inlinedCalls).toBe(1)
  })

  it('⛔ CONTROL — a SERIES guard still refuses (the bars it runs on are not every bar)', () => {
    const t = host(src('show = input.bool(true, "Show")', ...body, 'if show and close > open', '    f()'))
    expect(diag(t).dropReasons['fn:conditional-history']).toBe(1)
  })

  it('⛔ a name derived from a SERIES is not invariant (`up = close > open`)', () => {
    const t = host(src('up = close > open', ...body, 'if up', '    f()'))
    expect(diag(t).dropReasons['fn:conditional-history']).toBe(1)
  })

  it('⛔ an `input.source` is a SERIES, never invariant', () => {
    const t = host(src('s = input.source(close, "Src")', ...body, 'if s > 0', '    f()'))
    expect(diag(t).dropReasons['fn:conditional-history']).toBe(1)
  })

  it('⛔ a name REASSIGNED anywhere is not invariant', () => {
    const t = host(src('show = input.bool(true, "Show")', 'if close > open', '    show := false',
      ...body, 'if show', '    f()'))
    expect(diag(t).dropReasons['fn:conditional-history']).toBe(1)
  })

  it('⛔ a name DECLARED TWICE (a block local of the same spelling) is not invariant', () => {
    const t = host(src('show = input.bool(true, "Show")', 'if close > open', '    show = close > 1',
      '    label.new(bar_index, low, "y")', ...body, 'if show', '    f()'))
    expect(diag(t).dropReasons['fn:conditional-history']).toBe(1)
  })

  // ⭐ C42 — `barstate.islast` still VARIES (the call does not run on every bar),
  // but it runs exactly ONCE, and what `ta.highest(high, 10)` answers on that
  // one run is witnessed (`vendorHarness.c42OneExecution`): its source.
  it('⭐ `barstate.islast` varies, and runs once — `ta.highest(src, len)` inlines as its source', () => {
    const t = host(src(...body, 'if barstate.islast', '    f()'))
    expect(diag(t).dropReasons && diag(t).dropReasons['fn:conditional-history']).toBeUndefined()
    expect(diag(t).inlinedCalls).toBe(1)
    expect(diag(t).oneExecutionCalls).toBe(1)
  })

  it('⛔ CONTROL — under `barstate.islast` a `ta.*` no capture shows on its first run still refuses', () => {
    const t = host(src('f() =>', '    label.new(bar_index, ta.lowest(low, 10), "x")', 'if barstate.islast', '    f()'))
    expect(diag(t).dropReasons['fn:conditional-history']).toBe(1)
    expect(diag(t).oneExecutionCalls).toBeUndefined()
  })

  it('⛔ an EMPTY guard — the unreadable marker the walk leaves — is never invariant', () => {
    expect(guardIsBarInvariant([], new Set(['show']))).toBe(false)
    expect(guardIsBarInvariant(null, new Set(['show']))).toBe(false)
  })

  it('⛔ a counted LOOP still refuses: its body runs several times per bar', () => {
    const t = host(src('show = input.bool(true, "Show")', ...body, 'if show',
      '    for i = 0 to 2', '        f()'))
    expect(diag(t).dropReasons['fn:conditional-history']).toBe(1)
  })
})

// ⭐⭐ C34 (2026-09-30) — WHOSE HISTORY A CONDITIONAL CALL READS, and a call in a
// loop this reader does not run. The vendor witness for the chart-series rule is
// `vendorHarness.c34ChartSeries` (trend-lines, NYSE:RDDT 1D); these rails pin the
// detector's precision and the loop inlining, each beside the control that keeps
// the refusal it exists for.
describe('⭐⭐ C34 — the conditional-history detector reads only the CALL\'s history', () => {
  const underLast = (...body) => host(src('f(int k) =>', ...body, 'if barstate.islast', '    f(5)'))
  const refused = (t) => diag(t).dropReasons && diag(t).dropReasons['fn:conditional-history']

  it('⭐ the chart\'s `low[k]` / `open[k]` / `close[k]` / `high[k]` inline under a guard that varies', () => {
    const t = underLast('    label.new(bar_index, math.min(open[k], close[k]) + low[k] - high[k], "x")')
    expect(refused(t)).toBeUndefined()
    expect(diag(t).inlinedCalls).toBe(1)
  })

  it('⛔ CONTROL — `ta.*` in the same body is the call\'s own state, still refused', () => {
    // ⭐ C42 — `ta.ema`: the one-run answer of `ta.sma` / `ta.highest` is witnessed now
    expect(refused(underLast('    label.new(bar_index, low[k] + ta.ema(close, 3), "x")'))).toBe(1)
    const varies = host(src('f(int k) =>', '    label.new(bar_index, low[k] + ta.sma(close, 3), "x")',
      'if close > open', '    f(5)'))
    expect(refused(varies)).toBe(1)
  })

  it('⭐ `for [i, v] in line.all` is a destructure, not a history read on `for` (TSR `f_clearAll`)', () => {
    const t = underLast('    for [i, v] in line.all', '        line.delete(v)')
    expect(refused(t)).toBeUndefined()
    expect(diag(t).inlinedCalls).toBe(1)
    // ⭐ C40 — and the walk over `line.all` is now a loop the host lane runs, so
    // its delete is no longer blocked (`objectForInLoops.test.js`).
    expect(diag(t).loopBlockedCalls).not.toContain('line.delete')
    // ⛔ …while a `for … in` this lane does not walk (a list of user types) still
    // hands its body the loop's own refusal, named — C34's rule, unchanged.
    const u = host(src('type P', '    line l', 'var ps = array.new<P>()', 'f(int k) =>',
      '    for [i, v] in ps', '        line.delete(v.l)', 'if barstate.islast', '    f(5)'))
    expect(refused(u)).toBeUndefined()
    expect(diag(u).loopBlockedCalls).toContain('line.delete')
  })

  it('⭐ a built-in method on a CHAINED value (`arr.pop().delete()`) reads no history', () => {
    const t = host(src('var ls = array.new_line()', 'f() =>', '    ls.pop().delete()',
      'if close > open', '    f()'))
    expect(refused(t)).toBeUndefined()
  })

  it('⛔ CONTROL — a chained call naming the script\'s own history-reading METHOD still refuses', () => {
    const t = host(src('var ls = array.new_line()', 'method hist(line l) => ta.sma(close, 3)',
      'f() =>', '    x = ls.get(0).hist()', '    ls.pop().delete()', 'if close > open', '    f()'))
    expect(refused(t)).toBe(1)
  })

  it('⭐ a user METHOD whose body reads only the current bar is pure', () => {
    const t = host(src('method twice(float x) => x * 2', 'f() =>',
      '    label.new(bar_index, close.twice(), "x")', 'if close > open', '    f()'))
    expect(refused(t)).toBeUndefined()
  })

  it('⭐ `map.*` / `matrix.*` read the collection this bar holds, as `array.*` does', () => {
    const t = host(src('f() =>', '    m = map.new<string, float>()', '    label.new(bar_index, close, "x")',
      'if close > open', '    f()'))
    expect(refused(t)).toBeUndefined()
  })

  it('⛔ an unwitnessed chart series (`time_close[k]`) is refused BY NAME, with the capture that settles it', () => {
    const t = underLast('    label.new(bar_index, low, str.tostring(time_close[k]))')
    expect(refused(t)).toBe(1)
    expect(diag(t).refusedCalls[0]).toContain('vw-call-site-history')
  })

  // ⭐ C42 — capture `vw-fn-series-history-rddt-1d-2026-09-30`
  it('⭐ `volume[k]` / `time[k]` / `hl2[k]` / `hlc3[k]` / `ohlc4[k]` are witnessed the chart\'s, under any guard', () => {
    const t = host(src('f(int k) =>',
      '    label.new(bar_index, hl2[k] + hlc3[k] + ohlc4[k], str.tostring(volume[k]) + str.tostring(time[k]))',
      'if close > open', '    f(5)'))
    expect(refused(t)).toBeUndefined()
    expect(diag(t).inlinedCalls).toBe(1)
  })

  it('⛔ `bar_index[k]` is witnessed NOT the chart\'s: refused by name under a guard that varies', () => {
    const t = host(src('f(int k) =>', '    label.new(bar_index[k], low, "x")', 'if close > open', '    f(5)'))
    expect(refused(t)).toBe(1)
    expect(diag(t).refusedCalls[0]).toContain('`bar_index[…]`')
    expect(diag(t).refusedCalls[0]).toContain('vw-fn-series-history')
  })
})

describe('⭐⭐ C34 — a call inside a loop this reader does not run is INLINED into it', () => {
  it('⭐ `for … in` over a list: no `fn:loop`, the body\'s ops are blocked with the loop, named', () => {
    const t = host(src('var pts = array.new_float()', 'f(float p) =>',
      '    label.new(bar_index, p, "x")', 'for p in pts', '    f(p)'))
    expect(diag(t).dropReasons && diag(t).dropReasons['fn:loop']).toBeUndefined()
    expect(diag(t).inlinedCalls).toBe(1)
    expect(diag(t).loopBlockedCalls).toContain('label.new')
    // nothing escapes the loop as an every-bar op
    expect(creates(t)).toHaveLength(0)
  })

  it('⭐ a removal the walk cannot name stays LOUD (`object.delete`) — the refused call\'s accounting', () => {
    const t = host(src('var pts = array.new_float()', 'f(line l) =>', '    l.delete()',
      'for p in pts', '    f(na)'))
    expect(diag(t).loopBlockedCalls).toContain('object.delete')
  })

  it('⭐ a `while` the reader walks as opaque: inlined, blocked', () => {
    const t = host(src('f() =>', '    label.new(bar_index, close, "x")', 'i = 0', 'while i < 3',
      '    f()', '    i += 1'))
    expect(diag(t).dropReasons && diag(t).dropReasons['fn:loop']).toBeUndefined()
    expect(diag(t).loopBlockedCalls).toContain('label.new')
    expect(creates(t)).toHaveLength(0)
  })

  it('⛔ a handle RETURNED inside such a loop is not copied onto every bar', () => {
    const t = host(src('var line keep = na', 'var pts = array.new_float()',
      'f(float p) =>', '    ret = line.new(bar_index, p, bar_index + 1, p)',
      'for p in pts', '    keep := f(p)'))
    expect(opsOf(t).filter((o) => o.k === 'copy')).toHaveLength(0)
    expect(diag(t).loopBlockedCalls).toContain('object copy')
  })

  it('⛔ a body reading the call\'s own history in such a loop is refused as conditional-history', () => {
    const t = host(src('var pts = array.new_float()', 'f(float p) =>',
      '    label.new(bar_index, ta.sma(close, 3), "x")', 'for p in pts', '    f(p)'))
    expect(diag(t).dropReasons['fn:conditional-history']).toBe(1)
  })
})

// ⭐⭐ C42 (2026-09-30) — A CALL THAT RUNS EXACTLY ONCE. The vendor witness is
// `vendorHarness.c42OneExecution` (`vw-fn-series-history-rddt-1d-2026-09-30`);
// these rails pin the two readers it is built from, each beside what it must
// leave alone.
describe('⭐⭐ C42 — a guard that is provably `barstate.islast`', () => {
  const g = (text) => guardIsLastBarOnly(lexPine(text).tokens)

  it('⭐ alone, or as a top-level `and` conjunct', () => {
    expect(g('barstate.islast')).toBe(true)
    expect(g('showTable and barstate.islast')).toBe(true)
    expect(g('barstate.islast and close > open and showTable')).toBe(true)
  })

  it('⛔ fails closed: `not`, `or`, a ternary, brackets, another `barstate.*`, nothing', () => {
    expect(g('not barstate.islast')).toBe(false)
    expect(g('barstate.islast or close > open')).toBe(false)
    // `and` binds tighter than `or`: (islast and a) or b runs whenever b holds
    expect(g('barstate.islast and close > open or close < open')).toBe(false)
    expect(g('showTable and not barstate.islast')).toBe(false)
    expect(g('showTable ? barstate.islast : true')).toBe(false)
    expect(g('(barstate.islast)')).toBe(false)
    expect(g('barstate.islastconfirmedhistory')).toBe(false)
    expect(g('barstate.isconfirmed')).toBe(false)
    expect(g('close > open')).toBe(false)
    expect(guardIsLastBarOnly([])).toBe(false)
    expect(guardIsLastBarOnly(null)).toBe(false)
  })
})

describe('⭐⭐ C42 — tokens as they read on ONE execution', () => {
  const H = { isPunct: (tk, v) => !!tk && tk.kind === 'punct' && tk.value === v }
  const toks = (text) => lexPine(text).tokens
  const show = (list) => list.map((tk) => String(tk.value)).join(' ')
  const once = (text, opts) => oneExecutionTokens(toks(text), H, opts)

  it('⭐ `ta.highest(src, len)` → its source; `ta.sma(src, len ≥ 2)` → na; nested calls too', () => {
    expect(show(once('x = ta.highest(high, 10)').toks)).toBe('x = ( high )')
    expect(show(once('x = ta.sma(close, 3) + 1').toks)).toBe('x = na + 1')
    expect(show(once('x = ta.highest(ta.highest(high, 3) - ta.sma(close, 2), n)').toks)).toBe('x = ( ( high ) - na )')
    expect(once('x = ta.highest(high, 10)').why).toBeNull()
    expect(once('x = ta.highest(high, 10)').left).toBeNull()
  })

  it('⛔ a form the capture does not show is named, and left standing', () => {
    expect(once('x = ta.highest(10)').why).toMatch(/only `ta\.highest\(source, length\)` is witnessed/)
    expect(once('x = ta.sma(close, len)').why).toMatch(/whose length is not a whole number above 1/)
    expect(once('x = ta.sma(close, 1)').why).toMatch(/whose length is not a whole number above 1/)
    expect(once('x = ta.highest(source = high, length = 10)').why).toMatch(/only `ta\.highest/)
    const r = once('x = ta.lowest(low, 10) + ta.highest(high, 10)')
    expect(r.why).toBeNull()
    expect(String(r.left.value)).toBe('ta.lowest')
    expect(show(r.toks)).toBe('x = ta.lowest ( low , 10 ) + ( high )')
  })

  it('⭐ `flagRest` marks every `ta.*` call left standing — and nothing else', () => {
    const r = once('x = ta.lowest(low, 10) + ta.highest(high, 10) + math.max(a, b)', { flagRest: true })
    expect(r.toks.filter((tk) => tk.onceUnwitnessed).map((tk) => tk.value)).toEqual(['ta.lowest'])
    expect(once('x = ta.highest(high, 10)', { flagRest: true }).toks.some((tk) => tk.onceUnwitnessed)).toBe(false)
  })

  it('⭐ call-owned history: a literal offset above 0 → na; anything else is named', () => {
    const owned = new Set(['x', 'src', 'bar_index'])
    expect(show(once('y = x[1] + src[2] + bar_index[5] + close[1]', { owned }).toks)).toBe('y = na + na + na + close [ 1 ]')
    expect(once('y = x[0]', { owned }).why).toMatch(/`x\[…\]`.*whole number above 0/)
    expect(once('y = x[n]', { owned }).why).toMatch(/`x\[…\]`/)
    // a parameter bound to a literal is that literal; bound to anything else it is not
    const bind = new Map([['k', toks('5')], ['j', toks('bar_index - 3')]])
    expect(show(once('y = x[k]', { owned, bind }).toks)).toBe('y = na')
    expect(once('y = x[j]', { owned, bind }).why).toMatch(/`x\[…\]`/)
    // `float[] x` is a type, not a read
    expect(show(once('float[] x = array.new_float()', { owned: new Set(['float']) }).toks)).toBe('float [ ] x = array.new_float ( )')
  })

  it('⭐ `taCallIn` finds a `ta.*` CALL, never a name or a member', () => {
    expect(String(taCallIn(toks('x = 1 + ta.rsi(close, 14)')).value)).toBe('ta.rsi')
    expect(taCallIn(toks('x = ta_len + data.ta'))).toBeNull()
    expect(taCallIn(toks('x = math.max(a, b)'))).toBeNull()
  })
})

describe('⭐⭐ C42 — a bare `input(<literal>, …)` is a simple input, and its guard holds on every bar', () => {
  const body = ['f() =>', '    label.new(bar_index, ta.highest(high, 10), "x")']

  it('⭐ `show = input(true, "Show")` / `if show` — the call inlines as an every-bar call', () => {
    for (const dflt of ['true', 'false', '14', '"on"']) {
      const t = host(src(`show = input(${dflt}, "Show")`, ...body, 'if show', '    f()'))
      expect(diag(t).dropReasons && diag(t).dropReasons['fn:conditional-history'], dflt).toBeUndefined()
      expect(diag(t).inlinedCalls, dflt).toBe(1)
      expect(diag(t).oneExecutionCalls, dflt).toBeUndefined()
    }
  })

  it('⛔ CONTROL — the v4 SOURCE form `input(close, …)`, and a default that is an expression, still vary', () => {
    for (const decl of ['s = input(close, "Src")', 's = input(defval = close, title = "Src")', 's = input(2 * 3, "n")']) {
      const t = host(src(decl, ...body, 'if s > 0', '    f()'))
      expect(diag(t).dropReasons['fn:conditional-history'], decl).toBe(1)
    }
  })
})

describe('⭐⭐ C42 — the clock functions keep no history a conditional call could starve', () => {
  const under = (...body) => host(src('f(int k) =>', ...body, 'if close > open', '    f(5)'))
  const refused = (t) => diag(t).dropReasons && diag(t).dropReasons['fn:conditional-history']

  it('⭐ `time(tf, session)`, `time_close(tf)` and the calendar readers inline under a guard that varies', () => {
    const t = under(
      '    inSession = not na(time(timeframe.period, "0930-1600"))',
      '    label.new(bar_index, low, str.tostring(time_close("D")) + str.tostring(dayofweek(time)) + str.tostring(hour(time)))')
    expect(refused(t)).toBeUndefined()
    expect(diag(t).inlinedCalls).toBe(1)
  })

  it('⛔ CONTROL — a `ta.*` over the clock is still the call\'s own state', () => {
    expect(refused(under('    label.new(bar_index, low, str.tostring(ta.change(time("D"))))'))).toBe(1)
    expect(refused(under('    label.new(bar_index, low, str.tostring(fixnan(close)))'))).toBe(1)
  })
})
