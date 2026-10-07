// ⭐⭐ PHASE 4 — A BUILT-IN IS CUSTOMIZABLE ONLY WHEN ITS COPY IS NUMERICALLY FAITHFUL.
//
// Every entry in `builtinForks.CUSTOMIZABLE_BUILTINS` is evaluated here twice over
// the same bars — the shipped NATIVE implementation (`computeFor` on the built-in)
// and the CUSTOM COPY (`computeFor` on the `ast` document `customCopyOf` builds) —
// and every output column must agree on every bar.
//
// ⭐ THE TOLERANCE, JUSTIFIED. |native − copy| ≤ ε · max(1, scale), ε = 1e-9, where
// `scale` is the column's largest magnitude. Both lanes compute in IEEE doubles;
// the copy's formula may associate the same arithmetic differently (an EMA of an
// inlined MACD line, `sma ± k·stdev` instead of one fused loop), which moves the
// last few bits — ~1e-15 relative per operation, so 1e-9 leaves six orders of
// magnitude of headroom for accumulated rounding while sitting far below anything
// the chart can show (the finest legend precision is 5 decimals) and equal to the
// 1e-9 the Python/JS interpreter parity rails already hold. Scaled by the column's
// magnitude so a volume-sized or price-sized series is not held to an absolute
// 1e-9 it cannot meet, and a near-zero histogram is not let off by a relative one.
// ⛔ WARM-UP MUST AGREE EXACTLY: a bar one lane leaves unknown and the other draws
// is a failure, whatever its value — that is where an approximation would hide.
//
// ⭐ UNDER THE SEMANTICS THE STORE WILL ACTUALLY STAMP: a new native formula is saved
// as semantics 2 (`user_definitions.decide_semantics`), so the copy is evaluated
// stamped 2 — and unstamped as well, since both must match the built-in.

import { describe, expect, it } from 'vitest'
import intraday from '../../../pages/parityBars/intraday5m.json'
import ramp from '../../../pages/parityBars/ramp200.json'
import { computeFor, getDefinition } from '../engine/nativeRegistry'
import { CUSTOMIZABLE_BUILTINS, PARITY_EPSILON, customizability } from './builtinForks'
import { customCopyOf } from './builtinCopy'
import { validateUserDefinitions } from '../engine/nativeRegistry'

const bars = (x) => (Array.isArray(x) ? x : x.bars)

function lcg(seed) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

/** Deterministic synthetic daily bars with the edge cases woven in. */
function synthetic(n, seed, { flatAt = null, zeroVolAt = null, gapAt = null } = {}) {
  const r = lcg(seed)
  const out = []
  let c = 100
  const day0 = Date.UTC(2020, 0, 1) / 1000
  for (let i = 0; i < n; i += 1) {
    let o = c
    if (gapAt !== null && i === gapAt) o = c * 1.5
    const drift = (r() - 0.5) * 2.4
    c = Math.max(1, o + drift)
    let h = Math.max(o, c) + r() * 1.2
    let l = Math.min(o, c) - r() * 1.2
    let v = Math.round(200000 + r() * 800000)
    if (flatAt !== null && i >= flatAt && i < flatAt + 30) { o = 50; c = 50; h = 50; l = 50 }
    if (zeroVolAt !== null && i >= zeroVolAt && i < zeroVolAt + 25) v = 0
    out.push({ t: day0 + i * 86400, o, h, l: Math.max(0.5, l), c, v })
  }
  return out
}

const HISTORIES = Object.freeze({
  intraday5m: bars(intraday),
  ramp200daily: bars(ramp),
  shortHistory: synthetic(8, 7),
  flatSegment: synthetic(260, 11, { flatAt: 120 }),
  zeroVolume: synthetic(260, 13, { zeroVolAt: 90 }),
  gapJump: synthetic(260, 17, { gapAt: 140 }),
  longWalk: synthetic(1500, 19),
})

/** Representative settings per built-in: its defaults, plus a non-default set. */
const VARIANTS = Object.freeze({
  rsi: [{ period: 21 }, { period: 5 }],
  macd: [{ fastPeriod: 8, slowPeriod: 21, signalPeriod: 5 }],
  bb: [{ period: 10, stdDev: 2.5 }],
  stoch: [{ kPeriod: 9, smoothK: 3, dPeriod: 4 }],
  atr: [{ period: 21 }],
  cci: [{ period: 14 }],
  williamsR: [{ period: 21 }],
  mfi: [{ period: 10 }],
  adx: [{ period: 10 }],
  donchian: [{ period: 55 }],
  roc: [{ source: 'close', period: 20 }, { source: 'high', period: 5 }],
  momentum: [{ source: 'close', period: 14 }],
  movingAverage: [
    { source: 'close', period: 20, maType: 'sma' }, { source: 'close', period: 20, maType: 'ema' },
    { source: 'close', period: 20, maType: 'wma' }, { source: 'close', period: 20, maType: 'hma' },
    { source: 'close', period: 20, maType: 'smma' }, { source: 'high', period: 50, maType: 'ema' },
  ],
  standardDeviation: [{ source: 'close', period: 30 }],
  atrPercent: [{ period: 21 }],
  bullBearPower: [{ period: 20 }],
  awesome: [{ fastPeriod: 3, slowPeriod: 20 }],
})

function defaultsOf(def) {
  return Object.fromEntries((def.inputs || []).map((i) => [i.key, i.default]))
}

function compareColumns(nat, cp, label) {
  const problems = []
  expect(cp.length, `${label}: column length`).toBe(nat.length)
  const scale = Math.max(1, ...nat.filter(Number.isFinite).map(Math.abs))
  for (let i = 0; i < nat.length; i += 1) {
    const a = nat[i]; const b = cp[i]
    const fa = Number.isFinite(a); const fb = Number.isFinite(b)
    if (fa !== fb) { problems.push(`bar ${i}: native ${a} vs copy ${b} (warm-up/unknown disagrees)`); continue }
    if (fa && Math.abs(a - b) > PARITY_EPSILON * scale) problems.push(`bar ${i}: native ${a} vs copy ${b}`)
    if (problems.length > 3) break
  }
  return problems
}

function columnOf(cols, key) {
  const c = cols[key]
  if (Array.isArray(c)) return c
  if (c && Array.isArray(c.values)) return c.values
  return c
}

describe('PHASE 4 — every customizable built-in has a numerically faithful custom copy', () => {
  for (const id of CUSTOMIZABLE_BUILTINS) {
    const def = getDefinition(id)
    it(`${id}: native vs custom copy, every history, every setting, both semantics (EXACT within ε)`, () => {
      expect(def, `${id} is a registered built-in`).toBeTruthy()
      const settings = [defaultsOf(def), ...(VARIANTS[id] || []).map((v) => ({ ...defaultsOf(def), ...v }))]
      for (const inputs of settings) {
        expect(customizability(def, inputs)).toEqual({ ok: true })
        const copy = customCopyOf(def, inputs)
        expect(validateUserDefinitions([copy]).errors, `${id} copy validates`).toEqual([])
        expect(copy.meta.forkedFrom).toMatchObject({ builtin: id })
        for (const stamp of [2, null]) {
          const doc = stamp ? { ...copy, meta: { ...copy.meta, semantics: stamp } } : copy
          for (const [hname, hb] of Object.entries(HISTORIES)) {
            // The binder resolves a `source` input into `ctx.source` (a bar field here).
            const field = { close: 'c', open: 'o', high: 'h', low: 'l', volume: 'v' }[inputs.source]
            const nat = computeFor(def, hb, inputs, field ? { source: hb.map((b) => b[field]) } : {})
            const cp = computeFor(doc, hb, {}, {})
            for (const out of copy.plots.filter((p) => p.style !== 'hlines')) {
              const problems = compareColumns(columnOf(nat, out.key), columnOf(cp, out.key),
                `${id} ${JSON.stringify(inputs)} sem${stamp || 1} ${hname} ${out.key}`)
              expect(problems, `${id} ${JSON.stringify(inputs)} semantics ${stamp || 1} on ${hname}, output ${out.key}`).toEqual([])
            }
          }
        }
      }
    })
  }

  it('the built-ins that cannot be reproduced exactly say so, and nothing is approximated', () => {
    for (const id of ['superTrend', 'sar', 'ichimoku', 'obv', 'accumDist', 'pvt', 'historicalVolatility', 'vwap', 'avwap', 'aroon', 'keltner']) {
      const def = getDefinition(id)
      expect(def, id).toBeTruthy()
      const v = customizability(def, defaultsOf(def))
      expect(v.ok, id).toBe(false)
      expect(v.reason).toMatch(/^Not customizable yet/)
      expect(() => customCopyOf(def, defaultsOf(def))).toThrow(/Not customizable yet/)
    }
    const ma = getDefinition('movingAverage')
    expect(customizability(ma, { source: 'close', period: 20, maType: 'lsma' }).ok).toBe(false)
    expect(customizability(ma, { source: 'inst:abc:rsi', period: 20, maType: 'sma' }).reason).toMatch(/another indicator/)
  })
})
