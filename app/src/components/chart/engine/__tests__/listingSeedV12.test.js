// ─── ⭐⭐ W34-I4b — A v1/v2 SELF-REFERENCE'S BAR 0 FROM THE LISTING IS NOT GUESSED ──
//
// A v1/v2 self-referencing series `x = cond ? nz(x[1], fill) : y` folds to
// `accum(fill, …)`. From the listing (`historyFromListing`, ruling R-W) the listing
// pass read the self read before bar 0 as Pine's `na`, so bar 0 drew `fill`. That
// reading is MEASURED for v4+ (on-listing NYSE:RDDT 1D captures of v4 scripts) and
// NOT for v1/v2: the Pine reference does not say whether a v1/v2 self-reference
// enters bar 0 with `x[1]` as `na` or as `0` (capture row W34-I4-S1, owed). So for
// v1/v2 (and a script with no `//@version`, compiled as v1) the pass keeps both
// readings as candidates and publishes a bar only where they agree: the bars that
// depend on the rule are withheld as an off-listing run withholds its warm-up.
//
// Rails, both lanes (host: door -> install -> `computeFor`; runtime:
// `buildRuntimeIr` -> `lowerIrProgram` -> `execute`):
//   1. the authority (`listingSeedIsUnpinned`) says yes for v1/v2/no pragma only;
//   2. v1/v2/no pragma ON the listing: the rule-dependent bars are WITHHELD, every
//      bar both rules agree on is drawn, and it is Pine's value;
//   3. v4 ON the listing: still served, byte-identical to the pass without the key;
//   4. v1 OFF the listing: unchanged (the key is not even stated).
// Synthetic shapes only; no licence-held script text.

import { describe, it, expect, afterEach } from 'vitest'
import * as registry from '../nativeRegistry'
import { computeFor, listingOptsFor, listingSeedUnpinnedFor } from '../nativeRegistry'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { interpret, listingSeedIsUnpinned, LISTING_SEED_PINNED_FROM_VERSION } from '../ast/interpret.js'
import { translatePine } from '../ast/pine.js'
import { buildRuntimeIr } from '../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../runtime/lowerIr.js'
import { execute } from '../runtime/vm.js'

const N = 40
const isoDay = (i) => new Date(Date.UTC(2024, 2, 21) + i * 86400000).toISOString().slice(0, 10)
// close > open on every bar except i % 7 === 5, where it closes below the open:
// bars 0-4 hold the state carried from bar 0, bar 5 resets it to `close`.
const BARS = Array.from({ length: N }, (_, i) => {
  const o = 100 + i
  const c = o + ((i % 7) === 5 ? -3 : 1)
  return { t: isoDay(i), o, h: c + 2, l: c - 2, c, v: 1000 }
})
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const DEF_ID = 'u_member-pane-w34-i4b'

afterEach(() => { registry.uninstallUserDefinition(DEF_ID) })

const header = (v) => (v === null ? 'study("w34-i4b")' : `//@version=${v}\nstudy("w34-i4b")`)
// The v1/v2 spelling (a plain self-reference) and the v4 spelling of one recurrence.
const SELF = (fill) => `x = close > open ? nz(x[1], ${fill}) : close\nplot(x)`
const V4 = (fill) => `x = 0.0\nx := close > open ? nz(x[1], ${fill}) : close\nplot(x)`
const srcOf = (v, fill) => `${header(v)}\n${v !== null && v >= 4 ? V4(fill) : SELF(fill)}\n`

/** Pine's value bar by bar, given what `x[1]` reads before bar 0. */
const pine = (fill, before) => {
  let prev = before
  return BARS.map((b) => {
    prev = b.c > b.o ? (Number.isNaN(prev) ? fill : prev) : b.c
    return prev
  })
}
const same = (a, b) => a === b || (Number.isNaN(a) && Number.isNaN(b))

const hostColumn = (src, ctx) => {
  const built = memberPaneDefinition({ source: src, id: DEF_ID })
  expect(built.ok, built.reason).toBe(true)
  const { installed } = registry.installUserDefinitions([built.definition])
  expect(installed.length).toBe(1)
  const def = installed[0]
  const cols = computeFor(def, BARS, undefined, { tf: 'D', ...ctx })
  const col = Object.values(cols).find((c) => c && typeof c.length === 'number')
  expect(col, 'no plotted column').toBeTruthy()
  return { def, col: Array.from(col) }
}
const runtimeColumn = (src, listing) => {
  const built = buildRuntimeIr(src, { bars: BARS, inputs: {}, historyFromListing: listing })
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir, { historyFromListing: listing })
  const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return Array.from(r.outputs[0])
}

describe('1 — the authority', () => {
  it('unpinned for v1, v2 and no pragma; pinned from v3 on; absent is not a version', () => {
    expect(LISTING_SEED_PINNED_FROM_VERSION).toBe(3)
    expect([null, 1, 2, '2'].map(listingSeedIsUnpinned)).toEqual([true, true, true, true])
    expect([3, 4, 5, 6, undefined, NaN, 'x'].map(listingSeedIsUnpinned))
      .toEqual([false, false, false, false, false, false, false])
  })
  it('a document states it only when stamped: an unstamped one is left as it was', () => {
    expect(listingSeedUnpinnedFor({ meta: { doorVersion: 1, pineVersion: 2 } })).toBe(true)
    expect(listingSeedUnpinnedFor({ meta: { doorVersion: 1, pineVersion: null } })).toBe(true)
    expect(listingSeedUnpinnedFor({ meta: { doorVersion: 1, pineVersion: 4 } })).toBe(false)
    expect(listingSeedUnpinnedFor({ meta: { pineVersion: 2 } })).toBe(false)
    expect(listingSeedUnpinnedFor({ meta: { doorVersion: 1 } })).toBe(false)
    expect(listingSeedUnpinnedFor({})).toBe(false)
  })
})

describe('2 — v1/v2 from the listing: the rule-dependent bars are withheld, by both lanes', () => {
  const naRule = pine(5, NaN)
  const zeroRule = pine(5, 0)
  const disagree = naRule.map((v, i) => !same(v, zeroRule[i]))
  it('non-vacuity: the two rules differ on bars 0-4 and agree from the first reset', () => {
    expect(disagree.slice(0, 5)).toEqual([true, true, true, true, true])
    expect(disagree.slice(5).every((d) => !d)).toBe(true)
    expect(naRule[0]).toBe(5)
  })
  it.each([1, 2, null])('host lane, v%s: withheld where the rules differ, the Pine value elsewhere', (v) => {
    const { def, col } = hostColumn(srcOf(v, 5), { historyFromListing: true })
    expect(listingOptsFor(def, { historyFromListing: true }).listingSeedUnpinned).toBe(true)
    col.forEach((x, i) => {
      if (disagree[i]) expect(Number.isNaN(x), `bar ${i} drew ${x}, a guessed seed`).toBe(true)
      else expect(x, `bar ${i}`).toBe(naRule[i])
    })
  })
  it.each([1, 2, null])('runtime lane, v%s: withheld where the rules differ, the Pine value elsewhere', (v) => {
    const col = runtimeColumn(srcOf(v, 5), true)
    col.forEach((x, i) => {
      if (disagree[i]) expect(Number.isNaN(x), `bar ${i} drew ${x}, a guessed seed`).toBe(true)
      else expect(x, `bar ${i}`).toBe(naRule[i])
    })
  })
  it('⭐ no over-refusal: where the fill IS 0 both rules agree, and bar 0 is drawn on both lanes', () => {
    const ref = pine(0, NaN)
    expect(ref).toEqual(pine(0, 0))
    expect(hostColumn(srcOf(1, 0), { historyFromListing: true }).col).toEqual(ref)
    expect(runtimeColumn(srcOf(1, 0), true)).toEqual(ref)
  })
})

describe('3 — v4 from the listing: still served, byte-identical', () => {
  it('host lane: the key is not stated, and bars 1-4 draw the fill', () => {
    const { def, col } = hostColumn(srcOf(4, 5), { historyFromListing: true })
    expect('listingSeedUnpinned' in listingOptsFor(def, { historyFromListing: true })).toBe(false)
    expect(col.slice(1, 5)).toEqual([5, 5, 5, 5])
    // byte-identical to the listing pass asked without the key
    const t = translatePine(srcOf(4, 5))
    const ast = t.outputs.find((o) => o.ast).ast
    const bare = Array.from(interpret(ast, BARS, {}, undefined, undefined, { tf: 'D', historyFromListing: true }))
    expect(col.every((x, i) => Object.is(x, bare[i]))).toBe(true)
  })
  it('runtime lane: bars 0-4 draw the fill', () => {
    const col = runtimeColumn(srcOf(4, 5), true)
    expect(col.slice(0, 5)).toEqual([5, 5, 5, 5, 5])
    expect(col).toEqual(pine(5, NaN))
  })
})

describe('4 — v1 off the listing: unchanged', () => {
  it('host lane: no key, and the bounded window answers (nothing in a 40-bar warm-up)', () => {
    const { def, col } = hostColumn(srcOf(1, 5), {})
    expect(listingOptsFor(def, {})).toEqual({})
    const t = translatePine(srcOf(1, 5))
    const ast = t.outputs.find((o) => o.ast).ast
    const bare = Array.from(interpret(ast, BARS, {}, undefined, undefined, { tf: 'D' }))
    expect(col.every((x, i) => Object.is(x, bare[i]))).toBe(true)
    expect(col.every(Number.isNaN)).toBe(true)
  })
  it('runtime lane: the same bounded window', () => {
    expect(runtimeColumn(srcOf(1, 5), false).every(Number.isNaN)).toBe(true)
  })
})
