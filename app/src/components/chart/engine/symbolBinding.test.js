import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createBinder } from './binder'
import { resolvePlacement } from './placement'
import { createFakeChart, makeBars } from './__tests__/fakeChart'
import * as registry from './nativeRegistry'
import { symbolSource, symbolsNeeded, parseSource } from './sourceRef'
import {
  secondaryBarsUrl, ensureAll, cachedBars, clearSecondaryBars,
  fetchSecondaryBars, primeSecondaryBars, inflightCount, SOURCE_STATUS,
} from './secondaryBars'

// ─── P1.5 · THE PHASE-DECIDING PROOF ────────────────────────────────────────
//
// ⭐⭐ THE CLAIM UNDER TEST IS NOT "QQQ RENDERS". It is that QQQ and UCTA50 are
// BORINGLY IDENTICAL to the engine — that a moving average over a breadth
// pseudo-symbol and one over an ETF take the same code path, produce the same
// binding structure, and that `movingAverage` itself learns nothing about either.
//
// ⛔ EVERY BEHAVIOURAL TEST BELOW RUNS TWICE, once per family. That is the
// Alerts lesson applied before a line of product code exists: two of three
// defects there survived a green suite because every fixture used one variant.

const SECURITY = 'QQQ'
const BREADTH = 'UCTA50'
const FAMILIES = [
  ['ordinary security', SECURITY],
  ['breadth pseudo-symbol', BREADTH],
]

const bars = makeBars(120)

/** Secondary bars on the SAME timeline as the primary, offset in value so a
 *  projection that silently used the primary would be obvious. */
const secondaryFor = (offset) => bars.map((b) => ({ ...b, c: b.c + offset, v: b.v + offset }))

// `movingAverage` is the real registry id; its source input is `source`, its
// period input is `period`, and its single plot key is `ma`.
const MA = 'movingAverage'
const maInst = (instanceId, source, period = 5) => ({
  instanceId, defId: MA, inputs: { source, period }, hidden: false,
})

// ⚠️ DATA IS READ FROM THE FAKE'S CALL LOG, not from `applyData`. On a FIRST
// bind the binder calls `series.setData` DIRECTLY whatever the plan says
// (binder.js "TRAP #1"), so a harness that only watched `applyData` would see
// nothing and wrongly conclude the column was empty.
const ctxFor = (instances, secondary) => ({
  enabled: true,
  instances,
  registry,
  bars,
  adjustTime: (t) => t,
  plan: { fresh: true },
  applyData: (series, data) => { if (series && data) series.setData(data) },
  resolvePlacement,
  secondary,
})

let fake
let binder
beforeEach(() => {
  fake = createFakeChart()
  binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
  clearSecondaryBars()
})

/** Finite values a binding actually drew, from the LAST setData for its series. */
const drawnValues = (b, chart = fake) => {
  if (!b || !b.series) return []
  const id = b.series.__id
  const last = [...chart.calls].reverse()
    .find((c) => c.on === 'series' && c.id === id && c.method === 'setData')
  return (last?.args?.[0] || []).map((p) => p.value).filter(Number.isFinite)
}

describe('⭐⭐ MA OVER A SECONDARY SYMBOL — the acceptance criterion', () => {
  it.each(FAMILIES)('%s: MA(%s) computes from the SECONDARY series, not the primary', (_label, sym) => {
    const offset = 1000
    const secondary = new Map([[sym, { bars: secondaryFor(offset), status: SOURCE_STATUS.AVAILABLE }]])
    const ma = maInst('legacy:movingAverage', symbolSource(sym, 'close'))

    binder.sync(ctxFor([ma], secondary))
    const bound = binder.bindings().find((b) => b.instanceId === ma.instanceId)
    expect(bound).toBeTruthy()

    // A 5-bar SMA of (primary + 1000) must sit ~1000 above a 5-bar SMA of the
    // primary. If the symbol branch silently fell back to the chart's own bars,
    // this is the assertion that catches it.
    const finite = drawnValues(bound)
    expect(finite.length).toBeGreaterThan(0)
    expect(finite[finite.length - 1]).toBeGreaterThan(offset)
  })

  it.each(FAMILIES)('%s: an UNSUPPLIED symbol draws nothing — never the primary', (_label, sym) => {
    const ma = maInst('legacy:movingAverage', symbolSource(sym, 'close'))
    binder.sync(ctxFor([ma], new Map()))                 // nothing supplied
    const bound = binder.bindings().find((b) => b.instanceId === ma.instanceId)
    // ⛔ The defining rule: not-computable, never the wrong instrument. The
    // primary's own closes are ~100–110, so ANY finite value here would be the
    // fallback this lane must never make.
    expect(drawnValues(bound)).toHaveLength(0)
  })
})

describe('⭐⭐ PARITY — the two families produce the same architecture', () => {
  it('identical binding structure, placement and scale for equivalent use', () => {
    const shape = (sym) => {
      const chart = createFakeChart()
      const b = createBinder({ chart: chart.chart, LWC: chart.LWC })
      const secondary = new Map([[sym, { bars: secondaryFor(10), status: SOURCE_STATUS.AVAILABLE }]])
      const one = maInst('legacy:movingAverage', symbolSource(sym, 'close'))
      b.sync(ctxFor([one], secondary))
      const held = b.bindings()
      void chart
      return {
        bindings: held.length,
        // The SHAPE, deliberately not the values: the numbers differ, the
        // architecture must not.
        keys: held.map((x) => x.key.replace(sym, '<SYM>')),
        panes: chart.seriesCreated.map((s) => s.__pane),
        scales: chart.seriesCreated.map((s) => s.__options?.priceScaleId ?? null),
        types: chart.seriesCreated.map((s) => s.__type),
      }
    }
    expect(shape(BREADTH)).toEqual(shape(SECURITY))
  })
})

describe('⭐ CHAINED DEPENDENCY — MA over MA over a symbol', () => {
  it.each(FAMILIES)('%s: a second level computes through the same ordering', (_label, sym) => {
    const secondary = new Map([[sym, { bars: secondaryFor(500), status: SOURCE_STATUS.AVAILABLE }]])
    const first = maInst('inst:movingAverage:1', symbolSource(sym, 'close'), 5)
    const second = maInst('inst:movingAverage:2', '@inst:movingAverage:1::ma', 3)

    // ⛔ DECLARED OUT OF ORDER ON PURPOSE — `orderByDependency` must sort the
    // symbol-rooted chain, not the array order.
    binder.sync(ctxFor([second, first], secondary))
    const chained = binder.bindings().find((x) => x.instanceId === 'inst:movingAverage:2')
    expect(chained).toBeTruthy()
    const finite = drawnValues(chained)
    expect(finite.length).toBeGreaterThan(0)
    expect(finite[finite.length - 1]).toBeGreaterThan(500)
  })
})

describe('⭐⭐ FETCH DEDUP — measured, not assumed', () => {
  it('QQQ named by four consumers is fetched ONCE', async () => {
    const calls = []
    const fetcher = vi.fn(async (url) => { calls.push(url); return { bars: secondaryFor(1), sealed: true } })
    const defOf = () => ({ inputs: [{ key: 'source', type: 'source', default: 'close' }] })

    const instances = [
      maInst('a', symbolSource(SECURITY, 'close')),
      maInst('b', symbolSource(SECURITY, 'close')),
      maInst('c', symbolSource(SECURITY, 'close')),
      maInst('d', symbolSource('SPY', 'close')),
    ]
    const needed = symbolsNeeded(instances, defOf)
    expect(needed).toEqual(['QQQ', 'SPY'])

    ensureAll(needed, 'D', 200, fetcher)
    ensureAll(needed, 'D', 200, fetcher)          // a second paint must not re-ask
    await Promise.all([
      fetchSecondaryBars(SECURITY, 'D', 200, fetcher),
      fetchSecondaryBars('SPY', 'D', 200, fetcher),
    ])

    const qqqCalls = calls.filter((u) => u.includes('/QQQ?'))
    const spyCalls = calls.filter((u) => u.includes('/SPY?'))
    expect(qqqCalls).toHaveLength(1)              // ⛔ NOT 3, NOT 4
    expect(spyCalls).toHaveLength(1)
  })

  it('breadth dedups identically — same function, no family branch', async () => {
    const calls = []
    const fetcher = vi.fn(async (url) => { calls.push(url); return { bars: secondaryFor(1) } })
    ensureAll([BREADTH], 'D', 200, fetcher)
    ensureAll([BREADTH], 'D', 200, fetcher)
    await fetchSecondaryBars(BREADTH, 'D', 200, fetcher)
    expect(calls.filter((u) => u.includes(`/${BREADTH}?`))).toHaveLength(1)
  })

  it('⛔ concurrent asks share ONE in-flight promise', async () => {
    let resolveIt
    const fetcher = vi.fn(() => new Promise((r) => { resolveIt = r }))
    const a = fetchSecondaryBars(SECURITY, 'D', 200, fetcher)
    const b = fetchSecondaryBars(SECURITY, 'D', 200, fetcher)
    expect(a).toBe(b)                       // the SAME promise, not two
    expect(inflightCount()).toBe(1)
    // ⚠️ `get(url)` runs inside a `.then`, so the fetcher has not been called
    // yet on this tick — wait one before reaching for its resolver.
    await Promise.resolve()
    resolveIt({ bars: [] })
    await a
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('⭐ a different timeframe is a different fetch — the runtime key is real', () => {
    expect(secondaryBarsUrl('QQQ', 'D', 200)).not.toBe(secondaryBarsUrl('QQQ', '5', 200))
  })

  it('⛔ SESSION IS NOT IN THE KEY — the endpoint has no such dimension', () => {
    // Inventing one would put a dimension in the cache key that changes nothing
    // about the bytes. Exact-t projection is what makes a session mismatch safe.
    expect(secondaryBarsUrl('QQQ', 'D', 200)).toBe('/api/bars/QQQ?tf=D&bars=200')
  })

  it('⭐ Compare Symbols can PRIME the cache — one symbol, one request, two consumers', () => {
    primeSecondaryBars(SECURITY, 'D', 200, { bars: secondaryFor(7) })
    const hit = cachedBars(SECURITY, 'D', 200)
    expect(hit.status).toBe(SOURCE_STATUS.AVAILABLE)
    expect(hit.bars).toHaveLength(bars.length)
  })

  it('⛔ an empty prime does not blank an entry that is already good', () => {
    primeSecondaryBars(SECURITY, 'D', 200, { bars: secondaryFor(7) })
    primeSecondaryBars(SECURITY, 'D', 200, undefined)      // Compare's first render
    expect(cachedBars(SECURITY, 'D', 200).bars).toHaveLength(bars.length)
  })
})

describe('availability — the product knows WHY, the evaluator still sees NaN', () => {
  it('⭐ loading is a state, not a blank', () => {
    const entry = ensureAll([SECURITY], 'D', 200, () => new Promise(() => {})).get(SECURITY)
    expect(entry.status).toBe(SOURCE_STATUS.LOADING)
  })

  it('⛔⛔ AN UNSUPPORTED SYMBOL IS NAMED AS SUCH — the cash-index case', async () => {
    // `/api/bars/^IXIC` answers an empty list WITH a note. That note is the
    // difference between "we do not serve this" and "there is nothing today",
    // and a member deserves to be told which.
    const fetcher = async () => ({ bars: [], sealed: false, note: 'index history not served by /api/bars-history' })
    await fetchSecondaryBars('^IXIC', 'D', 200, fetcher)
    const hit = cachedBars('^IXIC', 'D', 200)
    expect(hit.status).toBe(SOURCE_STATUS.UNSUPPORTED)
    expect(hit.bars).toEqual([])
  })

  it('⭐ an empty list WITHOUT a note is NO DATA, which is a different fact', async () => {
    await fetchSecondaryBars('ZZZZ', 'D', 200, async () => ({ bars: [] }))
    expect(cachedBars('ZZZZ', 'D', 200).status).toBe(SOURCE_STATUS.NO_DATA)
  })

  it('⛔ a FAILURE IS NOT CACHED — the next paint asks again', async () => {
    const out = await fetchSecondaryBars('QQQ', 'D', 200, async () => { throw new Error('boom') })
    expect(out.status).toBe(SOURCE_STATUS.ERROR)
    expect(cachedBars('QQQ', 'D', 200)).toBeNull()
  })

  it('⛔ an unsupported symbol never substitutes an ETF or the primary', async () => {
    const fetcher = async () => ({ bars: [], note: 'index history not served' })
    await fetchSecondaryBars('^IXIC', 'D', 200, fetcher)
    const secondary = new Map([['^IXIC', cachedBars('^IXIC', 'D', 200)]])
    // ⚠️ `^IXIC` PARSES FINE — it carries no delimiter, so it is a perfectly
    // well-formed source. It fails at AVAILABILITY, which is the distinction
    // this phase insists on: the string is not broken, the data is not served.
    expect(parseSource('sym:^IXIC:close')).toEqual({ kind: 'symbol', symbol: '^IXIC', field: 'close' })
    const one = maInst('legacy:movingAverage', 'sym:^IXIC:close')
    binder.sync(ctxFor([one], secondary))
    const bound = binder.bindings().find((b) => b.instanceId === one.instanceId)
    expect(drawnValues(bound)).toHaveLength(0)
  })
})

describe('⛔⛔ THE NO-FAMILY-BRANCH RAIL', () => {
  // Scoped to the three modules where execution must be generic. NOT a repo-wide
  // grep: `breadth` appears legitimately in catalogues, routers and widgets, and
  // a rail with false positives is a rail people learn to ignore — the exact
  // mistake made and corrected during the Alerts phase.
  const GENERIC = ['secondaryBars.js', 'symbolProjection.js']

  it.each(GENERIC)('%s contains no family branch', (file) => {
    const src = fs.readFileSync(path.resolve(__dirname, file), 'utf8')
    const code = src
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
      .join('\n')
    for (const forbidden of [/\bbreadth\b/i, /\bUCTA/i, /\bis_?etf\b/i, /\bisIndex\b/]) {
      expect(code).not.toMatch(forbidden)
    }
  })

  it("binder's symbol branch does not name a family", () => {
    const src = fs.readFileSync(path.resolve(__dirname, 'binder.js'), 'utf8')
    const at = src.indexOf("parsed.kind === 'symbol'")
    expect(at).toBeGreaterThan(0)
    const block = src.slice(at, at + 400)
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
    for (const forbidden of [/\bbreadth\b/i, /\bUCTA/i, /\betf\b/i]) {
      expect(block).not.toMatch(forbidden)
    }
  })
})
