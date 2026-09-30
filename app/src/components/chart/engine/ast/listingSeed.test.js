// ─── ⭐⭐ C12w — THE LISTING SEED (ruling R-W): a Pine `var` read from bar 0 ─────
//
// The bounded 250-bar window stays the default; ONLY a caller that states the
// series starts at the symbol's first-ever bar (`historyFromListing: true`) gets
// the listing pass (`interpret.js::listingPass`). These rails pin four things:
//
//   1. ABSENT OR NOT-`true` IS BYTE-IDENTICAL to the bounded window.
//   2. EXACT: on every Pine `var` form the translator emits, the listing pass
//      reproduces Pine's own value on EVERY bar — measured against a hand-written
//      bar-by-bar Pine reference, not against our own evaluator.
//   3. NEVER A GUESS: where the tree cannot settle bar 0 (a mixed `var` with a
//      real initializer; a counter that never forgets) the bar stays withheld —
//      `NaN` before the warm-up, the bounded window's own value after it.
//   4. THE CEILING HOLDS: a pass that would exceed `MAX_RECURRENCE_STEPS` is not
//      taken, and the bounded window answers exactly as before.

import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'
import {
  interpret, MAX_RECURRENCE_STEPS, isAmbiguousVarSeed, LISTING_MAX_GUARDED_READS,
} from './interpret.js'

const N = 420
const W = 250
// A close that crosses 109 now and then, including on bar 3 — so a latch set
// early carries through the whole 250-bar curtain.
const CLOSE = Array.from({ length: N }, (_, i) => 100 + 10 * Math.sin(i / 7) + (i === 3 ? 20 : 0))
const BARS = CLOSE.map((c, i) => ({ t: 1700000000 + i * 86400, o: c, h: c + 1, l: c - 1, c, v: 1000 + i }))

const treeOf = (src) => {
  const t = translatePine(src)
  const out = (t.outputs || []).find((o) => o && o.ast)
  if (!out) throw new Error(`no output tree: ${JSON.stringify(t.refusals || t.reason || t).slice(0, 300)}`)
  return out.ast
}
const run = (ast, opts) => Array.from(interpret(ast, BARS, {}, undefined, undefined, opts))
const same = (a, b) => a === b || (Number.isNaN(a) && Number.isNaN(b))
const firstDiff = (a, b) => a.findIndex((v, i) => !same(v, b[i]))
const pine = (lines) => ['//@version=5', 'indicator("c12w")', ...lines].join('\n')

/** Pine's own answer, bar by bar — written from the language's rules, not ours. */
/** Bars the listing pass may withhold at the very start, per form. The tree cannot
 *  tell a `var` from the self-reference spelling `x = na(x[1]) ? S : U`, whose
 *  bar-0 value is the seed with no update run; where the two readings differ on
 *  bar 0 that bar is withheld (never guessed) and the next bar settles it. */
const WITHHELD_AT_START = { guarded: 1 }

const REFERENCE = {
  bareOnly: () => {
    let b = 7
    return CLOSE.map((c) => { if (c > 109) b = c; return b })
  },
  historyOnly: () => {
    let prev = NaN
    return CLOSE.map((c) => { const a = c > 109 ? c : prev; prev = a; return a })
  },
  guarded: () => {
    let prev = NaN
    return CLOSE.map((c) => { const v = c > 109 ? c : (Number.isNaN(prev) ? 3 : prev); prev = v; return v })
  },
  plain: () => {
    let prev = NaN
    return CLOSE.map((c) => { const e = c > 109 ? c : prev; prev = e; return e })
  },
  mixedNaInit: () => {
    // var float lvl = na
    // if close > 109            -> lvl := close
    // if not na(lvl) and ta.crossunder(close, lvl)  -> lvl := na
    let lvl = NaN
    let prevFinal = NaN
    return CLOSE.map((c, i) => {
      if (c > 109) lvl = c
      const pc = i > 0 ? CLOSE[i - 1] : NaN
      const under = (c < lvl) && (pc >= prevFinal)   // a comparison with na is false
      if (!Number.isNaN(lvl) && under) lvl = NaN
      prevFinal = lvl
      return lvl
    })
  },
  selfRefEma: () => {
    let prev = NaN
    return CLOSE.map((c) => { const x = Number.isNaN(prev) ? c : 0.5 * prev + 0.5 * c; prev = x; return x })
  },
}

const SCRIPTS = {
  bareOnly: pine(['var float b = 7.0', 'b := close > 109 ? close : b', 'plot(b)']),
  historyOnly: pine(['var float a = 7.0', 'a := close > 109 ? close : a[1]', 'plot(a)']),
  guarded: pine(['var float g = 7.0', 'g := close > 109 ? close : nz(g[1], 3.0)', 'plot(g)']),
  plain: pine(['e = 7.0', 'e := close > 109 ? close : e[1]', 'plot(e)']),
  mixedNaInit: pine([
    'var float lvl = na',
    'if close > 109',
    '    lvl := close',
    'if not na(lvl) and ta.crossunder(close, lvl)',
    '    lvl := na',
    'plot(lvl)',
  ]),
  selfRefEma: pine(['x = na(x[1]) ? close : 0.5 * x[1] + 0.5 * close', 'plot(x)']),
}

const MIXED_MARKED = pine(['var float f = close', 'f := 0.6 * f - 0.08 * f[2] + 0.48 * close', 'plot(f)'])

describe('C12w — absent means the bounded window, byte for byte', () => {
  for (const [name, src] of Object.entries(SCRIPTS)) {
    it(`${name}: no flag, false, and a truthy non-true value all answer the same column`, () => {
      const ast = treeOf(src)
      const base = run(ast, undefined)
      for (const opts of [{}, { historyFromListing: false }, { historyFromListing: 'yes' }, { historyFromListing: 1 }]) {
        expect(firstDiff(run(ast, opts), base), JSON.stringify(opts)).toBe(-1)
      }
    })
  }
})

describe('C12w — the listing pass is Pine, bar for bar, on every form the translator emits', () => {
  for (const [name, src] of Object.entries(SCRIPTS)) {
    it(`${name}: listing === the Pine reference on all ${N} bars`, () => {
      const ast = treeOf(src)
      const ref = REFERENCE[name]()
      const got = run(ast, { historyFromListing: true })
      const skip = WITHHELD_AT_START[name] || 0
      expect(got.slice(0, skip).every(Number.isNaN), `${name}: a withheld start bar drew a number`).toBe(true)
      const at = firstDiff(got.slice(skip), ref.slice(skip))
      expect(at, `${name} bar ${at + skip}: ours ${got[at + skip]} vs Pine ${ref[at + skip]}`).toBe(-1)
    })
  }

  it('⭐ NON-VACUITY — the bounded window really did withhold the prefix these forms now fill', () => {
    // bare-only holds 7 (then the bar-3 latch) on every bar in Pine; the bounded
    // window has nothing before bar 250. If THIS fails the rails above prove nothing.
    const ast = treeOf(SCRIPTS.bareOnly)
    const windowed = run(ast, undefined)
    expect(windowed.slice(0, W).every(Number.isNaN)).toBe(true)
    const listed = run(ast, { historyFromListing: true })
    expect(listed.slice(0, W).some(Number.isNaN)).toBe(false)
  })
})

describe('C12w — where the tree cannot settle bar 0, nothing is drawn that Pine does not draw', () => {
  it('a mixed `var` with a real initializer is MARKED, and stays withheld before the warm-up', () => {
    // Pine (vw-var-seed V06): `f[2]` is na on bar 0, poisons the step, and the bare
    // `f` carries it — `na` on every bar.
    const src = MIXED_MARKED
    const ast = treeOf(src)
    const seeds = []
    const walk = (n) => {
      if (!n || typeof n !== 'object') return
      if (n.type === 'call' && n.name === 'accum') seeds.push(n.args[0])
      for (const a of n.args || []) walk(a)
    }
    walk(ast)
    expect(seeds.length).toBeGreaterThan(0)
    expect(seeds.every(isAmbiguousVarSeed), 'the mixed seed lost its mark').toBe(true)
    const got = run(ast, { historyFromListing: true })
    expect(got.every(Number.isNaN), `a number reached bar ${got.findIndex((v) => !Number.isNaN(v))}`).toBe(true)
  })

  it('⛔ a counter that never forgets does NOT read bar_index: `accum(0, self + 1)` is two Pine spellings', () => {
    // `var n = 0; n := n + 1` reads bar_index + 1; `n = na(n[1]) ? 0 : n[1] + 1`
    // reads bar_index. Both translate to this tree, which cannot say which — so
    // the prefix stays withheld and the bounded window answers from the warm-up
    // on, EXACTLY as without the exception. (The translator refuses both
    // spellings at the door anyway: `pine:state`, the convergence gate.)
    const ast = {
      type: 'call', name: 'accum',
      args: [{ type: 'num', value: 0 }, { type: 'op', name: '+', args: [{ type: 'series', name: 'self' }, { type: 'num', value: 1 }] }, { type: 'num', value: W }],
    }
    const got = run(ast, { historyFromListing: true })
    expect(got.slice(0, W).every(Number.isNaN)).toBe(true)
    expect(firstDiff(got, run(ast, undefined))).toBe(-1)
  })

  it('the seed-OR-na reading of an `nz` read is enumerated, and a disagreement is withheld', () => {
    // accum(5, nz(self, 0) + 1, W): bar 0 is 6 if the read is bare (seed 5), 1 if
    // it is a guarded history read (`na` -> 0), and 5 for the self-reference form.
    // The three never merge, so every bar before the warm-up stays withheld.
    const ast = {
      type: 'call', name: 'accum',
      args: [
        { type: 'num', value: 5 },
        { type: 'op', name: '+', args: [{ type: 'call', name: 'nz', args: [{ type: 'series', name: 'self' }, { type: 'num', value: 0 }] }, { type: 'num', value: 1 }] },
        { type: 'num', value: W },
      ],
    }
    const sink = []
    const got = run(ast, { historyFromListing: true, stepSink: sink })
    expect(got.slice(0, W).every(Number.isNaN)).toBe(true)
    expect(sink[0].listing.trajectories).toBe(3)
  })

  it('an unknown bar is the probe under `prefixProbe`, so `objectColumns.unknownMask` still sees it', () => {
    const ast = treeOf(MIXED_MARKED)
    const got = run(ast, { historyFromListing: true, prefixProbe: 1e12 })
    expect(got.slice(0, W).every((v) => v === 1e12)).toBe(true)
    // …and a KNOWN bar is never the probe.
    const known = run(treeOf(SCRIPTS.bareOnly), { historyFromListing: true, prefixProbe: 1e12 })
    expect(known.some((v) => v === 1e12)).toBe(false)
  })
})

describe('C12w — the step ceiling is never raised', () => {
  // accum(1, (nz(self,0) + … n reads) × 0, warm): up to 1 + 2^n bar-0 readings.
  const nzReads = (n, warm) => {
    let body = { type: 'call', name: 'nz', args: [{ type: 'series', name: 'self' }, { type: 'num', value: 0 }] }
    for (let k = 1; k < n; k++) {
      body = { type: 'op', name: '+', args: [body, { type: 'call', name: 'nz', args: [{ type: 'series', name: 'self' }, { type: 'num', value: 0 }] }] }
    }
    return { type: 'call', name: 'accum', args: [{ type: 'num', value: 1 }, { type: 'op', name: '*', args: [body, { type: 'num', value: 0 }] }, { type: 'num', value: warm }] }
  }

  it('a pass whose trajectories × bars would pass the ceiling is NOT taken — the bounded window answers', () => {
    // 1 (self-reference) + 1 (all bare) + (2^7 - 1) = 129 bar-0 readings. With a
    // 10-bar window the listing pass would cost (129 + 10) × L and the window 10 × L:
    // past L = ceiling / 139 the pass is refused and the window answers alone.
    const warm = 10
    const L = Math.floor(MAX_RECURRENCE_STEPS / (129 + warm)) + 10
    expect((129 + warm) * L).toBeGreaterThan(MAX_RECURRENCE_STEPS)
    expect(warm * L).toBeLessThanOrEqual(MAX_RECURRENCE_STEPS)
    const bars = Array.from({ length: L }, (_, i) => ({ t: 1700000000 + i * 86400, o: 1, h: 1, l: 1, c: 1, v: 1 }))
    const ast = nzReads(LISTING_MAX_GUARDED_READS, warm)
    const sink = []
    const listed = interpret(ast, bars, {}, undefined, undefined, { historyFromListing: true, stepSink: sink })
    const windowed = interpret(ast, bars, {}, undefined, undefined, {})
    expect(sink[0].listing).toEqual({ taken: false, trajectories: 129 })
    let diff = -1
    for (let i = 0; i < L; i++) if (!same(listed[i], windowed[i])) { diff = i; break }
    expect(diff).toBe(-1)
  })

  it('past the enumeration cap every guarded read is unknown — still taken, and no bar is less computed', () => {
    // `unknown × 0` is NOT assumed to be 0 — it is NaN when the unknown is `na` —
    // so that trajectory never settles, the prefix stays withheld, and every bar
    // matches the bounded window: sound, only less often known.
    const ast = nzReads(LISTING_MAX_GUARDED_READS + 1, W)
    const sink = []
    const got = run(ast, { historyFromListing: true, stepSink: sink })
    expect(sink[0].listing.taken).toBe(true)
    expect(sink[0].listing.trajectories).toBe(3)
    expect(firstDiff(got, run(ast, undefined))).toBe(-1)
  })
})
