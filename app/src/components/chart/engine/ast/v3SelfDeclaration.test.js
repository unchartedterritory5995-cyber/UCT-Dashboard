// ─── ⭐⭐ ENGINE 49 (2026-11-11) — A v3+ DECLARATION THAT READS ITS OWN HISTORY REFUSES BY NAME ─────
//
// Pine v3 removed self-reference in a declaration: a variable must be declared before it is
// referenced, so `s = nz(s[1]) + close` does not compile in v3+ (it is written `s = 0.0` then
// `s := nz(s[1]) + close`). Engine 48 refused one such spelling (`x = na(x[k]) ? na : U`) in
// every version; every other one was still drawn in v3+ (review ENG48-1096 note 4): a stated
// seed, `na(nz(x[1]))`, `na(x[1] + 0)`, `x = f(x[1])`. Since engine 49 each of them refuses
// `pine:cycle` with the one v3+ sentence (`pine.js::selfReferenceSentence`), in both lanes, for
// every spelling below (each one a binding the plot's value reads). Engine 49 left shapes refused by
// the runtime lane only (an unread declaration, one read only through `color=`, a name an earlier user
// function holds) and a block-valued one no door refused; since engine 50 all four doors refuse those
// too (the "engine 50" blocks at the end, review ENG49-1122 notes 1-3 and 6):
//   - the host lane marks the declaration (`markSelfDeclaration`, asking
//     `selfReferencingDeclaration` of the env the declaration was written in) and the
//     `Resolver` refuses a marked binding before resolving it;
//   - the runtime lane asks the same detector of its own scope chain and env before the
//     env/slot decision (`pineRuntimeFrontend.js`, the ordinary-binding arm).
// v1/v2 and no pragma compile these spellings and keep their paths exactly (engine 48's
// `na`-seeded refusal included). Census: no v3+ script in `corpus/`, the repo's `.pine` fixtures
// and vendor captures, or the licence-held sample spells one (EVIDENCE.md, engine 49).

import { describe, it, expect } from 'vitest'
import { translatePine, REFUSALS, selfReferenceSentence, selfReferencingDeclaration, parseWholeExpression, lexPine, PINE_BUILTIN_VARIABLE_NAMES,
  blockStatements, blockDeclarationReadsOwnHistory, declaredAsVariable } from './pine.js'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'

const N = 60
const BARS = Array.from({ length: N }, (_, i) => {
  const c = 100 + 5 * Math.sin(i / 5) + i / 10
  return { t: 1700000000 + i * 86400, o: c, h: c + 1, l: c - 1, c, v: 1000 + i }
})
/** A script with a pragma `v`, or none at all when `v` is null (read as v1). */
const pineAt = (v, lines) => [
  ...(v === null ? ['study("e49")'] : [`//@version=${v}`, v >= 5 ? 'indicator("e49")' : 'study("e49")']),
  ...lines,
].join('\n')
const sma = (v) => (v !== null && v >= 5 ? 'ta.sma' : 'sma')

const hostRefusal = (src, opts) => {
  const t = translatePine(src, opts)
  if (t.ok) return null
  return t.refusal || ((t.outputs || []).find((o) => o && o.refusal) || {}).refusal || { guard: '?' }
}
const runtimeRefusal = (src) => {
  const built = buildRuntimeIr(src, { bars: BARS, inputs: {}, pane: true, historyFromListing: true })
  return built.ok ? null : built.refusal
}
const door = (src) => memberPaneDefinition({ source: src, id: 'u_eng49', name: 'eng49' })
/** guard per door, in the order screen / pane (strict) / runtime / member door */
const guards = (src) => {
  const d = door(src)
  return [hostRefusal(src), hostRefusal(src, { strict: true }), runtimeRefusal(src)]
    .map((r) => (r ? r.guard : 'OK')).concat(d.ok ? 'OK' : d.guard)
}

// Each spelling the review named, and the shapes beside them. `x` is never declared before.
const SPELLINGS = {
  statedSeed: () => ['x = na(x[1]) ? 7.0 : x[1] + 1', 'plot(x)'],
  nzTest: () => ['x = na(nz(x[1])) ? na : x[1] + 1', 'plot(x)'],
  plusZero: () => ['x = na(x[1] + 0) ? na : x[1] + 1', 'plot(x)'],
  nzSum: () => ['x = nz(x[1]) + close', 'plot(x)'],
  holdMax: () => ['x = close > nz(x[1]) ? close : nz(x[1])', 'plot(x)'],
  // engine 48's spelling: v3+ now meets this check first, with the same sentence
  naSeeded: () => ['x = na(x[1]) ? na : x[1] + 1', 'plot(x)'],
  // review ENG48 N2: a warm-up update met the runtime lane's `runtime:conditional-history` first
  warmupSeed: (v) => [`x = na(x[1]) ? 0.0 : x[1] * 0.9 + ${sma(v)}(close, 5) * 0.1`, 'plot(x)'],
  warmupNa: (v) => [`x = na(x[1]) ? na : x[1] * 0.9 + ${sma(v)}(close, 5) * 0.1`, 'plot(x)'],
  // a function local (the runtime lane makes it a slot) and a later `:=` of the same name
  fnLocal: () => ['f(s) =>', '    x = nz(x[1]) + s', '    x', 'plot(f(close))'],
  fnSeed: () => ['f(s) =>', '    x = na(x[1]) ? s : x[1] + s', '    x', 'plot(f(close))'],
  reassigned: () => ['x = nz(x[1]) + 1', 'x := x * 2', 'plot(x)'],
}

// The path each control had before engine 49, per door (screen / pane / runtime / door), in every
// pragma: none, 2, 3, 4, 5, 6 alike. Measured on the engine-48 head (8f775b6ce4) and unchanged.
const CONTROLS = {
  // the v3+ form of the same idea: declared once, updated with `:=`
  mutable: [['x = 0.0', 'x := nz(x[1]) + 1', 'plot(x)'], ['pine:state', 'pine:state', 'OK', 'pine:state']],
  mutableNa: [['float x = na', 'x := na(x[1]) ? 7.0 : x[1] + 1', 'plot(x)'], ['pine:state', 'OK', 'OK', 'OK']],
  var: [['var float x = 0.0', 'x := nz(x[1]) + 1', 'plot(x)'], ['pine:state', 'pine:state', 'OK', 'pine:state']],
  // a different variable's history
  otherVar: [['y = close', 'x = nz(y[1]) + 1', 'plot(x)'], ['OK', 'OK', 'OK', 'OK']],
  // a local that shadows a global: its `x[1]` may be the global's, so it is not asked
  shadowFn: [['x = close', 'f(s) =>', '    x = nz(x[1]) + s', '    x', 'plot(f(close))'], ['pine:state', 'pine:state', 'OK', 'pine:state']],
  // an earlier declaration of the same name in the same scope
  sameScope: [['x = close', 'x = nz(x[1]) + 1', 'plot(x)'], ['pine:state', 'OK', 'OK', 'OK']],
  // a function parameter of the same name, and one read through history by another local
  param: [['f(x) =>', '    x = nz(x[1]) + 1', '    x', 'plot(f(close))'], ['pine:state', 'OK', 'OK', 'OK']],
  paramRead: [['f(x) =>', '    y = nz(x[1]) + 1', '    y', 'plot(f(close))'], ['OK', 'OK', 'OK', 'OK']],
  // a tuple declaration
  tuple: [['f(s) => [s, s * 2]', '[a, b] = f(nz(a[1]) + close)', 'plot(b)'], ['pine:tuple', 'pine:tuple', 'pine:undefined', 'pine:tuple']],
  // a bare self read (no history): `pine:undefined`, TradingView's own error for it
  bare: [['x = x + 1', 'plot(x)'], ['pine:undefined', 'pine:undefined', 'pine:undefined', 'pine:undefined']],
  // a declaration named after a built-in variable: its `hl2[1]` may be Pine's own
  builtinName: [['hl2 = nz(hl2[1]) + 1', 'plot(hl2)'], ['pine:state', 'OK', 'OK', 'OK']],
  // a global the runtime lane makes a SLOT (a `var`), shadowed by a function local (the runtime
  // lane reads it through `guardOuter`) and redeclared at the top level
  shadowSlot: [['var float x = 0.0', 'x := close', 'f(s) =>', '    x = nz(x[1]) + s', '    x', 'plot(f(close))'], ['OK', 'OK', 'OK', 'OK']],
  shadowSlotTop: [['var float x = 0.0', 'x := close', 'x = nz(x[1]) + 1', 'plot(x)'], ['pine:state', 'pine:state', 'OK', 'pine:state']],
  // a parameter redeclared in a body whose function the runtime lane lowers with slots
  paramMut: [['f(x) =>', '    y = 0.0', '    y := x', '    x = nz(x[1]) + y', '    x', 'plot(f(close))'], ['pine:state', 'pine:state', 'OK', 'pine:state']],
  // a block local shadowing a global, and a loop counter redeclared in the loop body
  blockShadow: [['x = close', 'y = if close > 100', '    x = nz(x[1]) + 1', '    x', 'else', '    0.0', 'plot(y)'], ['pine:state', 'OK', 'runtime:conditional-history', 'OK']],
  loopShadow: [['f(s) =>', '    t = 0.0', '    for i = 0 to 2', '        i = nz(i[1]) + s', '        t := t + i', '    t', 'plot(f(close))'], ['pine:block', 'pine:block', 'runtime:conditional-history', 'pine:block']],
}

const V3 = [3, 4, 5, 6]
const V12 = [null, 2]

describe('⭐⭐ engine 49 — v3+: a declaration that reads its own history refuses `pine:cycle`, ONE sentence, every door', () => {
  const cases = []
  for (const [shape, lines] of Object.entries(SPELLINGS)) for (const v of V3) cases.push([shape, v, lines])
  it.each(cases)('%s, v%i: screen, pane (strict), buildRuntimeIr and the member door', (shape, v, lines) => {
    const src = pineAt(v, lines(v))
    const sentence = `${REFUSALS['pine:cycle']} — ${selfReferenceSentence('x', v)}`
    for (const r of [hostRefusal(src), hostRefusal(src, { strict: true }), runtimeRefusal(src)]) {
      expect(r && r.guard).toBe('pine:cycle')
      expect(r.message).toBe(sentence)
    }
    const d = door(src)
    expect(d.ok).toBe(false)
    expect(d.guard).toBe('pine:cycle')
  })

  it('the v3+ sentence is the one engine 48 pinned, true of every spelling above (it names none)', () => {
    for (const v of V3) {
      expect(selfReferenceSentence('x', v)).toBe('`x` reads its own history inside its own declaration. '
        + 'This does not compile in Pine v3+: a variable cannot refer to itself in its own declaration, so '
        + 'TradingView draws nothing for this script and nothing is drawn here. In v3+ the variable is '
        + 'declared once and updated with `:=`')
    }
  })
})

describe('⭐⭐ engine 49 — v1/v2 and no pragma compile these spellings: their paths are unchanged', () => {
  // Measured on the engine-48 head (8f775b6ce4), screen / pane / runtime / door. Every v1/v2 row
  // below was the same there; only engine 48's `na`-seeded spellings refuse, by its own sentence.
  const BEFORE = {
    statedSeed: ['pine:state', 'OK', 'OK', 'OK'],
    nzTest: ['pine:state', 'OK', 'OK', 'OK'],
    plusZero: ['pine:state', 'OK', 'OK', 'OK'],
    nzSum: ['pine:state', 'pine:state', 'OK', 'pine:state'],
    holdMax: ['OK', 'OK', 'OK', 'OK'],
    naSeeded: ['pine:cycle', 'pine:cycle', 'pine:cycle', 'pine:cycle'],
    warmupSeed: ['OK', 'OK', 'runtime:conditional-history', 'OK'],
    warmupNa: ['pine:cycle', 'pine:cycle', 'pine:cycle', 'pine:cycle'],
    fnLocal: ['pine:state', 'pine:state', 'OK', 'pine:state'],
    fnSeed: ['pine:state', 'pine:state', 'OK', 'pine:state'],
    reassigned: ['OK', 'OK', 'OK', 'OK'],
  }
  const cases = []
  for (const [shape, lines] of Object.entries(SPELLINGS)) for (const v of V12) cases.push([shape, v === null ? 'none' : `v${v}`, v, lines])
  it.each(cases)('%s, pragma %s keeps its path', (shape, _label, v, lines) => {
    const src = pineAt(v, lines(v))
    expect(guards(src)).toEqual(BEFORE[shape])
    // and no door says the v3+ sentence
    for (const r of [hostRefusal(src), hostRefusal(src, { strict: true }), runtimeRefusal(src)]) {
      if (r && r.message) expect(r.message).not.toContain('does not compile in Pine v3+')
    }
  })
})

describe('⭐⭐ engine 49 — controls keep their path in every pragma (the check never fires for them)', () => {
  const cases = []
  for (const [shape, [lines, want]] of Object.entries(CONTROLS)) {
    for (const v of [...V12, ...V3]) cases.push([shape, v === null ? 'none' : `v${v}`, v, lines, want])
  }
  it.each(cases)('%s, pragma %s', (shape, _label, v, lines, want) => {
    expect(guards(pineAt(v, lines))).toEqual(want)
  })
})

describe('⭐ engine 49 review note 2 — EVERY name in the built-in exclusion set keeps its engine-48 path in v5', () => {
  // The set is IMPORTED from `pine.js`, never copied here, so a name removed from it (review
  // mutant X4: `vwap`) drops out of the exclusion and this rail sees its declaration refuse.
  // "Engine-48 path": engine 49 is version-gated and leaves v2 alone (the v1/v2 rails above), and
  // for every one of these names the engine-48 v5 path equalled its v2 path at all four doors
  // (measured on 8f775b6ce4, EVIDENCE.md). So v5 must equal v2 here, and no door may say `pine:cycle`.
  // ⛔ Iterating the set cannot see a name REMOVED from it (its row just disappears), so this is a
  // FLOOR: the built-in variables a script can read bare, every one of which must stay excluded.
  // The set may grow (it also takes `TABLE.series` and `TABLE.clock`); it may not lose one of these.
  const FLOOR = ['open', 'high', 'low', 'close', 'volume', 'hl2', 'hlc3', 'ohlc4', 'hlcc4', 'time',
    'time_close', 'time_tradingday', 'timenow', 'bar_index', 'last_bar_index', 'tr', 'vwap', 'obv',
    'accdist', 'iii', 'nvi', 'pvi', 'pvt', 'wad', 'wvad', 'na']
  it('the set is non-empty and holds every name of the floor', () => {
    expect(PINE_BUILTIN_VARIABLE_NAMES.size).toBeGreaterThanOrEqual(FLOOR.length)
    for (const n of FLOOR) expect(PINE_BUILTIN_VARIABLE_NAMES.has(n), n).toBe(true)
  })
  const rhs = (text) => parseWholeExpression(lexPine(text).tokens)
  it.each([...PINE_BUILTIN_VARIABLE_NAMES].map((n) => [n]))('`%s = nz(%s[1]) + 1`: not asked; v5 equals v2 at all four doors, none `pine:cycle`', (n) => {
    expect(selfReferencingDeclaration(rhs(`nz(${n}[1]) + 1`), n, false)).toBe(false)
    const lines = [`${n} = nz(${n}[1]) + 1`, `plot(${n})`]
    const v5 = guards(pineAt(5, lines))
    expect(v5).not.toContain('pine:cycle')
    expect(v5).toEqual(guards(pineAt(2, lines)))
  })
})

describe('the detector, asked directly', () => {
  const rhs = (text) => parseWholeExpression(lexPine(text).tokens)
  it('a history read of its own name, not declared before: yes; declared before, a bare read, another name, a built-in: no', () => {
    expect(selfReferencingDeclaration(rhs('nz(x[1]) + close'), 'x', false)).toBe(true)
    expect(selfReferencingDeclaration(rhs('na(x[2]) ? 7 : x[2]'), 'x', false)).toBe(true)
    expect(selfReferencingDeclaration(rhs('nz(x[1]) + close'), 'x', true)).toBe(false)
    expect(selfReferencingDeclaration(rhs('x + 1'), 'x', false)).toBe(false)
    expect(selfReferencingDeclaration(rhs('nz(y[1]) + 1'), 'x', false)).toBe(false)
    expect(selfReferencingDeclaration(rhs('nz(close[1]) + 1'), 'close', false)).toBe(false)
  })
})

// ─── ⭐⭐ ENGINE 50 — THE FOUR DOORS AGREE (review ENG49-1122 notes 1, 2, 3 and 6) ─────────────
// Engine 49's host lane refused a marked declaration only where its `Resolver` resolved the binding,
// while the runtime lane asked at the statement, so in these v3+ shapes only the runtime lane refused
// (notes 1-3), or no door did (note 6, block-valued). Since engine 50 the host walk records every v3+
// self-referencing declaration where it is written (`ctx.selfDeclarations`) and refuses the whole
// script by the first one after the walk, "declared before" counts a VARIABLE only
// (`declaredAsVariable`: Pine keeps functions in their own namespace), a block-valued declaration is
// asked by `blockDeclarationReadsOwnHistory` in both lanes, and the runtime lane no longer defers the
// refusal of an UNCALLED function's body to a call. TradingView compiles none of these scripts.
const col = (v, c) => (v !== null && v >= 4 ? `color.${c}` : c)
const ta = (v, f) => (v !== null && v >= 5 ? `ta.${f}` : f)
const DOORS_AGREE = {
  // note 1: read only through an argument
  colorArg: (v) => [`c = close > open ? ${col(v, 'green')} : nz(c[1], ${col(v, 'red')})`, 'plot(close, color=c)'],
  colorArgTyped: (v) => [`color c = close > open ? ${col(v, 'green')} : nz(c[1], ${col(v, 'red')})`, 'plot(close, color=c)'],
  // note 2: a marked declaration nothing reads (top level, a function body, an `if` statement), and
  // one in a function nothing calls
  unreadTop: () => ['x = nz(x[1]) + 1', 'plot(close)'],
  unreadFn: () => ['f(s) =>', '    x = nz(x[1]) + s', '    s', 'plot(f(close))'],
  unreadIfStmt: () => ['if close > open', '    x = nz(x[1]) + 1', 'plot(close)'],
  uncalledFn: () => ['f(s) =>', '    x = nz(x[1]) + s', '    x', 'plot(close)'],
  // note 3: a variable named after an earlier user function (one-line and block bodies), read or not
  fnName: () => ['x(a) => a * 2', 'x = nz(x[1]) + 1', 'plot(x)'],
  fnNameBlockFn: () => ['x(a) =>', '    a * 2', 'x = nz(x[1]) + 1', 'plot(x)'],
  fnNameUnread: () => ['x(a) => a * 2', 'x = nz(x[1]) + 1', 'plot(close)'],
  fnNameCalled: () => ['x(a) => a * 2', 'y = x(close)', 'x = nz(x[1]) + y', 'plot(x)'],
  // note 6: a block-valued declaration whose block reads its own history
  blockIf: () => ['x = if close > open', '    nz(x[1]) + 1', 'else', '    0.0', 'plot(x)'],
  blockIfTyped: () => ['float x = if close > open', '    nz(x[1]) + 1', 'else', '    0.0', 'plot(x)'],
  blockIfElseArm: () => ['x = if close > open', '    1.0', 'else', '    nz(x[1])', 'plot(x)'],
  blockIfNested: () => ['x = if close > open', '    if close > 100', '        nz(x[2]) + 1', '    else', '        0.0', 'else', '    0.0', 'plot(x)'],
  blockIfFn: () => ['f(s) =>', '    x = if s > 100', '        nz(x[1]) + 1', '    else', '        0.0', '    x', 'plot(f(close))'],
  blockIfUnread: () => ['x = if close > open', '    nz(x[1]) + 1', 'else', '    0.0', 'plot(close)'],
}
// `switch` is Pine v5+
const DOORS_AGREE_V5 = {
  blockSwitch: () => ['x = switch', '    close > open => nz(x[1]) + 1', '    => 0.0', 'plot(x)'],
  blockSwitchSubj: () => ['m = "a"', 'x = switch m', '    "a" => nz(x[1]) + 1', '    => 0.0', 'plot(x)'],
  blockSwitchFn: () => ['f(s) =>', '    x = switch', '        s > 100 => nz(x[1]) + 1', '        => 0.0', '    x', 'plot(f(close))'],
}
// v1/v2 and no pragma compile these: each door's guard, measured on the engine-49 head (22836e479c),
// none and v2 alike, and unchanged at engine 50 (EVIDENCE.md, engine 50)
const DOORS_AGREE_V12 = {
  colorArg: ['OK', 'OK', 'OK', 'OK'],
  colorArgTyped: ['OK', 'OK', 'OK', 'OK'],
  unreadTop: ['OK', 'OK', 'OK', 'OK'],
  unreadFn: ['OK', 'OK', 'OK', 'OK'],
  unreadIfStmt: ['OK', 'OK', 'OK', 'OK'],
  uncalledFn: ['OK', 'OK', 'runtime:statement', 'OK'],
  fnName: ['pine:state', 'OK', 'OK', 'OK'],
  fnNameBlockFn: ['pine:state', 'OK', 'OK', 'OK'],
  fnNameUnread: ['OK', 'OK', 'OK', 'OK'],
  fnNameCalled: ['pine:state', 'pine:state', 'OK', 'pine:state'],
  blockIf: ['OK', 'OK', 'OK', 'OK'],
  blockIfTyped: ['OK', 'OK', 'OK', 'OK'],
  blockIfElseArm: ['OK', 'OK', 'OK', 'OK'],
  blockIfNested: ['pine:state', 'pine:state', 'OK', 'pine:state'],
  blockIfFn: ['OK', 'OK', 'OK', 'OK'],
  blockIfUnread: ['OK', 'OK', 'OK', 'OK'],
}

describe('⭐⭐ engine 50 — v3+: the shapes only the runtime lane refused (or none did) refuse `pine:cycle` at all four doors, ONE sentence', () => {
  const cases = []
  for (const [shape, lines] of Object.entries(DOORS_AGREE)) for (const v of V3) cases.push([shape, v, lines])
  for (const [shape, lines] of Object.entries(DOORS_AGREE_V5)) for (const v of [5, 6]) cases.push([shape, v, lines])
  it.each(cases)('%s, v%i: screen, pane (strict), buildRuntimeIr and the member door', (shape, v, lines) => {
    const src = pineAt(v, lines(v))
    const name = shape === 'colorArg' || shape === 'colorArgTyped' ? 'c' : 'x'
    const sentence = `${REFUSALS['pine:cycle']} — ${selfReferenceSentence(name, v)}`
    for (const r of [hostRefusal(src), hostRefusal(src, { strict: true }), runtimeRefusal(src)]) {
      expect(r && r.guard).toBe('pine:cycle')
      expect(r.message).toBe(sentence)
    }
    const d = door(src)
    expect(d.ok).toBe(false)
    expect(d.guard).toBe('pine:cycle')
  })

  it('the refusal points at the declaration, in the screen, the pane and the runtime lane alike', () => {
    for (const lines of [DOORS_AGREE.unreadTop(5), DOORS_AGREE.blockIf(5), DOORS_AGREE.fnName(5)]) {
      const src = pineAt(5, lines)
      const at = lines.findIndex((l) => /^(float )?x = /.test(l)) + 3   // two header lines, 1-based
      for (const r of [hostRefusal(src), hostRefusal(src, { strict: true }), runtimeRefusal(src)]) expect(r.line).toBe(at)
    }
  })
})

describe('⭐⭐ engine 50 — v1/v2 and no pragma: the same shapes keep their engine-49 path at every door', () => {
  const cases = []
  for (const [shape, lines] of Object.entries(DOORS_AGREE)) for (const v of V12) cases.push([shape, v === null ? 'none' : `v${v}`, v, lines])
  it.each(cases)('%s, pragma %s', (shape, _label, v, lines) => {
    const src = pineAt(v, lines(v))
    expect(guards(src)).toEqual(DOORS_AGREE_V12[shape])
    for (const r of [hostRefusal(src), hostRefusal(src, { strict: true }), runtimeRefusal(src)]) {
      if (r && r.message) expect(r.message).not.toContain('does not compile in Pine v3+')
    }
  })
})

describe('⭐⭐ engine 50 — controls: nothing here reads an undeclared variable, and every door keeps its path in every pragma', () => {
  const CONTROLS50 = {
    // a block-valued declaration of a name declared before, shadowing a global in a function, reading
    // another name, declaring the name inside its own block, a `var`, the `:=` form, a string, a call's
    // history, and a `switch` reading `close[1]`
    blockDeclaredBefore: [() => ['x = close', 'x = if close > open', '    nz(x[1]) + 1', 'else', '    0.0', 'plot(x)'], ['OK', 'OK', 'OK', 'OK']],
    blockGlobalShadowFn: [() => ['x = close', 'f(s) =>', '    x = if s > 100', '        nz(x[1]) + 1', '    else', '        0.0', '    x', 'plot(f(close))'], ['OK', 'OK', 'OK', 'OK']],
    blockOther: [() => ['y = close', 'x = if close > open', '    nz(y[1]) + 1', 'else', '    0.0', 'plot(x)'], ['OK', 'OK', 'OK', 'OK']],
    blockInnerDecl: [() => ['x = if close > open', '    x = close', '    x[1]', 'else', '    0.0', 'plot(x)'], ['pine:state', 'pine:state', 'OK', 'pine:state']],
    blockVar: [() => ['var x = if close > open', '    nz(x[1]) + 1', 'else', '    0.0', 'plot(x)'], ['pine:block', 'pine:block', 'OK', 'pine:block']],
    blockMutable: [() => ['x = 0.0', 'x := if close > open', '    nz(x[1]) + 1', 'else', '    0.0', 'plot(x)'], ['OK', 'OK', 'OK', 'OK']],
    blockString: [() => ['x = if close > open', '    str.length("x[1]") * 1.0', 'else', '    0.0', 'plot(x)'], ['OK', 'OK', 'OK', 'OK']],
    blockCallHistory: [(v) => ['x = if close > open', `    ${ta(v, 'sma')}(close, 5)[1]`, 'else', '    0.0', 'plot(x)'], ['OK', 'OK', 'runtime:conditional-history', 'OK']],
    // function namespace: a name that is a function only, a mutable variable of a function's name, a
    // parameter named after a function, and a history read of a CALL
    fnNameMutable: [() => ['x(a) => a * 2', 'float x = 0.0', 'x := nz(x[1]) + 1', 'plot(x)'], ['pine:state', 'pine:state', 'OK', 'pine:state']],
    fnParamName: [() => ['g(a) => a * 2', 'f(g) =>', '    y = nz(g[1]) + 1', '    y', 'plot(f(close))'], ['OK', 'OK', 'OK', 'OK']],
    atrName: [(v) => [`atr = ${ta(v, 'atr')}(14)`, 'plot(atr)'], ['OK', 'OK', 'OK', 'OK']],
    callHistory: [(v) => [`sma = ${ta(v, 'sma')}(close, 5)[1]`, 'plot(sma)'], ['OK', 'OK', 'OK', 'OK']],
    // an unread declaration of a built-in name, and an `if` statement shadowing a global
    builtinUnread: [() => ['vwap = nz(vwap[1]) + 1', 'plot(close)'], ['OK', 'OK', 'OK', 'OK']],
    ifStmtShadow: [() => ['x = close', 'if close > open', '    x = nz(x[1]) + 1', 'plot(x)'], ['pine:state', 'OK', 'OK', 'OK']],
  }
  const cases = []
  for (const [shape, [lines, want]] of Object.entries(CONTROLS50)) {
    for (const v of [...V12, ...V3]) cases.push([shape, v === null ? 'none' : `v${v}`, v, lines, want])
  }
  it.each(cases)('%s, pragma %s', (shape, _label, v, lines, want) => {
    expect(guards(pineAt(v, lines(v)))).toEqual(want)
  })
})

describe('the block-valued detector, asked directly', () => {
  const stmtsOf = (lines) => { const l = lexPine(lines.join('\n')); return blockStatements(l.tokens, l.indents, 0) }
  it('a block that reads `x[k]`: yes; another name, a field, `x[]`, a block declaring `x`, a built-in, `:=`: no', () => {
    expect(blockDeclarationReadsOwnHistory(stmtsOf(['x = if c', '    nz(x[1])', 'else', '    0.0']), 0, 'x')).toBe(true)
    expect(blockDeclarationReadsOwnHistory(stmtsOf(['x = if c', '    1.0', 'else if x[2] > 0', '    0.0']), 0, 'x')).toBe(true)
    expect(blockDeclarationReadsOwnHistory(stmtsOf(['x = switch', '    c => x[1]', '    => 0.0']), 0, 'x')).toBe(true)
    expect(blockDeclarationReadsOwnHistory(stmtsOf(['x = if c', '    nz(y[1])', 'else', '    0.0']), 0, 'x')).toBe(false)
    expect(blockDeclarationReadsOwnHistory(stmtsOf(['x = if c', '    p.x[1]', 'else', '    0.0']), 0, 'x')).toBe(false)
    expect(blockDeclarationReadsOwnHistory(stmtsOf(['x = if c', '    x = close', '    x[1]', 'else', '    0.0']), 0, 'x')).toBe(false)
    expect(blockDeclarationReadsOwnHistory(stmtsOf(['x = if c', '    [x, y] = f()', '    x[1]', 'else', '    0.0']), 0, 'x')).toBe(false)
    expect(blockDeclarationReadsOwnHistory(stmtsOf(['close = if c', '    close[1]', 'else', '    0.0']), 0, 'close')).toBe(false)
    expect(blockDeclarationReadsOwnHistory(stmtsOf(['x := if c', '    nz(x[1])', 'else', '    0.0']), 0, 'x')).toBe(false)
    expect(blockDeclarationReadsOwnHistory(stmtsOf(['x = nz(x[1]) + 1']), 0, 'x')).toBe(false)
  })
  it('declared before AS A VARIABLE: a function binding (or an opaque function) does not count', () => {
    const env = new Map([['f', { kind: 'fn' }], ['g', { kind: 'opaque', isFunction: true }], ['v', { kind: 'expr' }], ['o', { kind: 'opaque' }]])
    expect(declaredAsVariable(env, 'f')).toBe(false)
    expect(declaredAsVariable(env, 'g')).toBe(false)
    expect(declaredAsVariable(env, 'v')).toBe(true)
    expect(declaredAsVariable(env, 'o')).toBe(true)
    expect(declaredAsVariable(env, 'missing')).toBe(false)
    expect(declaredAsVariable(null, 'v')).toBe(false)
  })
})
