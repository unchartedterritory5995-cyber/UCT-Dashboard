// app/src/components/chart/builder/authoring/batch2.reopenFunctions.test.js
//
// ⭐ CRITICAL-FIX RELEASE (2026-10-09) — a SAVED definition using a Batch 2 formula function,
// reopened from the store (which returns keys SORTED), must keep that function: its length is
// ONE parameter, and changing it changes the WHOLE formula. Checked against independent
// mathematics, not against the engine's own expansion: least squares, Pearson, the volume-
// weighted mean, percent change, the difference, and EMA ± multiplier × EMA(true range).
import { describe, it, expect } from 'vitest'
import { parseFormula, astHash } from '../../engine/ast/parse'
import { interpret } from '../../engine/ast/interpret'
import { expandCalls } from '../../engine/ast/callExpansions'
import { applyPatch, applyTurn, openAuthoringState } from './index'
import { compactView } from './compactView'
import { modelOf } from './model'

const C = 'uct.authoring.patch/1'
const env = (rev, ops) => ({ contract: C, baseRevision: rev, ops, assumptions: [] })
const GATE = { tf: 'D', symbol: 'AAPL' }
const N = 160
const BARS = Array.from({ length: N }, (_, i) => {
  const c = 100 + 0.2 * i + 6 * Math.sin(i / 7) + 2 * Math.cos(i / 2.9)
  return { t: 1_700_000_000 + i * 86400, o: c - 0.4, h: c + 1.5 + Math.abs(Math.sin(i)), l: c - 1.3 - Math.abs(Math.cos(i)), c, v: 1_000_000 + 37_000 * ((i * 5) % 11) }
})
const SPY = BARS.map((b, i) => ({ ...b, c: 50 + 0.1 * i + 3 * Math.sin(i / 5), h: 52 + 0.1 * i, l: 48 + 0.1 * i }))
const close = BARS.map((b) => b.c)
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v)
const S = { type: 'series', name: 'close' }
const num = (v) => ({ type: 'num', value: v })
const spyClose = { type: 'sym', value: 'SPY', args: [S] }

// ── independent references ────────────────────────────────────────────────────────
const windowed = (n, f) => close.map((_, i) => (i < n - 1 ? NaN : f(i - n + 1, i)))
const linregRef = (n) => windowed(n, (a, b) => {
  const xs = [], ys = []
  for (let k = a; k <= b; k++) { xs.push(k - a); ys.push(close[k]) }
  const mx = xs.reduce((s, x) => s + x, 0) / n, my = ys.reduce((s, y) => s + y, 0) / n
  let sxy = 0, sxx = 0
  for (let k = 0; k < n; k++) { sxy += (xs[k] - mx) * (ys[k] - my); sxx += (xs[k] - mx) ** 2 }
  const slope = sxy / sxx
  return my + slope * ((n - 1) - mx)
})
const corrRef = (n) => windowed(n, (a, b) => {
  const xs = close.slice(a, b + 1), ys = SPY.slice(a, b + 1).map((x) => x.c)
  const mx = xs.reduce((s, x) => s + x, 0) / n, my = ys.reduce((s, y) => s + y, 0) / n
  let sxy = 0, sxx = 0, syy = 0
  for (let k = 0; k < n; k++) { sxy += (xs[k] - mx) * (ys[k] - my); sxx += (xs[k] - mx) ** 2; syy += (ys[k] - my) ** 2 }
  return sxy / Math.sqrt(sxx * syy)
})
const vwmaRef = (n) => windowed(n, (a, b) => {
  let pv = 0, v = 0
  for (let k = a; k <= b; k++) { pv += close[k] * BARS[k].v; v += BARS[k].v }
  return pv / v
})
const rocRef = (n) => close.map((c, i) => (i < n ? NaN : (100 * (c - close[i - n])) / close[i - n]))
const momRef = (n) => close.map((c, i) => (i < n ? NaN : c - close[i - n]))
// Keltner as a plain FORMULA (not the expansion): ema(close, n) ± m × ema(true range, n)
const tr = 'max(high - low, max(abs(high - close[1]), abs(low - close[1])))'
const kcRef = (n, m, sign) => Array.from(interpret(parseFormula(`ema(close, ${n}) ${sign} ${m} * ema(${tr}, ${n})`).ast, BARS))
const kcMidRef = (n) => Array.from(interpret(parseFormula(`ema(close, ${n})`).ast, BARS))

const CASES = [
  { name: 'linreg', args: (n) => [S, num(n)], ref: linregRef },
  { name: 'linreg (offset 0 written)', fn: 'linreg', args: (n) => [S, num(n), num(0)], ref: linregRef },
  { name: 'correlation', args: (n) => [S, spyClose, num(n)], ref: corrRef },
  { name: 'vwma', args: (n) => [S, num(n)], ref: vwmaRef },
  { name: 'roc', args: (n) => [S, num(n)], ref: rocRef },
  { name: 'mom', args: (n) => [S, num(n)], ref: momRef },
  { name: 'kcUpper', args: (n) => [S, num(n), num(2)], ref: (n) => kcRef(n, 2, '+') },
  { name: 'kcLower', args: (n) => [S, num(n), num(1.5)], ref: (n) => kcRef(n, 1.5, '-') },
  { name: 'kcMiddle', args: (n) => [S, num(n)], ref: kcMidRef },
]

const close9 = (a, b) => a.every((x, i) => (Number.isNaN(x) && Number.isNaN(b[i])) || Math.abs(x - b[i]) < 1e-9 * Math.max(1, Math.abs(b[i])))

describe('a saved formula function, reopened from the store, edits as ONE function', () => {
  for (const c of CASES) {
    it(`${c.name}: one length slot; 30 → 14 equals the independent ${c.name} at 14, bar by bar`, () => {
      const fn = c.fn || c.name
      const made = applyPatch(null, env(0, [{ op: 'create', name: `${fn} test`, placement: 'pane',
        outputs: [{ key: 'value', label: fn, tree: { type: 'call', name: fn, args: c.args(30) } }] }]), { gateCtx: GATE })
      expect(made.status, JSON.stringify(made.errors)).toBe('applied')
      // the store round trip: JSON with sorted keys, as the server returns it
      const stored = sortKeys(JSON.parse(JSON.stringify({ ...made.definition, id: 'u_7a1b2c3d4e5f', version: 2 })))
      const st = openAuthoringState(stored, { defId: stored.id, version: 2 })
      const slots = compactView(st.working, st, GATE).definition.outputs[0].slots
      const lengths = slots.filter((s) => s.kind === 'number' && s.value === 30)
      expect(lengths.map((s) => s.id), `${c.name}: the length must be ONE parameter`).toHaveLength(1)
      const out = applyTurn(st, env(st.revision, [{ op: 'set_slot', slot: lengths[0].id, value: 14 }]), { gateCtx: GATE })
      expect(out.result.status, JSON.stringify(out.result.errors)).toBe('applied')
      const tree = modelOf(out.state.working).rows.find((r) => r.key === 'value').ast
      // structurally the function at the new length…
      expect(astHash(tree)).toBe(astHash(expandCalls({ type: 'call', name: fn, args: c.args(14) })))
      // …and numerically the INDEPENDENT reference at the new length
      const got = Array.from(interpret(tree, BARS, {}, undefined, undefined, { tf: 'D', symbols: { SPY } }))
      expect(close9(got, c.ref(14)), `${c.name}: values differ from the reference`).toBe(true)
      // and not the old length (the edit really happened)
      expect(close9(got, c.ref(30))).toBe(false)
    })
  }
})
