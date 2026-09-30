// ─── ⭐⭐ C12s — A SWITCHED COUNTER: published where the window forgot its seed ─
//
// `var int n = 0` + `n := c ? n + 1 : 0` — a run-length counter. Its `self + 1`
// arm never forgets the seed, so `forgetsItsSeed` refuses the bounded window.
// But the reset arm does forget: from the last bar `c` was false the value is
// Pine's own count, whatever the state was before. C12s admits it as SWITCHED
// (`interpret.js::switchedVarSeed`): the window starts from an UNKNOWN state and
// a bar is published only where the value came out known — a per-bar exactness
// decision made on the data. These rails pin:
//
//   1. THE GATE — what `forgetsOnReset` admits, and the shapes it still refuses.
//   2. EXACT — every published bar equals a hand-written Pine reference (from
//      bar 0, with the declared seed), over several seeds of the reference: a
//      published bar may not depend on the seed at all.
//   3. WITHHELD EXACTLY WHERE IT MUST BE — no reset inside `(t - W, t]` ⇒ not
//      computable, keyed on the data, never on a bar number.
//   4. COMPOSES — C12w's listing pass (from the listing: exact everywhere, seed
//      and all), the prefix probe (C12 / C17's `unknownMask`), and the ROOT
//      AGREEMENT: `n == 4` is withheld where `n` is unknown, never a confident 0.
//   5. PARITY — the Python lane reads `tests/fixtures/ast/switched_counter_parity.json`
//      and must produce the same columns; this rail reads the same file.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { translatePine, forgetsItsSeed, forgetsOnReset } from './pine.js'
import {
  interpret, switchedSeedOf, switchedVarSeed, readsSwitchedState, PREFIX_PROBE,
} from './interpret.js'
import { TABLE } from './parse.js'

const N = 420
const W = 250
// Up-runs of ~22 bars and one long plateau of rises (bars 300..379, 80 bars) so a
// streak can outlive a short window in the direct-tree rails below.
const CLOSE = Array.from({ length: N }, (_, i) => (i >= 300 && i < 380
  ? 200 + i
  : 100 + 10 * Math.sin(i / 7)))
const BARS = CLOSE.map((c, i) => ({ t: 1700000000 + i * 86400, o: c, h: c + 1, l: c - 1, c, v: 1000 + i }))
const pine = (lines) => ['//@version=5', 'indicator("c12s")', ...lines].join('\n')
const treeOf = (src) => {
  const t = translatePine(src)
  if (!t.ok) throw new Error(`refused: ${JSON.stringify(t.refusal).slice(0, 300)}`)
  return (t.outputs || []).find((o) => o && o.ast).ast
}
const run = (ast, opts) => Array.from(interpret(ast, BARS, {}, undefined, undefined, opts))
const findAccum = (t) => {
  const stack = [t]
  while (stack.length) {
    const n = stack.pop()
    if (!n || typeof n !== 'object') continue
    if (n.type === 'call' && n.name === 'accum') return n
    if (Array.isArray(n.args)) stack.push(...n.args)
  }
  return null
}

/** Pine's own count, from bar 0, with a stated seed — written from the language,
 *  not from this engine. `close > close[1]` is `false` on bar 0 (`na` compares
 *  false), so bar 0 resets. */
const pineCount = (seed, cond = (i) => i > 0 && CLOSE[i] > CLOSE[i - 1]) => {
  const out = []
  let n = seed
  for (let i = 0; i < N; i++) { n = cond(i) ? n + 1 : 0; out.push(n) }
  return out
}
/** The bars on which the window `(t - W, t]` holds a reset. */
const resetInWindow = (w, cond = (i) => i > 0 && CLOSE[i] > CLOSE[i - 1]) => {
  let last = -Infinity
  return CLOSE.map((_, i) => { if (!cond(i)) last = i; return last > i - w })
}

const SRC = pine([
  'var int n = 0',
  'n := close > close[1] ? n + 1 : 0',
  'plot(n)',
])

describe('1 · the gate — `forgetsOnReset`', () => {
  const tree = treeOf(SRC)
  const acc = findAccum(tree)

  it('⭐ the counter translates, and its seed carries the switched mark with the REAL seed', () => {
    expect(acc).not.toBeNull()
    expect(switchedSeedOf(acc.args[0])).toEqual({ type: 'num', value: 0 })
    expect(readsSwitchedState(tree)).toBe(true)
  })

  it('⛔ the window alone still refuses it, and the reset gate is what admits it', () => {
    expect(forgetsItsSeed(acc.args[1], TABLE, W)).toBe(false)
    expect(forgetsOnReset(acc.args[1], TABLE)).toBe(true)
  })

  const self = { type: 'series', name: 'self' }
  const close = { type: 'series', name: 'close' }
  const num = (value) => ({ type: 'num', value })
  const op = (name, ...args) => ({ type: 'op', name, args })
  const up = op('>', close, { type: 'offset', value: 1, args: [close] })

  it.each([
    ['no reset arm at all (a running total)', op('+', self, num(1))],
    ['the latch-once — its condition reads the state', op('?:', { type: 'call', name: 'na', args: [self] }, close, self)],
    ['a condition that reads the state', op('?:', op('>', self, num(3)), num(0), op('+', self, num(1)))],
    ['a lagged read of the state', op('?:', up, op('+', { type: 'offset', value: 1, args: [self] }, num(1)), num(0))],
  ])('⛔ refuses: %s', (_name, body) => {
    expect(forgetsOnReset(body, TABLE)).toBe(false)
  })

  it('⭐ a reset through a NESTED ternary is still a reset', () => {
    expect(forgetsOnReset(op('?:', up, op('?:', op('>', close, num(105)), op('+', self, num(2)), num(0)), op('+', self, num(1))), TABLE)).toBe(true)
  })

  it('⛔ the translator still refuses a counter that never resets', () => {
    const t = translatePine(pine(['var int n = 0', 'n := n + 1', 'plot(n)']))
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe('pine:state')
  })
})

describe('2 · exact — every published bar is Pine\'s, under ANY seed', () => {
  const col = run(treeOf(SRC))

  it('⭐ published bars equal Pine\'s count, and do not move with the seed', () => {
    const known = col.map((v) => !Number.isNaN(v))
    expect(known.filter(Boolean).length).toBeGreaterThan(N * 0.8) // non-vacuity
    for (const seed of [0, 7, -3, 1e6]) {
      const ref = pineCount(seed)
      for (let i = 0; i < N; i++) if (known[i]) expect(col[i], `bar ${i} seed ${seed}`).toBe(ref[i])
    }
  })

  it('⭐ withheld EXACTLY where the 250-bar window holds no reset, and nowhere else', () => {
    const inWin = resetInWindow(W)
    for (let i = 0; i < N; i++) expect(Number.isNaN(col[i]), `bar ${i}`).toBe(!inWin[i])
    // the 80-bar plateau stays inside 250, so here nothing is withheld; the short
    // window below is where a streak outlives it
    expect(inWin.every(Boolean)).toBe(true)
  })

  it('⭐ …and a streak that outlives the window is withheld, keyed on the data, not the bar number', () => {
    const body = findAccum(treeOf(SRC)).args[1]
    const short = { type: 'call', name: 'accum', args: [switchedVarSeed({ type: 'num', value: 0 }), body, { type: 'num', value: 20 }] }
    const c = run(short)
    const inWin = resetInWindow(20)
    const ref = pineCount(0)
    let withheld = 0
    for (let i = 0; i < N; i++) {
      if (inWin[i]) expect(c[i], `bar ${i}`).toBe(ref[i])
      else { expect(Number.isNaN(c[i]), `bar ${i}`).toBe(true); withheld += 1 }
    }
    // the plateau (bars 300..379) outlives a 20-bar window from bar 320 on
    expect(withheld).toBeGreaterThanOrEqual(60)
    // ⛔ CONTROL: the unmarked seed is the bounded window — it answers a count
    // over the last 20 bars there, a number Pine never shows
    const bounded = run({ ...short, args: [{ type: 'num', value: 0 }, body, { type: 'num', value: 20 }] })
    expect(bounded[350]).toBe(20)
    expect(ref[350]).toBeGreaterThan(20)
  })

  it('⭐ a bar below the warm-up is published when its reset lies inside the data', () => {
    expect(col[5]).toBe(pineCount(0)[5])
    expect(Number.isNaN(col[5])).toBe(false)
  })
})

describe('3 · composes — listing, the probe, and the root agreement', () => {
  const tree = treeOf(SRC)

  it('⭐ C12w: from the listing every published bar is Pine\'s, and never less known than the curtain', () => {
    const src = pine(['var int n = 5', 'n := close > close[1] ? n + 1 : 0', 'plot(n)'])
    const tree5 = treeOf(src)
    const listed = run(tree5, { historyFromListing: true })
    const curtain = run(tree5)
    const ref = pineCount(5)
    let published = 0
    for (let i = 0; i < N; i++) {
      if (!Number.isNaN(listed[i])) { expect(listed[i], `bar ${i}`).toBe(ref[i]); published += 1 }
      if (!Number.isNaN(curtain[i])) expect(Number.isNaN(listed[i]), `bar ${i}`).toBe(false)
    }
    // bar 0 is C12w's documented withheld bar (the tree cannot tell a `var`
    // from the self-reference spelling there); every later bar is Pine's
    expect(published).toBeGreaterThanOrEqual(N - 1)
  })

  it('⭐ C12w: a counter whose seed IS observable is exact from the listing where the curtain withholds', () => {
    // bar 0 counts up from the seed (the condition is true there), so the curtain
    // cannot know bars 0..k before the first reset; the listing seed can
    const cond = (i) => i === 0 || CLOSE[i] > CLOSE[i - 1]
    const src = pine(['var int n = 5', 'n := (bar_index == 0 or close > close[1]) ? n + 1 : 0', 'plot(n)'])
    const tree5 = treeOf(src)
    const listed = run(tree5, { historyFromListing: true })
    const curtain = run(tree5)
    const ref = pineCount(5, cond)
    for (let i = 0; i < N; i++) if (!Number.isNaN(listed[i])) expect(listed[i], `bar ${i}`).toBe(ref[i])
    expect(Number.isNaN(curtain[0])).toBe(true)
  })

  it('⭐ the probe fills exactly the withheld bars (so `unknownMask` sees them)', () => {
    const body = findAccum(tree).args[1]
    const short = { type: 'call', name: 'accum', args: [switchedVarSeed({ type: 'num', value: 0 }), body, { type: 'num', value: 20 }] }
    const real = run(short)
    const probed = run(short, { prefixProbe: PREFIX_PROBE })
    for (let i = 0; i < N; i++) {
      if (Number.isNaN(real[i])) expect(probed[i]).toBe(PREFIX_PROBE)
      else expect(probed[i]).toBe(real[i])
    }
  })

  it('⭐ ROOT AGREEMENT: `n == 4` is withheld where `n` is unknown — never a confident 0', () => {
    const body = findAccum(tree).args[1]
    const short = { type: 'call', name: 'accum', args: [switchedVarSeed({ type: 'num', value: 0 }), body, { type: 'num', value: 20 }] }
    const eq = { type: 'op', name: '==', args: [short, { type: 'num', value: 4 }] }
    const c = run(eq)
    const n = run(short)
    for (let i = 0; i < N; i++) {
      if (Number.isNaN(n[i])) expect(Number.isNaN(c[i]), `bar ${i}`).toBe(true)
      else expect(c[i], `bar ${i}`).toBe(n[i] === 4 ? 1 : 0)
    }
    // ⛔ CONTROL: without the agreement the unknown bars read a confident 0
    const raw = run(eq, { switchedAgreement: false })
    expect(raw.some((v, i) => Number.isNaN(n[i]) && v === 0)).toBe(true)
  })

  it('⭐ `na(n)` — a confident TRUE without the agreement — is withheld too', () => {
    const body = findAccum(tree).args[1]
    const short = { type: 'call', name: 'accum', args: [switchedVarSeed({ type: 'num', value: 0 }), body, { type: 'num', value: 20 }] }
    const isNa = { type: 'call', name: 'na', args: [short] }
    const c = run(isNa)
    const n = run(short)
    for (let i = 0; i < N; i++) if (Number.isNaN(n[i])) expect(Number.isNaN(c[i]), `bar ${i}`).toBe(true)
  })

  it('⛔ a tree with no switched recurrence takes ONE pass, byte for byte as before', () => {
    const plain = { type: 'op', name: '+', args: [{ type: 'series', name: 'close' }, { type: 'num', value: 1 }] }
    expect(readsSwitchedState(plain)).toBe(false)
    expect(run(plain)).toEqual(run(plain, { switchedAgreement: false }))
  })
})

describe('4 · a condition that is not computable picks no arm', () => {
  it('⭐ a `NaN` condition leaves the state unknown until the next real reset', () => {
    // `(sma(close,10) - sma(close,10) + 1) && up` is NaN for bars 0..8
    const close = { type: 'series', name: 'close' }
    const sma = { type: 'call', name: 'sma', args: [close, { type: 'num', value: 10 }] }
    const one = { type: 'op', name: '+', args: [{ type: 'op', name: '-', args: [sma, sma] }, { type: 'num', value: 1 }] }
    const up = { type: 'op', name: '>', args: [close, { type: 'offset', value: 1, args: [close] }] }
    const cond = { type: 'op', name: '&&', args: [one, up] }
    const body = { type: 'op', name: '?:', args: [cond, { type: 'op', name: '+', args: [{ type: 'series', name: 'self' }, { type: 'num', value: 1 }] }, { type: 'num', value: 0 }] }
    const acc = { type: 'call', name: 'accum', args: [switchedVarSeed({ type: 'num', value: 0 }), body, { type: 'num', value: 250 }] }
    const c = run(acc)
    for (let i = 0; i < 9; i++) expect(Number.isNaN(c[i]), `bar ${i}`).toBe(true)
    // after bar 9 the first falling bar resets it, and from there it is Pine's
    const firstReset = CLOSE.findIndex((x, i) => i >= 9 && !(x > CLOSE[i - 1]))
    let n = 0
    for (let i = firstReset; i < 60; i++) {
      n = CLOSE[i] > CLOSE[i - 1] && i !== firstReset ? n + 1 : 0
      expect(c[i], `bar ${i}`).toBe(n)
    }
  })
})

describe('5 · parity with the Python lane — one fixture, both lanes', () => {
  const PARITY = JSON.parse(readFileSync('../tests/fixtures/ast/switched_counter_parity.json', 'utf8'))
  const bars = Array.from({ length: PARITY.bars }, (_, i) => {
    const c = 100 + Math.sin(i / 9) * 8 + i * 0.06
    return { o: c - 0.3, h: c + 0.8, l: c - 0.8, c, v: 100000 }
  })

  it.each(PARITY.cases.map((c) => [c.name, c]))('⭐ %s — this lane reproduces the fixture', (_name, c) => {
    const got = Array.from(interpret(c.ast, bars, {}, undefined, undefined, c.opts || undefined))
      .map((x) => (Number.isNaN(x) ? null : x))
    expect(got).toEqual(c.expected)
  })

  it('⛔ the fixture is not vacuous: it holds known bars, withheld bars, and both 0 and 1 answers', () => {
    const counter = PARITY.cases.find((c) => c.name === 'counter-w20').expected
    expect(counter.filter((v) => v === null).length).toBeGreaterThan(10)
    expect(counter.filter((v) => v !== null).length).toBeGreaterThan(200)
    const eq = PARITY.cases.find((c) => c.name === 'counter-eq-4').expected
    expect(eq).toContain(1)
    expect(eq).toContain(0)
    expect(eq).toContain(null)
  })
})
