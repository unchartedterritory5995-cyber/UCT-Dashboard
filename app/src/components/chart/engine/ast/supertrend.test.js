// ⭐⭐ SUPERTREND — the first expansion that carries bar-to-bar state.
//
// `callExpansions.js::supertrendTrees` writes TradingView's `ta.supertrend(factor, n)`
// as three bounded `accum` recurrences. These rails prove the three things that make
// that admissible rather than a look-alike:
//   1. it AGREES with an independent full-history implementation of Pine's published
//      source on every bar it publishes (the differential below — written from the
//      Pine reference, not from the expansion);
//   2. a published value does NOT depend on how many bars were fetched (bounded);
//   3. nothing is published before the bands it reads exist (the withheld edge).
import { describe, it, expect } from 'vitest'
import { parseFormula, RECURRENCES, vendorNotesForTree } from './parse.js'
import { OUTCOME } from './importOutcome.js'
import { inspectSource } from '../../builder/PineBox.jsx'
import { interpret } from './interpret.js'
import {
  expandCall, recogniseExpansion, supertrendTrees, SUPERTREND_WARMUP, ACCUM_SELF, expandedSize,
  MAX_EXPANDED_NODES, SUPERTREND_NOTE,
} from './callExpansions.js'
import { slotsOfTree } from '../../builder/authoring/slots.js'

const W = SUPERTREND_WARMUP

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) }
/** A trending, mean-reverting random walk — trends long enough to ratchet, swings
 *  large enough to flip, on every seed. */
function walk(n, seed) {
  const r = rng(seed)
  let c = 100
  const out = []
  for (let i = 0; i < n; i += 1) {
    const o = c
    c = Math.max(1, c * (1 + (r() - 0.5) * 0.04 + Math.sin(i / 40) * 0.004))
    const h = Math.max(o, c) * (1 + r() * 0.01)
    const l = Math.min(o, c) * (1 - r() * 0.01)
    out.push({ t: 1700000000 + i * 86400, o, h, l, c, v: 1e6 })
  }
  return out
}

/** Pine v5's published `ta.supertrend`, line for line, over the WHOLE series:
 *  `ta.atr` = rma of `ta.tr(true)`, `nz(band[1])` seeding, and the direction read off
 *  `prevSuperTrend == prevUpperBand`. Deliberately NOT built from the expansion. */
function pineSupertrend(bars, factor, n) {
  const N = bars.length
  const atr = new Array(N).fill(NaN)
  let sum = 0
  for (let i = 0; i < N; i += 1) {
    const b = bars[i]
    const tr = i === 0 ? b.h - b.l
      : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c))
    if (i < n - 1) { sum += tr; continue }
    if (i === n - 1) { sum += tr; atr[i] = sum / n } else atr[i] = (atr[i - 1] * (n - 1) + tr) / n
  }
  const value = new Array(N).fill(NaN)
  const dir = new Array(N).fill(NaN)
  let pU = NaN
  let pL = NaN
  let pST = NaN
  for (let i = 0; i < N; i += 1) {
    const src = (bars[i].h + bars[i].l) / 2
    let U = src + factor * atr[i]
    let L = src - factor * atr[i]
    const pl = Number.isNaN(pL) ? 0 : pL
    const pu = Number.isNaN(pU) ? 0 : pU
    const c1 = i > 0 ? bars[i - 1].c : NaN
    L = (L > pl || c1 < pl) ? L : pl
    U = (U < pu || c1 > pu) ? U : pu
    let d
    if (i === 0 || Number.isNaN(atr[i - 1])) d = 1
    else if (pST === pU) d = bars[i].c > U ? -1 : 1
    else d = bars[i].c < L ? 1 : -1
    value[i] = d === -1 ? L : U
    dir[i] = d
    pU = U; pL = L; pST = value[i]
  }
  return { value, dir }
}

const col = (source, bars, opts) => {
  const r = parseFormula(source)
  expect(r.ok, `${source}: ${r.error}`).toBe(true)
  return Array.from(interpret(r.ast, bars, {}, undefined, undefined, opts))
}
const LISTING = { historyFromListing: true }

describe('supertrend — the expansion is the manifest\'s own recurrence', () => {
  it('reads its own previous value through the name the manifest declares', () => {
    expect(ACCUM_SELF).toBe(RECURRENCES.accum.binds)
  })

  it('a typed `supertrend(3, 10)` IS the expansion, and reads back by name', () => {
    const typed = parseFormula('supertrend(3, 10)')
    expect(typed.ok).toBe(true)
    expect(typed.ast).toEqual(expandCall({ type: 'call', name: 'supertrend', args: [{ type: 'num', value: 3 }, { type: 'num', value: 10 }] }))
    expect(recogniseExpansion(typed.ast)).toEqual({ name: 'supertrend', args: [{ type: 'num', value: 3 }, { type: 'num', value: 10 }] })
    const dir = parseFormula('supertrendDirection(2.5, 7)')
    expect(recogniseExpansion(dir.ast)).toEqual({ name: 'supertrendDirection', args: [{ type: 'num', value: 2.5 }, { type: 'num', value: 7 }] })
  })

  it('declines anything but a positive number factor and a whole-number period', () => {
    const num = (value) => ({ type: 'num', value })
    for (const [f, n] of [[num(0), num(10)], [num(-1), num(10)], [num(3), num(0)], [num(3), num(2.5)],
      [{ type: 'series', name: 'len' }, num(10)], [num(3), { type: 'series', name: 'len' }]]) {
      expect(supertrendTrees(f, n)).toBeNull()
    }
    const bad = parseFormula('supertrend(3, len)')
    expect(bad.ok).toBe(false)
    expect(bad.guard).toBe('resolve:expansion')
    expect(bad.error).toMatch(/positive factor and a whole-number ATR period/)
  })

  it('its stored expansion names the same two slots as the call the model writes', () => {
    // The authoring door computes slot ids on the COLLAPSED tree (`slots.js`), and
    // the server's reference check walks the call the model wrote — so the factor is
    // `st#0` and the period `st#1` either way (`slotIdCases.json` pins the server half).
    const stored = parseFormula('supertrend(3, 10)').ast
    expect(slotsOfTree('st', stored).map((s) => s.id)).toEqual(['st#0', 'st#1'])
  })

  it('is small enough to compose (well under the expansion cap)', () => {
    const t = parseFormula('supertrend(3, 10) - supertrend(2, 20)').ast
    expect(expandedSize(t, MAX_EXPANDED_NODES)).toBeLessThan(MAX_EXPANDED_NODES)
  })
})

describe('supertrend — agrees with Pine\'s published source on every bar it publishes', () => {
  // ⭐ THE DIFFERENTIAL: a full-history reference that never heard of `accum`.
  it.each([[3, 10], [2, 7], [4, 20]])('factor %s, ATR %s — 0 differing bars', (factor, n) => {
    let compared = 0
    const differing = []
    for (let seed = 1; seed <= 12; seed += 1) {
      const bars = walk(1600, seed)
      const ref = pineSupertrend(bars, factor, n)
      const value = col(`supertrend(${factor}, ${n})`, bars)
      const dir = col(`supertrendDirection(${factor}, ${n})`, bars)
      for (let i = 0; i < bars.length; i += 1) {
        expect(Number.isFinite(value[i]), `seed ${seed} bar ${i}: value and direction publish together`).toBe(Number.isFinite(dir[i]))
        if (!Number.isFinite(value[i])) continue
        compared += 1
        if (Math.abs(value[i] - ref.value[i]) > 1e-9 * Math.abs(ref.value[i]) || dir[i] !== ref.dir[i]) {
          differing.push({ seed, i, ours: value[i], pine: ref.value[i], dir: dir[i], pineDir: ref.dir[i] })
        }
      }
    }
    // non-vacuity: most of every series is published, so "0 differ" is a real claim
    expect(compared).toBeGreaterThan(12 * 1000)
    expect(differing.slice(0, 5)).toEqual([])
  })

  it('the direction is only ever −1 or 1, and picks the band the line sits on', () => {
    const bars = walk(1200, 99)
    const value = col('supertrend(3, 10)', bars)
    const dir = col('supertrendDirection(3, 10)', bars)
    const ups = dir.filter((d) => d === -1).length
    const downs = dir.filter((d) => d === 1).length
    expect(ups).toBeGreaterThan(50)
    expect(downs).toBeGreaterThan(50)
    for (let i = 0; i < bars.length; i += 1) {
      if (!Number.isFinite(value[i])) continue
      expect([-1, 1]).toContain(dir[i])
      // an up-trend line is at or below the close (a close under it would have flipped
      // the trend), a down-trend one at or above it
      if (dir[i] === -1) expect(value[i]).toBeLessThanOrEqual(bars[i].c + 1e-9)
      else expect(value[i]).toBeGreaterThanOrEqual(bars[i].c - 1e-9)
    }
  })
})

describe('supertrend — disclosed, never labelled exact', () => {
  // ⛔ It is the one expansion that is a bounded recurrence rather than an exact
  // identity, so wherever vendor notes are read it says so — and an import of
  // `ta.supertrend` reads "with disclosed differences", not "Exact import".
  it('the stored tree carries the note, found by shape (the call name is gone)', () => {
    const notes = vendorNotesForTree(parseFormula('close > supertrend(3, 10)').ast)
    expect(notes.map((n) => n.name)).toContain('supertrend')
    expect(notes.find((n) => n.name === 'supertrend').note).toBe(SUPERTREND_NOTE)
    expect(SUPERTREND_NOTE).toMatch(/can differ/)
    expect(vendorNotesForTree(parseFormula('supertrendDirection(2, 7) == -1').ast).map((n) => n.name))
      .toContain('supertrendDirection')
  })

  it('an ordinary formula carries no supertrend note (non-vacuity)', () => {
    const notes = vendorNotesForTree(parseFormula('close > open ? close : na').ast)
    expect(notes.map((n) => n.name)).not.toContain('supertrend')
  })

  it('a Pine `ta.supertrend` import is DISCLOSED, with the sentence', () => {
    const r = inspectSource('//@version=5\nindicator("ST", overlay=true)\n[st, dir] = ta.supertrend(3, 10)\nplot(st)\n')
    expect(r.outcome.verdict).toBe(OUTCOME.DISCLOSED)
    expect(r.outcome.semantic.map((s) => s.note)).toContain(SUPERTREND_NOTE)
  })
})

describe('supertrend — bounded: a value is the same whatever was fetched', () => {
  it('dropping the first 400 bars changes no published value', () => {
    const bars = walk(1800, 7)
    const whole = col('supertrend(3, 10)', bars)
    const tail = col('supertrend(3, 10)', bars.slice(400))
    let both = 0
    for (let j = 0; j < tail.length; j += 1) {
      if (!Number.isFinite(tail[j])) continue
      both += 1
      expect(tail[j], `bar ${j + 400}`).toBe(whole[j + 400])
    }
    expect(both).toBeGreaterThan(900)
  })

  it('publishes nothing until both bands were known W bars earlier', () => {
    const bars = walk(1000, 3)
    const value = col('supertrend(3, 10)', bars)
    const first = value.findIndex(Number.isFinite)
    // the bands need the ATR (n bars) and their own W-bar window; the direction needs W more
    expect(first).toBeGreaterThanOrEqual(2 * W)
    expect(first).toBeLessThanOrEqual(2 * W + 10)
    expect(value.slice(0, first).every(Number.isNaN)).toBe(true)
  })

  it('a series shorter than the warm-up publishes nothing rather than a guess', () => {
    const value = col('supertrend(3, 10)', walk(2 * W, 11))
    expect(value.every(Number.isNaN)).toBe(true)
  })
})

// ─── ⭐⭐ ENGINE 57 — FROM THE LISTING ────────────────────────────────────────────────
// Every rail above runs OFF the listing (`opts` without `historyFromListing`), which is why
// none of them saw the defect: from the listing the listing pass runs the recurrences from
// bar 0, where the raw band seed is `na` (the ATR's warm-up), and a ratchet with no `nz`
// held that `na` forever — the builtin Supertrend drew NOTHING on all 666 bars of the S6
// NYSE:RDDT 1D capture. Pine's own `nz(band[1])` seeds and `na(atr[1]) ? 1` arm fix it, and
// the guard (a bounded window's own curtain, `2W` deep) lifts on the listing.
describe("supertrend — from the listing (engine 57: Pine's `nz` seeds)", () => {
  it.each([[3, 10], [2, 7], [4, 20]])("factor %s, ATR %s — every bar equals Pine's full history, from bar 0", (factor, n) => {
    let compared = 0
    const differing = []
    for (let seed = 1; seed <= 6; seed += 1) {
      const bars = walk(1000, seed)
      const ref = pineSupertrend(bars, factor, n)
      const value = col(`supertrend(${factor}, ${n})`, bars, LISTING)
      const dir = col(`supertrendDirection(${factor}, ${n})`, bars, LISTING)
      for (let i = 0; i < bars.length; i += 1) {
        // the direction is known on every bar; the value is `na` exactly where Pine's is
        // (bars 1..n-2: the upper band during the ATR warm-up)
        expect(dir[i], `seed ${seed} bar ${i} direction`).toBe(ref.dir[i])
        if (Number.isNaN(ref.value[i])) { expect(Number.isNaN(value[i]), `seed ${seed} bar ${i}`).toBe(true); continue }
        compared += 1
        if (!(Math.abs(value[i] - ref.value[i]) <= 1e-9 * Math.abs(ref.value[i]))) {
          differing.push({ seed, i, ours: value[i], pine: ref.value[i] })
        }
      }
      expect(ref.value.slice(1, n - 1).every(Number.isNaN)).toBe(true)
    }
    expect(compared).toBeGreaterThan(6 * 980)
    expect(differing.slice(0, 5)).toEqual([])
  })

  it('wherever the off-listing replay draws, the listing replay draws the same number', () => {
    const bars = walk(1200, 21)
    for (const f of ['supertrend(3, 10)', 'supertrendDirection(3, 10)']) {
      const off = col(f, bars)
      const on = col(f, bars, LISTING)
      let drawnOff = 0
      for (let i = 0; i < bars.length; i += 1) {
        if (!Number.isFinite(off[i])) continue
        drawnOff += 1
        expect(on[i], `${f} bar ${i}`).toBe(off[i])
      }
      expect(drawnOff).toBeGreaterThan(700)
      expect(on.filter(Number.isFinite).length).toBeGreaterThan(bars.length - 10)
    }
  })

  it("the stored tree carries Pine's `nz(band[1])` and `na(atr[1])` arm (the shape the listing needs)", () => {
    const t = supertrendTrees({ type: 'num', value: 3 }, { type: 'num', value: 10 })
    // the direction recurrence itself (under the guard), which reads each band once
    expect(t.direction.type === 'op' && t.direction.name === '?:').toBe(true)
    const json = JSON.stringify(t.direction.args[2])
    // both bands are seeded `nz(band, 0)` and read their previous value as `nz(self, 0)`
    expect(json.match(/"name":"nz","args":\[\{"type":"series","name":"self"\},\{"type":"num","value":0\}\]/g).length).toBe(6)
    expect(json).toMatch(/"name":"na","args":\[\{"type":"offset","value":1,"args":\[\{"type":"call","name":"atrPine"/)
  })

  // ⭐⭐ REVIEW F2 — THE CONTROL IS THE BASE TREE, VERBATIM (`git show ec72c19913:…/callExpansions.js`,
  // engine 54), never the old guard rebuilt over the NEW bands: that compared the new guard with
  // itself. The base seeds were raw bands, `na` through the ATR's `n - 1` warm-up bars, so its
  // guard held for `t < 2W + n - 1`, and `2W` alone served bars `[2W, 2W + n - 2]` the base never did
  // (measured at n = 50: 980 bars, each ~1e-6 off a true full-history reference).
  const cNumB = (value) => (value < 0 ? { type: 'op', name: 'u-', args: [{ type: 'num', value: -value }] } : { type: 'num', value })
  const cSeriesB = (name) => ({ type: 'series', name })
  const cOpB = (name, args) => ({ type: 'op', name, args })
  const cCallB = (name, args) => ({ type: 'call', name, args })
  function baseSupertrendTrees(f, n, warmup = W) {
    const self = cSeriesB('self')
    const close = cSeriesB('close')
    const prevClose = { type: 'offset', value: 1, args: [close] }
    const hl2 = cOpB('/', [cOpB('+', [cSeriesB('high'), cSeriesB('low')]), cNumB(2)])
    const atr = cCallB('atrPine', [cSeriesB('high'), cSeriesB('low'), close, cNumB(n)])
    const band = (sign) => cOpB(sign, [hl2, cOpB('*', [cNumB(f), atr])])
    const up = band('+')
    const dn = band('-')
    const Wn = cNumB(warmup)
    const upper = cCallB('accum', [up, cOpB('?:', [
      cOpB('||', [cOpB('<', [up, self]), cOpB('>', [prevClose, self])]), up, self]), Wn])
    const lower = cCallB('accum', [dn, cOpB('?:', [
      cOpB('||', [cOpB('>', [dn, self]), cOpB('<', [prevClose, self])]), dn, self]), Wn])
    const one = cNumB(1)
    const minusOne = cNumB(-1)
    const direction = cCallB('accum', [one, cOpB('?:', [
      cOpB('==', [self, one]),
      cOpB('?:', [cOpB('>', [close, upper]), minusOne, one]),
      cOpB('?:', [cOpB('<', [close, lower]), one, minusOne]),
    ]), Wn])
    const unknown = cOpB('||', [
      cCallB('na', [{ type: 'offset', value: warmup, args: [upper] }]),
      cCallB('na', [{ type: 'offset', value: warmup, args: [lower] }]),
    ])
    const na = cOpB('/', [cNumB(0), cNumB(0)])
    return {
      value: cOpB('?:', [unknown, na, cOpB('?:', [cOpB('==', [direction, minusOne]), lower, upper])]),
      direction: cOpB('?:', [unknown, na, direction]),
    }
  }

  it.each([[3, 10], [2, 7], [3, 50]])('off the listing, factor %s ATR %s: the bars the BASE tree draws, and the same numbers on every one', (f, n) => {
    const num = (v) => ({ type: 'num', value: v })
    const t = supertrendTrees(num(f), num(n))
    const b = baseSupertrendTrees(f, n)
    let both = 0
    for (const seed of [2, 5, 9]) {
      const bars = walk(1100, seed)
      for (const k of ['value', 'direction']) {
        const now = Array.from(interpret(t[k], bars, {}))
        const was = Array.from(interpret(b[k], bars, {}))
        for (let i = 0; i < bars.length; i += 1) {
          expect(Number.isFinite(now[i]), `seed ${seed} ${k} bar ${i} drawn as the base draws it`).toBe(Number.isFinite(was[i]))
          if (Number.isFinite(was[i])) { both += 1; expect(now[i], `seed ${seed} ${k} bar ${i}`).toBe(was[i]) }
        }
        expect(now.findIndex(Number.isFinite), `seed ${seed} ${k}`).toBe(2 * W + n - 1)
      }
    }
    expect(both).toBeGreaterThan(3000)
  })

  it('the guard is a bounded curtain `2W + n - 1` deep off the listing, and known on every bar from it', () => {
    const t = supertrendTrees({ type: 'num', value: 3 }, { type: 'num', value: 10 })
    const guard = t.value.args[0]
    expect(guard.type === 'call' && guard.name === 'na').toBe(true)
    expect(guard.args[0].args[2]).toEqual({ type: 'num', value: 2 * W + 9 })
    for (const seed of [2, 5]) {
      const bars = walk(900, seed)
      const now = Array.from(interpret(guard, bars, {}))
      expect(now.slice(0, 2 * W + 9).every((v) => v === 1) && now.slice(2 * W + 9).every((v) => v === 0)).toBe(true)
      expect(Array.from(interpret(guard, bars, {}, undefined, undefined, LISTING)).every((v) => v === 0)).toBe(true)
    }
  })
})
