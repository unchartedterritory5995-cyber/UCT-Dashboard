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

const col = (source, bars) => {
  const r = parseFormula(source)
  expect(r.ok, `${source}: ${r.error}`).toBe(true)
  return Array.from(interpret(r.ast, bars, {}))
}

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
