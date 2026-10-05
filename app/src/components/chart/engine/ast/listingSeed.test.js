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
  interpret, MAX_RECURRENCE_STEPS, isAmbiguousVarSeed, ambiguousVarSeed, LISTING_MAX_GUARDED_READS,
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
 *  bar 0 that bar is withheld (never guessed) and the next bar settles it.
 *  ⭐ F5: `guarded` is no longer withheld. Its seed is `na` (a `var` read only
 *  through history), and the one spelling whose bar 0 is its seed, with an `S` of
 *  `na`, does not translate at all (rail below), so an `na` seed has ONE reading:
 *  bar 0 runs the update, as Pine does. */
const WITHHELD_AT_START = {}

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

  it('⛔ F5 — the only spelling an `na` seed could be read as instead, `x = na(x[1]) ? na : U`, is refused', () => {
    // If this ever translates, an `na` seed has two readings again and the listing
    // pass must go back to withholding bar 0 of `guarded` (interpret.js, F5).
    const t = translatePine(pine(['x = na(x[1]) ? na : close * 0.5 + nz(x[1]) * 0.5', 'plot(x)']))
    expect((t.outputs || []).some((o) => o && o.ast)).toBe(false)
  })

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

  it('⛔ the MARKED seed is never read as the bare value — trusting it would DRAW a wrong number', () => {
    // `var m = 5.0; m := close < 105 ? (nz(m) + close) / 2 : m[1]`: bare and
    // unguarded-history, initializer 5 — the marked case. Bar 0 (close 100) takes
    // the bare arm: Pine reads m = 5 there, so (5 + 100) / 2 = 52.5. The seed slot
    // holds `na`; read as the bare value it would give (nz(na) + 100) / 2 = 50 —
    // a confident wrong number. (The V06 fixture above cannot tell: its `f[2]` is
    // unknown on bar 0 whatever the seed says.)
    // The translator's convergence gate refuses this spelling, so the tree is written
    // out as `varSeedOf` marks it: accum(-(0 / 0), close < 105 ? (nz(self, 0) + close) / 2 : self, W).
    const self = { type: 'series', name: 'self' }
    const close = { type: 'series', name: 'close' }
    const ast = {
      type: 'call', name: 'accum', args: [
        ambiguousVarSeed(),
        { type: 'op', name: '?:', args: [
          { type: 'op', name: '<', args: [close, { type: 'num', value: 105 }] },
          { type: 'op', name: '/', args: [{ type: 'op', name: '+', args: [{ type: 'call', name: 'nz', args: [self, { type: 'num', value: 0 }] }, close] }, { type: 'num', value: 2 }] },
          self,
        ] },
        { type: 'num', value: W },
      ],
    }
    let m = 5
    let prev = NaN
    const ref = CLOSE.map((c, i) => {
      const v = c < 105 ? ((Number.isNaN(i === 0 ? m : prev) ? 0 : (i === 0 ? m : prev)) + c) / 2 : prev
      prev = v
      return v
    })
    expect(ref[0]).toBe(52.5)
    const got = run(ast, { historyFromListing: true })
    const wrong = got.findIndex((v, i) => Number.isFinite(v) && !same(v, ref[i]))
    expect(wrong, `bar ${wrong}: drew ${got[wrong]} where Pine draws ${ref[wrong]}`).toBe(-1)
  })

  it('⛔ …and its bars are UNKNOWN, not a confident `na` — the object lane must still withhold them', () => {
    // `var m = 5.0; m := close < 105 ? (m + close) / 2 : m[1]`: Pine takes the bare
    // arm on bar 0 and draws (5 + 100) / 2 = 52.5, then carries numbers. Read as
    // the bare value, the marked `na` seed gives `na` on bar 0 — and so does the
    // self-reference reading — so the two AGREE on a confident `na` that Pine never
    // draws, and an `if na(m)` op would fire off it. Correct: every bar before the
    // warm-up is UNKNOWN, which `prefixProbe` (what `unknownMask` reads) exposes.
    const src = pine(['var float m = 5.0', 'm := close < 105 ? (m + close) / 2 : m[1]', 'plot(m)'])
    const ast = treeOf(src)
    const seeds = []
    const walk = (n) => {
      if (!n || typeof n !== 'object') return
      if (n.type === 'call' && n.name === 'accum') seeds.push(n.args[0])
      for (const a of n.args || []) walk(a)
    }
    walk(ast)
    expect(seeds.every(isAmbiguousVarSeed)).toBe(true)
    const probed = run(ast, { historyFromListing: true, prefixProbe: 1e12 })
    expect(probed.slice(0, W).every((v) => v === 1e12), 'a marked bar was published as known').toBe(true)
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

describe('C12w × C12r — a read ABOVE the write (`accum(…)[1]`) under the listing exception', () => {
  // Pine: `y = b` above `b := …` reads the value `b` ENTERS the bar with — on bar 0
  // the initializer (a bare read), afterwards last bar's final value.
  const above = (init) => pine([
    `var float b = ${init}`,
    'y = b',
    'b := close > 109 ? close : b',
    'plot(y)',
  ])
  const pineAbove = (init) => {
    let b = init
    return CLOSE.map((c) => { const y = b; if (c > 109) b = c; return y })
  }

  it('the translated read is the START binding, one bar back over the accumulator', () => {
    const ast = treeOf(above('7.0'))
    expect(ast.type).toBe('offset')
    expect(ast.args[0].type === 'call' && ast.args[0].name === 'accum').toBe(true)
  })

  it('⭐ from bar 1 on it is Pine exactly; bar 0 (the state ENTERING bar 0) is withheld, never guessed', () => {
    // The tree cannot tell whether the read one bar before bar 0 was bare (7) or a
    // history read (na): it is UNKNOWN — the probe, so the object lane withholds
    // what reads it — and blank on a plot.
    const ast = treeOf(above('7.0'))
    const ref = pineAbove(7)
    const got = run(ast, { historyFromListing: true })
    expect(Number.isNaN(got[0])).toBe(true)
    expect(firstDiff(got.slice(1), ref.slice(1))).toBe(-1)
    const probed = run(ast, { historyFromListing: true, prefixProbe: 1e12 })
    expect(probed[0]).toBe(1e12)
    expect(firstDiff(probed.slice(1), ref.slice(1))).toBe(-1)
  })

  it('⭐ with an `na` initializer both readings are `na`: bar 0 is KNOWN and every bar is Pine', () => {
    const ast = treeOf(above('na'))
    const ref = pineAbove(NaN)
    const probed = run(ast, { historyFromListing: true, prefixProbe: 1e12 })
    expect(firstDiff(probed, ref)).toBe(-1)
  })

  it('⛔ without the listing statement nothing here changes — the probe fills only the curtain', () => {
    const ast = treeOf(above('7.0'))
    const a = run(ast, { prefixProbe: 1e12 })
    expect(a[0]).not.toBe(1e12)          // the offset's own left edge stays NaN
    expect(Number.isNaN(a[0])).toBe(true)
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
