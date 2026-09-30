// app/src/components/chart/engine/ast/objectFnInline.test.js
//
// ⭐⭐ A USER FUNCTION THAT DRAWS — RAILS FOR THE CALL-SITE INLINER.
//
// See `objectFnInline.js` for the measurement. Every case here drives the real
// `translatePine` (host lane) and reads the object program it produced; the
// end-to-end cases also run `evaluateObjects`, because an op that is emitted and
// then never fires is the failure this wave exists to stop.
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine'
import { evaluateObjects } from '../objectRuntime'
import { guardIsBarInvariant } from './objectFnInline'

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

  it('⛔ `barstate.islast` varies — the TSR `f_clearAll` shape still refuses', () => {
    const t = host(src(...body, 'if barstate.islast', '    f()'))
    expect(diag(t).dropReasons['fn:conditional-history']).toBe(1)
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
