// ─── ⭐⭐ H1 — A RATCHET: a switched recurrence whose reset test reads its own state ─
//
// Every supertrend and ATR trailing stop writes
//
//     up  = <band>
//     up1 = nz(up[1], up)
//     up := close[1] > up1 ? math.max(up, up1) : up
//
// The `: up` arm forgets the seed (a fresh band), but the TEST that picks it reads
// the stop, so from an unknown state C12s's single abstract value cannot say which
// arm runs and `forgetsOnReset` refused it (`pine:state`). H1 admits a test whose
// every state read is one side of an ORDERING comparison against something that
// MOVES with the bars, and `interpret.js` decides it with the RANGE window
// (`RANGE_TOP`): a run that enters a bar knowing nothing narrows, test by test, until
// every earlier history gives one value — and only then is the bar published.
//
//   1. THE GATE — what is admitted now, and what still refuses.
//   2. EXACT — every published bar equals a hand-written Pine replay under EVERY seed
//      Pine could have entered with (na, far below, far above, inside the range).
//   3. WITHHELD where it must be — a flat close never squeezes the state.
//   4. COMPOSES — from the listing (C12w) it is Pine's on every bar, and a tree that
//      reads it is withheld where it is (the root agreement).
//   5. COST — the descending pass stays near one range step per bar.
//   6. PARITY — `tests/fixtures/ast/ratchet_parity.json`, read by both lanes.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { translatePine, forgetsOnReset } from './pine.js'
import { interpret, switchedSeedOf } from './interpret.js'
import { TABLE } from './parse.js'

const N = 400
// trends of ~25 bars with pullbacks, so stops ratchet and then get crossed
const CLOSE = Array.from({ length: N }, (_, i) => 100 + 12 * Math.sin(i / 8) + 4 * Math.sin(i / 2.3) + i * 0.05)
const BARS = CLOSE.map((c, i) => ({ t: 1700000000 + i * 86400, o: c, h: c + 1, l: c - 1, c, v: 1000 }))
const run = (ast, bars = BARS, opts) => Array.from(interpret(ast, bars, {}, undefined, undefined, opts))
const pine = (lines) => ['//@version=5', 'indicator("ratchet")', ...lines].join('\n')
const treeOf = (src) => {
  const t = translatePine(src)
  if (!t.ok) throw new Error(`refused: ${JSON.stringify(t.refusal).slice(0, 300)}`)
  return (t.outputs || []).find((o) => o && o.ast).ast
}
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

const UP = pine(['band = close - 2', 'up = band', 'up1 = nz(up[1], up)', 'up := close[1] > up1 ? math.max(up, up1) : up', 'plot(up)'])
const DN = pine(['band = close + 2', 'dn = band', 'dn1 = nz(dn[1], dn)', 'dn := close[1] < dn1 ? math.min(dn, dn1) : dn', 'plot(dn)'])

/** Pine's own stop, from bar 0, entering bar 0 with `seed` (NaN = Pine's na) after
 *  a bar that closed at `before` — the bar behind the curtain, which this engine
 *  does not hold (NaN = there was none: the listing). */
const pineStop = (closes, seed, side = 'up', before = NaN) => {
  const out = []
  let prev = seed
  for (let i = 0; i < closes.length; i++) {
    const band = side === 'up' ? closes[i] - 2 : closes[i] + 2
    const p = Number.isNaN(prev) ? band : prev
    const c1 = i > 0 ? closes[i - 1] : before
    const hit = side === 'up' ? c1 > p : c1 < p // `na` compares false
    prev = hit ? (side === 'up' ? Math.max(band, p) : Math.min(band, p)) : band
    out.push(prev)
  }
  return out
}
const SEEDS = [NaN, -1e6, 1e6, 95, 100, 105, 110, 120]
const BEFORE = [NaN, -1e6, 1e6, 99, 101]
/** Every history the curtain hides: each seed after each prior close. */
const histories = (closes, side) => SEEDS.flatMap((s) => BEFORE.map((b) => pineStop(closes, s, side, b)))

describe('1 · the gate — `forgetsOnReset` admits a ratchet', () => {
  const self = { type: 'series', name: 'self' }
  const close = { type: 'series', name: 'close' }
  const prev = { type: 'offset', value: 1, args: [close] }
  const num = (value) => ({ type: 'num', value })
  const op = (name, ...args) => ({ type: 'op', name, args })
  const call = (name, ...args) => ({ type: 'call', name, args })
  const band = op('-', close, num(2))
  const nzSelf = call('nz', self, band)

  it('⭐ the translated stop is a SWITCHED accumulator', () => {
    const acc = findAccum(treeOf(UP))
    expect(acc).toBeTruthy()
    expect(switchedSeedOf(acc.args[0])).toBeTruthy()
    expect(forgetsOnReset(acc.args[1], TABLE)).toBe(true)
  })

  it.each([
    ['bare `self` against a moving price', op('?:', op('>', prev, self), call('max', band, self), band)],
    ['`nz(self, band)` against a moving price', op('?:', op('>', prev, nzSelf), call('max', band, nzSelf), band)],
    ['the state on the LEFT of the test', op('?:', op('<', nzSelf, prev), call('max', band, nzSelf), band)],
    ['two ordering tests joined by `and`', op('?:', op('&&', op('>', prev, nzSelf), op('>', close, nzSelf)), call('max', band, nzSelf), band)],
    ['a negated ordering test', op('?:', op('!', op('<=', prev, nzSelf)), call('max', band, nzSelf), band)],
  ])('⭐ admits: %s', (_n, body) => {
    expect(forgetsOnReset(body, TABLE)).toBe(true)
  })

  it.each([
    ['a CONSTANT threshold (never moved by the data)', op('?:', op('>', self, num(3)), num(0), op('+', self, num(1)))],
    ['the latch-once `na(self)`', op('?:', call('na', self), close, self)],
    ['an EQUALITY test on the state', op('?:', op('==', self, close), band, op('+', self, num(1)))],
    ['the state inside arithmetic in the test', op('?:', op('>', prev, op('*', self, num(1.01))), call('max', band, self), band)],
    ['no reset arm at all', op('?:', op('>', prev, self), call('max', band, self), self)],
  ])('⛔ still refuses: %s', (_n, body) => {
    expect(forgetsOnReset(body, TABLE)).toBe(false)
  })

  it('⛔ the translator still refuses a running max with no reset', () => {
    const t = translatePine(pine(['var float m = na', 'm := math.max(nz(m, close), close)', 'plot(m)']))
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe('pine:state')
  })
})

describe('2 · exact — every published bar is Pine\'s under EVERY seed', () => {
  it.each([['up', UP], ['dn', DN]])('⭐ the %s stop', (side, src) => {
    const col = run(treeOf(src))
    const refs = histories(CLOSE, side)
    let published = 0
    for (let i = 0; i < N; i++) {
      if (Number.isNaN(col[i])) continue
      published += 1
      for (const r of refs) expect(col[i], `bar ${i}`).toBeCloseTo(r[i], 9)
    }
    expect(published).toBeGreaterThan(N * 0.8) // non-vacuity: most bars are decided
    // bar 0 reads `close[1]` from behind the curtain: it is never decided there
    expect(Number.isNaN(col[0])).toBe(true)
  })

  it('⛔ control: the seeds DO disagree on the withheld bars — the withholding is not decoration', () => {
    const col = run(treeOf(UP))
    const refs = histories(CLOSE, 'up')
    const disagreeing = col.map((v, i) => Number.isNaN(v) && refs.some((r) => Math.abs(r[i] - refs[0][i]) > 1e-9))
    expect(disagreeing.filter(Boolean).length).toBeGreaterThan(0)
  })
})

describe('3 · withheld exactly where the data never decides it', () => {
  it('⛔ a flat close never squeezes the state: every bar is withheld', () => {
    const flat = Array.from({ length: 120 }, (_, i) => ({ t: 1700000000 + i * 86400, o: 100, h: 101, l: 99, c: 100, v: 1 }))
    const col = run(treeOf(UP), flat)
    expect(col.every(Number.isNaN)).toBe(true)
    // …because histories really do disagree there: 98 (from `na`) vs 99 kept forever
    const c = flat.map((b) => b.c)
    expect(pineStop(c, NaN, 'up', 101)[100]).toBe(98)
    expect(pineStop(c, 99, 'up', 101)[100]).toBe(99)
  })
})

describe('4 · composes', () => {
  it('⭐ from the listing (C12w) the stop is Pine\'s on every bar', () => {
    const col = run(treeOf(UP), BARS, { historyFromListing: true })
    const ref = pineStop(CLOSE, NaN)
    // ⚠️ bar 0 is the one C12w leaves open: the tree does not record whether bar 0
    // IS the seed or runs the update from it, the two readings disagree there, and
    // the bar falls back to the curtain column — which does not decide it either.
    expect(Number.isNaN(col[0])).toBe(true)
    for (let i = 1; i < N; i++) expect(col[i], `bar ${i}`).toBeCloseTo(ref[i], 9)
  })

  it('⭐ a tree that reads the stop is withheld where the stop is, and Pine\'s elsewhere', () => {
    const src = UP.replace('plot(up)', 'plot(close > up + 1.5 ? 1 : 0)')
    const stop = run(treeOf(UP))
    const col = run(treeOf(src))
    const ref = pineStop(CLOSE, NaN)
    let decided = 0
    for (let i = 0; i < N; i++) {
      if (Number.isNaN(stop[i])) { expect(Number.isNaN(col[i]), `bar ${i}`).toBe(true); continue }
      if (Number.isNaN(col[i])) continue
      decided += 1
      expect(col[i], `bar ${i}`).toBe(CLOSE[i] > ref[i] + 1.5 ? 1 : 0)
    }
    expect(decided).toBeGreaterThan(N * 0.5)
  })
})

describe('5 · cost — the descending pass stays near one range step per bar', () => {
  it('⭐ a run that meets a later run\'s state borrows its answer', () => {
    const sink = []
    run(treeOf(UP), BARS, { stepSink: sink })
    const rec = sink.find((r) => r.switched && r.switched.ranged)
    expect(rec).toBeTruthy()
    expect(rec.switched.rangeSteps).toBeGreaterThanOrEqual(N)
    expect(rec.switched.rangeSteps).toBeLessThan(N * 8)
  })
})

describe('6 · parity with the Python lane — one fixture, both lanes', () => {
  const FIXTURE = '../tests/fixtures/ast/ratchet_parity.json'
  const barsOf = (n) => Array.from({ length: n }, (_, i) => {
    const c = 100 + Math.sin(i / 9) * 8 + i * 0.06 + 3 * Math.sin(i / 2.7)
    return { o: c - 0.3, h: c + 0.8, l: c - 0.8, c, v: 100000 }
  })
  const CASES = () => [
    { name: 'ratchet-up', ast: findAccum(treeOf(UP)) },
    { name: 'ratchet-dn', ast: findAccum(treeOf(DN)) },
    { name: 'ratchet-reader', ast: treeOf(UP.replace('plot(up)', 'plot(close > up + 1.5 ? 1 : 0)')) },
    { name: 'ratchet-probe', ast: findAccum(treeOf(UP)), opts: { prefixProbe: 1e12 } },
  ]
  if (process.env.H1_RATCHET_WRITE) {
    const bars = barsOf(300)
    const doc = {
      _: 'H1 - a RATCHET (a switched recurrence whose reset test reads its own state) and the columns BOTH lanes must produce. Read by ratchetRecurrence.test.js and tests/test_ast_ratchet_parity.py; regenerate with H1_RATCHET_WRITE=1, never by hand.',
      _bars: 'close = 100 + sin(i/9)*8 + i*0.06 + 3*sin(i/2.7) over 300 bars; o=c-0.3 h=c+0.8 l=c-0.8 v=100000',
      bars: 300,
      cases: CASES().map((c) => ({ ...c, expected: Array.from(interpret(c.ast, bars, {}, undefined, undefined, c.opts)).map((x) => (Number.isNaN(x) ? null : x)) })),
    }
    fs.writeFileSync(FIXTURE, JSON.stringify(doc, null, 1) + '\n')
  }
  const PARITY = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
  const bars = barsOf(PARITY.bars)

  it.each(PARITY.cases.map((c) => [c.name, c]))('⭐ %s — this lane reproduces the fixture', (_name, c) => {
    const got = Array.from(interpret(c.ast, bars, {}, undefined, undefined, c.opts || undefined))
      .map((x) => (Number.isNaN(x) ? null : x))
    expect(got).toEqual(c.expected)
  })

  it('⭐ the fixture is what the translator builds today, not a stale tree', () => {
    const now = CASES()
    for (const c of PARITY.cases) expect(c.ast, c.name).toEqual(now.find((x) => x.name === c.name).ast)
  })

  it('⛔ the fixture is not vacuous: decided bars, withheld bars, both answers of the reader', () => {
    const up = PARITY.cases.find((c) => c.name === 'ratchet-up').expected
    expect(up.filter((v) => v === null).length).toBeGreaterThan(0)
    expect(up.filter((v) => v !== null).length).toBeGreaterThan(200)
    const reader = PARITY.cases.find((c) => c.name === 'ratchet-reader').expected
    expect(reader).toContain(1)
    expect(reader).toContain(0)
    expect(PARITY.cases.find((c) => c.name === 'ratchet-probe').expected).toContain(1e12)
  })
})
