// app/src/components/chart/engine/__tests__/technicalLibraryTier1.test.js
//
// ─── THE TIER 1 LIBRARY'S PRODUCT RULES (2026-10-01) ────────────────────────
//
// The maths is proven in `technicalStudies.oracle.test.js`; the registry rails
// (`nativeRegistry.test.js`, the sweep, the ledgers) cover every definition. This
// file holds the product decisions this batch made, each as a failable case:
//   1. slow Stochastic for a NEW instance, fast for every SAVED one;
//   2. a `source` follows its source's pane only for a domain-preserving study;
//   3. every Technical row lives in exactly one of seven categories, in order;
//   4. the search aliases resolve to the right row;
//   5. a Tier 1 study is in the right-click quick menu only while it is on;
//   6. every Tier 1 study persists through a save → reload.

import { describe, it, expect } from 'vitest'
import * as registry from '../nativeRegistry'
import {
  addInstance, setIndicatorEnabled, setInstanceInput,
} from '../instanceControls'
import { resolveDisplayTarget } from '../displayTarget'
import { normalizeInstances } from '../instances'
import { computeStochastic } from '../../indicators'
import { libraryRows } from '../../discoveryCatalog'
import { BUILT_IN_ROWS, CARVED_OUT_ROWS } from '../../indicatorCatalog'
import { TECH_CATEGORY_ORDER, orderCategories } from '../../technicalCategories'
import { matches } from '../../IndicatorLibraryDialog'
import { TIER1_IDS } from './tier1Library.fixture'

const insts = (cs) => (Array.isArray(cs.indicatorInstances) ? cs.indicatorInstances : [])
const find = (cs, id) => insts(cs).find((i) => i.instanceId === id)
function add(cs, defId) {
  const before = insts(cs).map((i) => i.instanceId)
  const next = addInstance(cs, defId, registry)
  return [next, insts(next).map((i) => i.instanceId).find((i) => !before.includes(i))]
}
const bars = (n) => Array.from({ length: n }, (_, i) => {
  const c = 100 + Math.sin(i / 4) * 5 + i * 0.05
  return { t: 1_700_000_000 + i * 86400, o: c - 0.3, h: c + 1, l: c - 1.2, c, v: 1e6 }
})

describe('1 — Stochastic: SLOW for a new instance, FAST for every saved one', () => {
  it('the declared default of `smoothK` is 1 (an absent key = the shipped fast %K)', () => {
    const def = registry.getDefinition('stoch')
    expect(def.inputs.find((i) => i.key === 'smoothK').default).toBe(1)
    expect(def.meta.createInputs).toEqual({ smoothK: 3 })
  })

  it('a SAVED instance without the key computes exactly the shipped fast stochastic', () => {
    const def = registry.getDefinition('stoch')
    const b = bars(200)
    const cols = registry.computeFor(def, b, { kPeriod: 14, dPeriod: 3 })
    const fast = computeStochastic(b, 14, 3)
    fast.k.forEach((p, i) => expect(Object.is(cols.k[i], p.value) || (Number.isNaN(cols.k[i]) && Number.isNaN(p.value))).toBe(true))
  })

  it('both add doors write smoothK 3 onto the NEW instance — library + and the toolbar toggle', () => {
    const [cs, id] = add({ indicatorInstances: [] }, 'stoch')
    expect(find(cs, id).inputs).toMatchObject({ kPeriod: 14, smoothK: 3, dPeriod: 3 })
    const viaToggle = setIndicatorEnabled({ indicatorInstances: [] }, 'stoch', true, registry)
    expect(find(viaToggle, 'legacy:stoch').inputs.smoothK).toBe(3)
  })

  it('slow %K is the SMA(3) of fast %K, and %D the SMA(3) of slow %K', () => {
    const def = registry.getDefinition('stoch')
    const b = bars(200)
    const slow = registry.computeFor(def, b, { kPeriod: 14, smoothK: 3, dPeriod: 3 })
    const fastK = computeStochastic(b, 14, 1).k.map((p) => p.value)
    for (let i = 20; i < 200; i++) {
      const want = (fastK[i] + fastK[i - 1] + fastK[i - 2]) / 3
      expect(Math.abs(slow.k[i] - want)).toBeLessThan(1e-9)
      const wantD = (slow.k[i] + slow.k[i - 1] + slow.k[i - 2]) / 3
      expect(Math.abs(slow.d[i] - wantD)).toBeLessThan(1e-9)
    }
    expect(slow.k.findIndex(Number.isFinite)).toBe(15)   // 13 + (3 − 1)
  })

  it('a saved FAST instance survives a reload unchanged — its meaning is not reinterpreted', () => {
    const saved = { indicatorInstances: [{ instanceId: 'inst:stoch:1', defId: 'stoch', inputs: { kPeriod: 14, dPeriod: 3 }, hidden: false }] }
    const { kept, dropped } = normalizeInstances(JSON.parse(JSON.stringify(saved)).indicatorInstances, registry)
    expect(dropped).toEqual([])
    expect(kept[0].inputs).toEqual({ kPeriod: 14, dPeriod: 3 })
    expect(registry.resolveInputs(registry.getDefinition('stoch'), kept[0].inputs).smoothK).toBe(1)
  })
})

describe('2 — a source-taking study follows its source only if it keeps the source\'s units', () => {
  it('ROC / Stoch RSI / % From MA of the CLOSE stay in their own pane (not the candles)', () => {
    for (const defId of ['roc', 'stochRsi', 'percentFromMa', 'standardDeviation', 'tsi', 'cmo', 'trix', 'ppo', 'momentum']) {
      const [cs, id] = add({ indicatorInstances: [] }, defId)
      expect(find(cs, id).inputs.source, defId).toBe('close')
      expect(resolveDisplayTarget(find(cs, id), cs), defId).toBe('pane')
    }
  })
  it('…while an MA Envelope (domain-preserving) of the close sits on the candles, and of RSI in RSI\'s pane', () => {
    let cs = { indicatorInstances: [] }
    let env; [cs, env] = add(cs, 'envelope')
    expect(resolveDisplayTarget(find(cs, env), cs)).toBe('price')
    let rsi; [cs, rsi] = add(cs, 'rsi')
    cs = setInstanceInput(cs, env, 'source', `@${rsi}::rsi`, registry)
    expect(resolveDisplayTarget(find(cs, env), cs)).not.toBe('price')
    expect(String(resolveDisplayTarget(find(cs, env), cs))).toContain(rsi)
  })
  it('…and the Moving Average still follows its source exactly as before', () => {
    let cs = { indicatorInstances: [] }
    let rsi; [cs, rsi] = add(cs, 'rsi')
    let ma; [cs, ma] = add(cs, 'movingAverage')
    cs = setInstanceInput(cs, ma, 'source', `@${rsi}::rsi`, registry)
    expect(String(resolveDisplayTarget(find(cs, ma), cs))).toContain(rsi)
  })
})

describe('3 — seven Technical categories, every row in exactly one, in a fixed order', () => {
  // `libraryRows` is the whole shipped Technical catalogue: the built-in Volume
  // row, every definition and the carved-out Volume Profile (hidden ids removed).
  const technicalRows = () => libraryRows(registry).filter((r) => !r.userDefined)
  it('…and that catalogue is 54 rows: the 21 before this batch + 33 Tier 1 studies', () => {
    expect(technicalRows()).toHaveLength(54)
    expect(technicalRows().some((r) => r.id === 'volume')).toBe(true)
    expect(technicalRows().some((r) => r.id === CARVED_OUT_ROWS[0].id)).toBe(true)
    expect(BUILT_IN_ROWS.some((r) => r.id === 'volume')).toBe(true)
  })
  it('every shipped Technical row names one of the seven', () => {
    const off = technicalRows().filter((r) => !TECH_CATEGORY_ORDER.includes(r.category))
    expect(off.map((r) => `${r.id}:${r.category}`)).toEqual([])
  })
  it('the order is fixed and the seven are all populated', () => {
    expect(TECH_CATEGORY_ORDER).toEqual([
      'Trend & Moving Averages', 'Momentum & Oscillators', 'Volatility & Bands',
      'Volume & Money Flow', 'VWAP', 'Relative Strength', 'Levels & Statistics',
    ])
    const used = new Set(technicalRows().map((r) => r.category))
    for (const c of TECH_CATEGORY_ORDER) expect(used.has(c), `${c} is empty`).toBe(true)
  })
  it('the counts per category are the reconciled Tier 1 structure', () => {
    const counts = {}
    for (const r of technicalRows()) counts[r.category] = (counts[r.category] || 0) + 1
    expect(counts).toEqual({
      'Trend & Moving Averages': 8,
      'Momentum & Oscillators': 16,
      'Volatility & Bands': 12,
      'Volume & Money Flow': 12,
      VWAP: 2,
      'Relative Strength': 3,
      'Levels & Statistics': 1,
    })
  })
  it('orderCategories puts the Technical headings first, in order, whatever order they arrive', () => {
    expect(orderCategories(['Volume & Money Flow', 'My formulas', 'Trend & Moving Averages', 'Symbols']))
      .toEqual(['Trend & Moving Averages', 'Volume & Money Flow', 'My formulas', 'Symbols'])
  })
  it('no row is listed twice and no display name repeats', () => {
    const rows = technicalRows()
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length)
    expect(new Set(rows.map((r) => r.name)).size).toBe(rows.length)
  })
})

describe('4 — the search aliases resolve to the right row', () => {
  const rows = libraryRows(registry)
  const hit = (q) => rows.filter((r) => matches(r, q)).map((r) => r.id)
  for (const [q, id] of [
    ['HMA', 'movingAverage'], ['hull', 'movingAverage'], ['wilder', 'movingAverage'], ['lsma', 'movingAverage'],
    ['moving vwap', 'movingAverage'], ['DMI', 'adx'], ['+DI', 'adx'], ['Stoch RSI', 'stochRsi'],
    ['CMF', 'chaikinMoneyFlow'], ['PPO', 'ppo'], ['TSI', 'tsi'], ['CMO', 'cmo'], ['PVT', 'pvt'],
    ['%B', 'bbPercentB'], ['ADR', 'adrPercent'], ['RVOL', 'relativeVolume'], ['elder ray', 'bullBearPower'],
    ['supertrend', 'superTrend'], ['keltner', 'keltner'], ['natr', 'atrPercent'], ['52 week', 'fiftyTwoWeek'],
  ]) {
    it(`"${q}" → ${id}`, () => expect(hit(q)).toContain(id))
  }
})

describe('5 — the right-click quick menu', () => {
  it('every Tier 1 study declares quickMenu:false; no pre-existing definition does', () => {
    for (const d of registry.listDefinitions()) {
      expect(d.meta.quickMenu === false, d.id).toBe(TIER1_IDS.includes(d.id))
    }
  })
})

describe('6 — every Tier 1 study survives save → reload with its inputs intact', () => {
  it('add each one, edit its first numeric input, round-trip the blob, and nothing is dropped', () => {
    let cs = { indicatorInstances: [] }
    const ids = {}
    for (const defId of TIER1_IDS) {
      let id; [cs, id] = add(cs, defId)
      ids[defId] = id
      const num = registry.getDefinition(defId).inputs.find((i) => i.type === 'int')
      if (num) cs = setInstanceInput(cs, id, num.key, Math.min(num.max, num.default + 1), registry)
    }
    const blob = JSON.parse(JSON.stringify(cs))
    const { kept, dropped } = normalizeInstances(blob.indicatorInstances, registry)
    expect(dropped).toEqual([])
    for (const defId of TIER1_IDS) {
      const before = find(cs, ids[defId])
      const after = kept.find((i) => i.instanceId === ids[defId])
      expect(after, defId).toBeTruthy()
      expect(after.inputs, defId).toEqual(before.inputs)
    }
  })
  it('two instances of one study are independent', () => {
    let cs = { indicatorInstances: [] }
    let a; [cs, a] = add(cs, 'keltner')
    let b; [cs, b] = add(cs, 'keltner')
    expect(a).not.toBe(b)
    cs = setInstanceInput(cs, b, 'period', 50, registry)
    expect(find(cs, a).inputs.period).toBe(20)
    expect(find(cs, b).inputs.period).toBe(50)
  })
})
