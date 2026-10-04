// app/src/components/chart/engine/ast/pine.varSeed.test.js
//
// ─── ⭐⭐ WHAT A `var` IS ON BAR 0 — `x[1]` IS `na`, BARE `x` IS THE INITIALIZER ──
//
// `var x = init` sets `x` BEFORE bar 0's statements run, so inside
// `x := … x …` a BARE read on bar 0 is `init`. A HISTORY read `x[1]` on bar 0
// is `na` — there is no bar before bar 0 — and it does not read the initializer.
// On every later bar the two are the same value (a `var` enters a bar holding
// the previous bar's final value), which is why the fold emits one `self` for
// both and differs only in what `accum` is SEEDED with (`varSeedOf`, pine.js).
//
// Evidence: the rule is Pine's history operator. This repo's runtime lane already
// implements it (`runtime/vm.js` READ_HIST_SLOT: *"On bar 0 nothing has been
// committed, so `x[1]` is `na`"*); the vendor capture
// `tests/fixtures/vendor/runtime/mutable-history-spy-1d-2026-09-08.json` records
// that `x[1] === na` on bar 0 was NOT observed (its window starts at bar 8,059).
// Its counter `var float x = 0.0; x := x + 1` reads 8,459 on the last of 8,459
// loaded bars, which is the bare half — bar 0 read `x` as 0.0, not `na` — but
// only if "loaded_history_bars" counts from the symbol's first bar; stated, not
// leaned on. The probe that settles the history half is queued (Q-V1,
// `docs/pine/capture-queue-2026-09-28.md`).
//
// ⛔ EVERY CASE CARRIES ITS PINE REFERENCE, simulated from bar 0 of the fixture,
// and the two spellings are asserted to DIFFER on the bars where they should —
// a fixture on which both forms agree cannot tell the fix from its absence.
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'
import { interpret } from './interpret.js'
import { parseFormula } from './parse.js'

const HEAD = '//@version=5\nindicator("t")\n'
const W = 250
const N = 300

/** Down bars everywhere except `up`, where close > open. Opens are distinct, so
 *  a carried value names the bar it came from. */
function barsWith(up) {
  const ups = new Set(up)
  return Array.from({ length: N }, (_, i) => {
    const o = 100 + i
    const c = ups.has(i) ? o + 1 : o - 1
    return { t: 1_700_000_000 + i * 86400, o, h: Math.max(o, c) + 0.5, l: Math.min(o, c) - 0.5, c, v: 1000 + i }
  })
}

function formulaOf(script, strict = true) {
  const out = translatePine(HEAD + script, { strict })
  const chosen = out.outputs.find((o) => o.formula)
  expect(chosen, out.refusals && out.refusals.map((r) => r.guard).join(',')).toBeTruthy()
  return chosen.formula
}

const run = (formula, bars) => Array.from(interpret(parseFormula(formula).ast, bars, {}, undefined, undefined,
  { tf: 'D', newestBarIsForming: false }))

/** Pine, from bar 0: `x := cond ? open : <prev>`, where <prev> on bar 0 is
 *  `na` for the history spelling and the initializer (0) for the bare one. */
function pineReference(bars, bare) {
  const out = []
  for (let i = 0; i < bars.length; i++) {
    const prev = i === 0 ? (bare ? 0 : NaN) : out[i - 1]
    out.push(bars[i].c > bars[i].o ? bars[i].o : prev)
  }
  return out
}

const HISTORY = 'var x = 0.0\nx := close > open ? open : x[1]\nplot(x)\n'
const BARE = 'var x = 0.0\nx := close > open ? open : x\nplot(x)\n'

/** Same value, NaN-aware. */
const same = (a, b) => (Number.isNaN(a) && Number.isNaN(b)) || a === b

describe('⭐⭐ a `var` on bar 0: `x[1]` is `na`, bare `x` is the initializer', () => {
  it('the two spellings fold to the same update with different seeds — in both lanes', () => {
    for (const strict of [true, false]) {
      expect(formulaOf(HISTORY, strict)).toBe('accum(0 / 0, close > open ? open : self, 250)')
      expect(formulaOf(BARE, strict)).toBe('accum(0, close > open ? open : self, 250)')
    }
  })

  it('never fires: the history spelling is `na` on every bar, the bare one is 0 — as in Pine', () => {
    const bars = barsWith([])
    const hist = run(formulaOf(HISTORY), bars)
    const bare = run(formulaOf(BARE), bars)
    const wantHist = pineReference(bars, false)
    const wantBare = pineReference(bars, true)
    expect(wantHist.every(Number.isNaN)).toBe(true)
    expect(wantBare.every((v) => v === 0)).toBe(true)
    for (let i = W; i < N; i++) {
      expect(hist[i], `history bar ${i}`).toBeNaN()
      expect(bare[i], `bare bar ${i}`).toBe(0)
    }
    // ⛔ CONTROL: the fixture DISTINGUISHES the two — they differ on every
    // computed bar, so a seed that ignored the spelling fails one of the two.
    for (let i = W; i < N; i++) expect(same(hist[i], bare[i])).toBe(false)
  })

  it('fires inside every window: both spellings equal their Pine reference on every computed bar', () => {
    const bars = barsWith([270])
    const hist = run(formulaOf(HISTORY), bars)
    const bare = run(formulaOf(BARE), bars)
    const wantHist = pineReference(bars, false)
    const wantBare = pineReference(bars, true)
    for (let i = W; i < N; i++) {
      expect(same(hist[i], wantHist[i]), `history bar ${i}: ${hist[i]} vs ${wantHist[i]}`).toBe(true)
      expect(same(bare[i], wantBare[i]), `bare bar ${i}: ${bare[i]} vs ${wantBare[i]}`).toBe(true)
    }
    // Before the fire they differ (na vs 0); from it on they agree (open[270]).
    expect(hist[260]).toBeNaN()
    expect(bare[260]).toBe(0)
    expect(hist[280]).toBe(bars[270].o)
    expect(bare[280]).toBe(bars[270].o)
  })

  it('⚠️ THE FINITE WINDOW: a value set before the window is a GAP for the history spelling, never a number Pine cannot draw', () => {
    // Pine carries open[10] from bar 10 onward, forever. `accum` sees only the
    // last 250 steps, so from bar 260 the window no longer contains bar 10:
    //   history spelling → `na` there (not known from these bars)
    //   bare spelling    → 0, the initializer — the bounded-window approximation
    //                      it always had, and a value Pine does not show here.
    // ⚠️ How often a real chart meets this is UNMEASURED: no vendor capture holds
    // a history-reading `var` whose condition last fired more than 250 bars back.
    const bars = barsWith([10])
    const hist = run(formulaOf(HISTORY), bars)
    const bare = run(formulaOf(BARE), bars)
    const pine = pineReference(bars, false)
    for (let i = W; i < N; i++) expect(pine[i]).toBe(bars[10].o)
    for (let i = W; i <= 259; i++) {
      expect(hist[i], `bar ${i}`).toBe(bars[10].o)
      expect(bare[i], `bar ${i}`).toBe(bars[10].o)
    }
    for (let i = 260; i < N; i++) {
      expect(hist[i], `bar ${i}`).toBeNaN()
      expect(bare[i], `bar ${i}`).toBe(0)
    }
  })

  it('the PLAIN spelling (no `var`) is always the history case and seeds `na`', () => {
    // `x = 0.0` re-runs every bar, so a bare `x` in the update is that binding —
    // never `self` — and `self` only ever comes from `x[1]`, which is `na` on bar 0.
    const plain = 'x = 0.0\nx := close > open ? open : x[1]\nplot(x)\n'
    // ⭐ H7 (step 92h) — on the PANE the `na` seed carries its bar-0 reading (the
    // update run from `na`, `interpret.js::plainUpdateSeed`); a screen keeps `0 / 0`.
    // Both evaluate to `NaN` everywhere but the listing pass.
    expect(formulaOf(plain, true)).toBe('accum(1 * (1 * (0 / 0)), close > open ? open : self, 250)')
    expect(formulaOf(plain, false)).toBe('accum(0 / 0, close > open ? open : self, 250)')
    const bars = barsWith([])
    expect(run(formulaOf(plain), bars).filter(Number.isFinite)).toEqual([])
  })

  it('`nz(x[1])` answers what it always did — the `na` seed is exactly what `nz` exists to replace', () => {
    const guarded = 'x = 0.0\nx := close > open ? open : nz(x[1])\nplot(x)\n'
    const f = formulaOf(guarded)
    expect(f).toBe('accum(1 * (1 * (0 / 0)), close > open ? open : nz(self, 0), 250)')
    const bars = barsWith([270])
    const got = run(f, bars)
    const before = run(f.replace('accum(1 * (1 * (0 / 0)), ', 'accum(0, '), bars)
    for (let i = W; i < N; i++) expect(got[i], `bar ${i}`).toBe(before[i])
    expect(got[260]).toBe(0)
    // …and the `var` spelling, whose only self-reads are nz-guarded history, is
    // the same history-only case: `na` seed, `nz`'s default on bar 0 — as in Pine.
    expect(formulaOf('var u = 0.0\nu := close > open ? open : nz(u[1], 7)\nplot(u)\n'))
      .toBe('accum(0 / 0, close > open ? open : nz(self, 7), 250)')
  })

  it('a bare-only `var` keeps its initializer: the implicit else of an `if` is a bare read', () => {
    // `if c` / `x := …` with no `else` keeps `x` as it is — a bare read, which on
    // bar 0 is the initializer. Unchanged by the history rule.
    const ifOnly = 'var float s = 0.0\nif close > open\n    s := close\nplot(s)\n'
    expect(formulaOf(ifOnly)).toBe('accum(0, close > open ? close : self, 250)')
    const ifElse = 'var float s = 0.0\nif close > open\n    s := close\nelse\n    s := s[1]\nplot(s)\n'
    expect(formulaOf(ifElse)).toBe('accum(0 / 0, close > open ? close : self, 250)')
  })

  it('⚠️ read BOTH ways with an UNGUARDED `x[k]`: seeds `na` — the direction that never invents a number', () => {
    // One seed slot cannot be the initializer for the bare read and `na` for the
    // history read on the same step. Seeded `init`, the history arm taken on a
    // window's first step draws a value Pine never draws; seeded `na`, a BARE arm
    // taken there reads `na` where Pine's bar 0 reads the initializer — here
    // `(m + close) / 2` then never leaves `na`, a GAP. PARITY-PROGRAMME.md
    // (2026-09-28) records the choice and why.
    const mixed = 'var m = 0.0\nm := close > open ? (m + close) / 2 : m[1]\nplot(m)\n'
    // ⭐ C12w: a mixed `var` whose initializer is not `na` seeds the MARKED `na`,
    // `-(0 / 0)` (`interpret.js::ambiguousVarSeed`) — the same value to the bounded
    // window, and the one seed the listing pass must not read as its bare-read value.
    for (const strict of [true, false]) {
      expect(formulaOf(mixed, strict)).toBe('accum(-(0 / 0), close > open ? (self + close) / 2 : self, 250)')
    }
    expect(run(formulaOf(mixed), barsWith([270])).filter(Number.isFinite)).toEqual([])
  })

  it('⭐ read BOTH ways with only nz-GUARDED `x[k]`: keeps the initializer, and equals Pine', () => {
    // `nz(m[1])` answers 0 on bar 0 whatever the seed, so only the bare read cares
    // what it is — and it wants the initializer. Seeded `na`, every up bar would
    // blank until a down bar reset it; seeded `init` this is Pine, bar for bar.
    const guarded = 'var m = 0.0\nm := close > open ? (m + close) / 2 : nz(m[1])\nplot(m)\n'
    const f = formulaOf(guarded)
    expect(f).toBe('accum(0, close > open ? (self + close) / 2 : nz(self, 0), 250)')
    // Up on every bar but bar 0, so the BARE arm is what every window's first
    // step takes — the only fixture on which the two seeds can disagree.
    const bars = barsWith(Array.from({ length: N - 1 }, (_, k) => k + 1))
    const got = run(f, bars)
    const pine = []
    for (let i = 0; i < bars.length; i++) {
      const bare = i === 0 ? 0 : pine[i - 1]
      const hist = i === 0 ? NaN : pine[i - 1]
      pine.push(bars[i].c > bars[i].o ? (bare + bars[i].c) / 2 : (Number.isNaN(hist) ? 0 : hist))
    }
    for (let i = W; i < N; i++) expect(same(got[i], pine[i]), `bar ${i}: ${got[i]} vs ${pine[i]}`).toBe(true)
    // ⛔ CONTROL: re-seeded `na` it is NOT Pine — the guard is what decides.
    const naSeeded = run(f.replace('accum(0, ', 'accum(0 / 0, '), bars)
    expect(naSeeded.slice(W).some((v, k) => !same(v, pine[W + k]))).toBe(true)
  })

  it('⛔ the nz guard covers ITS OWN first argument only — a later bare `x[1]` is still unguarded', () => {
    // Resolved in order: `nz(m[1])` (guarded), then `m[1]` with nothing around it
    // (unguarded — `na` on bar 0), then a bare `m`. One unguarded read is enough
    // to seed `na`, so a guard that leaked past `nz(…)`'s argument would miss it.
    const src = 'var m = 0.0\nm := close > open ? nz(m[1]) : close < open ? m[1] : (m + close) / 2\nplot(m)\n'
    // ⭐ C12w: a mixed `var` whose initializer is not `na` seeds the MARKED `na`,
    // `-(0 / 0)` (`interpret.js::ambiguousVarSeed`) — the same value to the bounded
    // window, and the one seed the listing pass must not read as its bare-read value.
    expect(formulaOf(src)).toBe('accum(-(0 / 0), close > open ? nz(self, 0) : close < open ? self : (self + close) / 2, 250)')
  })

  it('⭐ an `na(x[1])` test is NOT a guard — it exists to see bar 0, so it needs the `na` seed', () => {
    // `q := na(q[1]) ? close : (q + close) / 2` takes `close` on bar 0 in Pine. A
    // seed of 0 would make `na(q[1])` false there and halve the close instead.
    const src = 'var q = 0.0\nq := na(q[1]) ? close : (q + close) / 2\nplot(q)\n'
    // ⭐ C12w: a mixed `var` whose initializer is not `na` seeds the MARKED `na`,
    // `-(0 / 0)` (`interpret.js::ambiguousVarSeed`) — the same value to the bounded
    // window, and the one seed the listing pass must not read as its bare-read value.
    expect(formulaOf(src)).toBe('accum(-(0 / 0), na(self) ? close : (self + close) / 2, 250)')
  })
})
