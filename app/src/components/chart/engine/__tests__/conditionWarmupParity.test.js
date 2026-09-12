import { describe, it, expect } from 'vitest'
import * as registry from '../nativeRegistry'
import { COND_TRUE, COND_FALSE, COND_UNKNOWN, evaluateCondition, trueRuns } from '../conditions'
import {
  resolveCandleColors, resolveBackgroundColors, resolveMarkers,
} from '../conditionActions'
import { buildDefinition } from '../../builder/BuilderSheet'
import { evaluateFormula } from '../../builder/FormulaField'
import { BUILDER_INPUTS, BUILDER_INPUT_SCOPE } from '../../builder/builderInputs'

// ─── UNKNOWN IS NOT FALSE ───────────────────────────────────────────────────
//
// ⭐⭐ FALSE means the condition was evaluated with valid inputs and was false.
// UNKNOWN means it could not yet be meaningfully evaluated. A condition reading a
// BOUND indicator used to merge the two over that indicator's warm-up, because the
// two facts that produce the merge are each individually correct:
//
//   * `maxLookback('a > 50')` is 0 — the tree names a binding, not a window.
//   * `NaN > 50` is 0, not NaN — the table pins a comparison against NaN at FALSE,
//     which is Pine's rule and the one the scan lane is tested against.
//
// Together they put a finite `0` on bars where nothing had been evaluated. The
// standalone spelling of the same idea — `rsi(close, 14) > 50` — reported UNKNOWN
// there, because `maxLookback` could see the `rsi` call. One idea, two columns.

const bars = Array.from({ length: 120 }, (_, i) => {
  const up = i % 3 !== 0
  const base = 100 + Math.sin(i / 5) * 14 + i * 0.05
  return { t: 1700000000 + i * 86400, o: up ? base : base + 1, c: up ? base + 1 : base, h: base + 2, l: base - 2, v: 1e6 }
})

const rsiCol = (period) => registry.computeFor(registry.getDefinition('rsi'), bars, { period }, undefined).rsi
const columnFor = (period) => (key) => (String(key).includes('legacy:rsi') ? rsiCol(period) : null)

const boolDef = (id, source) => {
  const ev = evaluateFormula(source, BUILDER_INPUT_SCOPE)
  expect(ev.ok, `fixture did not read back: ${source}`).toBe(true)
  const doc = buildDefinition({
    defId: id, name: 'Fixture', version: 1,
    source: ev.source, ast: ev.ast, mode: ev.verdict.mode, readback: ev.readback,
    inputs: BUILDER_INPUTS,
  })
  const { errors } = registry.installUserDefinitions([doc])
  expect(errors, `the registry refused the fixture: ${errors.join('; ')}`).toEqual([])
  return doc
}

const col = (cond, period = 14) => evaluateCondition(cond, bars, columnFor(period), registry).column
const head = (c) => [...c].findIndex((v) => v !== COND_UNKNOWN)
const count = (c, v) => [...c].filter((x) => x === v).length

const LOCAL = (formula = 'a > 50') => ({
  id: 'L', name: 'Local', formula, bindings: { a: '@legacy:rsi::rsi' }, enabled: true, actions: [],
})

describe('1-3 · a bound source, bar by bar', () => {
  it('⭐⭐ 1 · NaN during warm-up ⇒ UNKNOWN, not FALSE', () => {
    const c = col(LOCAL())
    const firstFinite = [...rsiCol(14)].findIndex((v) => Number.isFinite(v))
    expect(firstFinite).toBeGreaterThan(0)
    for (let i = 0; i < firstFinite; i += 1) {
      expect(c[i], `bar ${i} is inside the source's warm-up`).toBe(COND_UNKNOWN)
    }
    // ⛔ the regression this closes: every one of those bars used to read FALSE
    expect(count(c.slice(0, firstFinite), COND_FALSE)).toBe(0)
  })

  it('⭐ 2 · finite source, comparison false ⇒ FALSE', () => {
    const rsi = rsiCol(14)
    const c = col(LOCAL())
    const i = [...rsi].findIndex((v, k) => Number.isFinite(v) && v <= 50 && k > 20)
    expect(i, 'fixture has no bar where RSI(14) <= 50').toBeGreaterThan(0)
    expect(c[i]).toBe(COND_FALSE)
  })

  it('⭐ 3 · finite source, comparison true ⇒ TRUE', () => {
    const rsi = rsiCol(14)
    const c = col(LOCAL())
    const i = [...rsi].findIndex((v, k) => Number.isFinite(v) && v > 50 && k > 20)
    expect(i, 'fixture has no bar where RSI(14) > 50').toBeGreaterThan(0)
    expect(c[i]).toBe(COND_TRUE)
  })

  it('⛔ an ordinary numeric comparison is untouched — no binding, no mask', () => {
    // The fix must not reach a formula that binds nothing.
    const plain = { id: 'P', name: 'P', formula: 'close > open', bindings: {}, enabled: true, actions: [] }
    const c = col(plain)
    expect(head(c)).toBe(0)
    expect(count(c, COND_UNKNOWN)).toBe(0)
    expect(count(c, COND_TRUE) + count(c, COND_FALSE)).toBe(bars.length)
  })

  it('⛔ a binding the formula does NOT read cannot mask anything', () => {
    // A leftover binding after an edit would otherwise call bars unknown that the
    // formula has a perfectly good answer for.
    const stale = {
      id: 'S', name: 'S', formula: 'close > open',
      bindings: { a: '@legacy:rsi::rsi' }, enabled: true, actions: [],
    }
    expect(count(col(stale), COND_UNKNOWN)).toBe(0)
  })
})

describe('4 · LOCAL and DURABLE now agree', () => {
  it('⭐⭐ same UNKNOWN head, same truth tail', () => {
    boolDef('u_ddddddddd001', 'rsi(close, 14) > 50')
    const local = col(LOCAL())
    const durable = col({ id: 'D', name: 'D', definitionId: 'u_ddddddddd001', formula: '', bindings: {}, enabled: true, actions: [] })

    expect(head(local)).toBe(head(durable))
    expect(head(local)).toBeGreaterThan(0)
    expect([...local]).toEqual([...durable])
  })

  it('⭐ and the two agree on how many bars are TRUE', () => {
    boolDef('u_ddddddddd002', 'rsi(close, 14) > 50')
    const local = col(LOCAL())
    const durable = col({ id: 'D', name: 'D', definitionId: 'u_ddddddddd002', formula: '', bindings: {}, enabled: true, actions: [] })
    expect(count(local, COND_TRUE)).toBe(count(durable, COND_TRUE))
  })
})

describe('5 · the product distinction survives the fix', () => {
  it('⭐⭐ chart RSI 14 → 28: LOCAL follows, DURABLE does not', () => {
    boolDef('u_ddddddddd003', 'rsi(close, 14) > 50')
    const DURABLE = { id: 'D', name: 'D', definitionId: 'u_ddddddddd003', formula: '', bindings: {}, enabled: true, actions: [] }
    const same = (a, b) => a.length === b.length && [...a].every((v, i) => v === b[i])

    const local14 = col(LOCAL(), 14)
    const local28 = col(LOCAL(), 28)
    const dur14 = col(DURABLE, 14)
    const dur28 = col(DURABLE, 28)

    expect(same(local14, local28), 'the local condition did NOT follow the chart').toBe(false)
    expect(same(dur14, dur28), 'the durable condition FOLLOWED the chart').toBe(true)

    // ⭐ and the warm head followed too — that is the fix doing its job on BOTH
    // periods, not just on the one the case was written against.
    expect(head(local28)).toBeGreaterThan(head(local14))
    expect(head(dur28)).toBe(head(dur14))
  })
})

describe('6 · nothing visible moved', () => {
  // ⭐⭐ ONLY `COND_TRUE` DRAWS. Every consumer keys on it, so a bar that changed
  // FALSE → UNKNOWN is the same ink either way — and that is a claim to MEASURE,
  // not to assert, because it is the whole reason this correction is safe to take.
  const cond = {
    ...LOCAL(),
    actions: [
      { id: 'a1', type: 'candleColor', enabled: true, color: '#e8a33d', target: 'price' },
      { id: 'a2', type: 'marker', enabled: true, shape: 'dot', position: 'belowBar', color: '#3b82f6', target: 'price' },
      { id: 'a3', type: 'background', enabled: true, color: 'rgba(34,168,94,0.14)', target: 'price' },
    ],
  }

  /** The column the OLD code produced: FALSE wherever the source was warming. */
  const preFix = (c) => {
    const out = Uint8Array.from(c)
    const rsi = rsiCol(14)
    for (let i = 0; i < out.length; i += 1) {
      if (!Number.isFinite(rsi[i]) && out[i] === COND_UNKNOWN) out[i] = COND_FALSE
    }
    return out
  }

  /** Everything a member can actually SEE, counted through the shipped resolvers. */
  const drawn = (column) => {
    const list = [cond]
    const columnOf = (id) => (id === cond.id ? column : null)
    const painted = (arr) => (Array.isArray(arr) ? arr.filter((v) => v != null).length : 0)
    return {
      candles: painted(resolveCandleColors(list, columnOf, bars.length)),
      backgrounds: painted(resolveBackgroundColors(list, columnOf, bars.length)),
      markers: resolveMarkers(list, columnOf, bars, (t) => t).length,
      runs: trueRuns(column).length,
      trues: count(column, COND_TRUE),
    }
  }

  it('⭐⭐ TRUE bars, runs and every drawn action are identical before and after', () => {
    const after = col(cond)
    const before = preFix(after)

    // the correction genuinely happened…
    expect(count(before, COND_FALSE)).toBeGreaterThan(count(after, COND_FALSE))
    expect(count(after, COND_UNKNOWN)).toBeGreaterThan(count(before, COND_UNKNOWN))

    // …and nothing a member can see moved.
    const a = drawn(after)
    const b = drawn(before)
    expect(a.trues).toBe(b.trues)
    expect(a.runs).toBe(b.runs)
    expect(a.candles).toBe(b.candles)
    expect(a.markers).toBe(b.markers)
    expect(a.backgrounds).toBe(b.backgrounds)
    // …and there WAS something to draw, or this case would pass on an empty chart.
    expect(a.trues).toBeGreaterThan(0)
    expect(a.candles + a.markers + a.backgrounds).toBeGreaterThan(0)
  })

  it('⭐ the first drawn bar is at or after the source’s first valid bar', () => {
    const c = col(cond)
    const firstFinite = [...rsiCol(14)].findIndex((v) => Number.isFinite(v))
    const firstTrue = [...c].findIndex((v) => v === COND_TRUE)
    expect(firstTrue).toBeGreaterThanOrEqual(firstFinite)
  })
})
