// 3b parity: the server product must BE the client computation, and the
// transport must be worth making.
//
// ⛔ EVERY assertion here carries a control. The permanent rule in this
// directory was paid for: an earlier parity suite compared two code paths over
// expired-contract fixture data, both sides produced EMPTY arrays, and it
// passed vacuously for weeks. Only the control caught it. So each block below
// first proves the population it is about to compare is real.
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parseCSV, processFlowData, buildTopPickCandidates, capBand, freshnessFrom } from './flowCompute'
import {
  buildTopPickProduct, topPicksUsable, topPickVariant, reviveTopPickVariant, stripUnreadContracts,
  topPickVariantKeys, TOP_PICK_DATA_MODES, TOP_PICK_CAP_FILTERS,
} from './flowTopPicksProduct'

const HERE = dirname(fileURLToPath(import.meta.url))
const CSV = resolve(HERE, '../../../public/flow-data.csv')

// The page's classifier minus the runtime-fetched remote set, matching the
// idiom flowTopPicks.test.js already uses. Declared, not a table: the real
// predicate closes over remoteETFSet and that difference is exactly why the
// generation gate exists.
const isEtfFn = (sym, stocketf) => ['ETF', 'INDEX'].includes((stocketf || '').toUpperCase())

let D
let product

beforeAll(() => {
  D = processFlowData(parseCSV(readFileSync(CSV, 'utf8')), null)
  product = buildTopPickProduct(D, { isEtfFn, generation: 'gen-test-1' })
})

describe('the inputs this whole change is about are real', () => {
  it('CONTROL: the tape carries both raw arrays, non-trivially', () => {
    expect(Array.isArray(D.all_directional)).toBe(true)
    expect(Array.isArray(D.all_trades)).toBe(true)
    expect(D.all_directional.length).toBeGreaterThan(500)
    expect(D.all_trades.length).toBeGreaterThan(1000)
  })

  it('records what this tape actually is: a STOCKS view, no ETF rows', () => {
    // ⛔ Measured, not assumed. Every row in this fixture's `all_directional`
    // is `stocketf: "STOCK"`, so the four `index` variants are legitimately
    // EMPTY here. That is correct, not a bug: `dataMode` also selects the
    // DATASET (`/api/flow/data` vs `/api/flow/indexes-data`), so a stocks
    // aggregate contains no index rows to begin with. It is also why the FD
    // fast path finds nothing to drop and buildCharts runs zero times on a
    // default entry.
    //
    // The consequence for THIS suite is the important part: the `index x *`
    // parity cases below compare empty against empty, so they are VACUOUS on
    // this fixture and prove nothing on their own. The synthetic case that
    // follows is what actually proves classification is load-bearing.
    const etfRows = D.all_directional.filter(t => isEtfFn(t.S, t.stocketf))
    expect(etfRows.length).toBe(0)
    expect(D.all_directional.filter(t => !isEtfFn(t.S, t.stocketf)).length).toBeGreaterThan(0)
  })

  it('CONTROL: classification changes the answer — proven on rows that carry both', () => {
    // Fixture-independent. Take real rows and relabel half of them as ETFs; the
    // stocks and index variants must then partition, and each must be
    // non-empty. Without this the whole 8-variant enumeration could be
    // classification-blind and every assertion here would still pass.
    const rows = D.all_directional.slice(0, 400).map((t, i) => ({ ...t, stocketf: i % 2 ? 'ETF' : 'STOCK' }))
    const trades = D.all_trades.slice(0, 800).map((t, i) => ({ ...t, stocketf: i % 2 ? 'ETF' : 'STOCK' }))
    const mixed = buildTopPickProduct({ all_directional: rows, all_trades: trades },
      { isEtfFn, generation: 'g' })
    const stocksAd = mixed.variants['stocks|All'].adCount
    const indexAd = mixed.variants['index|All'].adCount
    expect(stocksAd).toBeGreaterThan(0)
    expect(indexAd).toBeGreaterThan(0)
    expect(stocksAd + indexAd).toBe(rows.length)
  })

  it('CONTROL: more than one cap band is represented', () => {
    const bands = new Set(D.all_directional.map(t => capBand(t.mktcap)))
    expect(bands.size).toBeGreaterThan(1)
  })
})

describe('server product === client computation, all eight variants', () => {
  it('produces exactly the eight variants, deterministically keyed', () => {
    expect(Object.keys(product.variants).sort()).toEqual(topPickVariantKeys().sort())
    expect(topPickVariantKeys()).toHaveLength(8)
  })

  it('CONTROL: the variants are not all identical to each other', () => {
    // Without this, "every variant matches its client twin" could hold while
    // the enumeration silently collapsed to one repeated answer.
    const shapes = topPickVariantKeys().map(k => JSON.stringify(product.variants[k].candidates.map(c => c.sym)))
    expect(new Set(shapes).size).toBeGreaterThan(1)
  })

  it('CONTROL: at least one variant has a non-empty candidate list', () => {
    const populated = topPickVariantKeys().filter(k => product.variants[k].candidates.length > 0)
    expect(populated.length).toBeGreaterThan(0)
  })

  for (const dataMode of TOP_PICK_DATA_MODES) {
    for (const capFilter of TOP_PICK_CAP_FILTERS) {
      it(`${dataMode} x ${capFilter} matches buildTopPickCandidates exactly`, () => {
        const local = buildTopPickCandidates(D.all_directional, D.all_trades,
          { dataMode, capFilter, isEtfFn, includeStandout: true })
        const served = topPickVariant(product, dataMode, capFilter)
        expect(served).not.toBeNull()
        // Full deep equality on the ranked list — ordering, fields, ties, nulls
        // — MODULO the one declared transport projection. The local side gets
        // the same strip applied, so this still fails on any other difference;
        // the CONTROL below proves the local side really does carry `contracts`,
        // so this is not equality-by-erasure.
        expect(served.candidates).toEqual(local.candidates.map(stripUnreadContracts))
        expect(served.standoutCandidates).toEqual(
          local.standoutCandidates ? local.standoutCandidates.map(stripUnreadContracts) : null)
        expect(served.adCount).toBe(local.ad.length)
      })
    }
  }

  it('ordering is preserved, not merely membership', () => {
    // A set-equal but re-ranked list would pass a naive membership check and be
    // a different product on screen — the table IS its ordering.
    const { candidates } = topPickVariant(product, 'stocks', 'All')
    const local = buildTopPickCandidates(D.all_directional, D.all_trades,
      { dataMode: 'stocks', capFilter: 'All', isEtfFn, includeStandout: true }).candidates
    expect(candidates.map(c => c.sym)).toEqual(local.map(c => c.sym))
    // CONTROL: a re-ranked copy would NOT satisfy the assertion above.
    if (candidates.length > 1) {
      const shuffled = [...candidates].reverse().map(c => c.sym)
      expect(shuffled).not.toEqual(local.map(c => c.sym))
    }
  })
})

describe('forcing includeStandout cannot move the ranked list', () => {
  it('candidates are identical with and without standout', () => {
    for (const dataMode of TOP_PICK_DATA_MODES) {
      const lazy = buildTopPickCandidates(D.all_directional, D.all_trades,
        { dataMode, capFilter: 'All', isEtfFn, includeStandout: false })
      const eager = buildTopPickCandidates(D.all_directional, D.all_trades,
        { dataMode, capFilter: 'All', isEtfFn, includeStandout: true })
      expect(eager.candidates).toEqual(lazy.candidates)
      expect(lazy.standoutCandidates).toBeNull()
    }
  })

  it('CONTROL: standout actually produces something for at least one variant', () => {
    // Otherwise "forcing it is harmless" would be true only because it is inert.
    const any = topPickVariantKeys().some(k => Array.isArray(product.variants[k].standoutCandidates)
      && product.variants[k].standoutCandidates.length > 0)
    expect(any).toBe(true)
  })
})

describe('the client-side filter toggles still work off the served fields', () => {
  it('Both / Calls / Puts / Unusual partition the served candidates', () => {
    const { candidates } = topPickVariant(product, 'stocks', 'All')
    expect(candidates.length).toBeGreaterThan(0)
    const calls = candidates.filter(c => c.dir === 'BULL')
    const puts = candidates.filter(c => c.dir === 'BEAR')
    expect(calls.length + puts.length).toBe(candidates.length)
    // Unusual reads hasUOA / volOI / mktcap / net / score — every one must have
    // survived serialization, or the toggle silently returns an empty table.
    const unusual = candidates.filter(c => c.hasUOA || c.volOI >= 3
      || (c.mktcap > 0 && c.mktcap < 10e9 && c.net >= c.mktcap * 0.001))
    expect(Array.isArray(unusual)).toBe(true)
    for (const c of candidates.slice(0, 5)) {
      for (const f of ['sym', 'dir', 'net', 'score', 'mktcap', 'volOI']) {
        expect(c, `candidate is missing "${f}" — a toggle reads it`).toHaveProperty(f)
      }
    }
  })

  it('survives a JSON round trip once revived — including the Date field', () => {
    // ⛔ THIS CAUGHT A REAL TRANSPORT DEFECT. `lastDate` on a candidate is a
    // Date object; JSON turns it into a string, so a naive round trip is NOT
    // equal and the two clock-derived fields would arrive stamped with SERVER
    // build time. reviveTopPickVariant restores the Date and re-derives
    // daysSince/freshLabel against the reader's clock.
    const now = new Date('2026-09-07T18:00:00Z')
    const wire = JSON.parse(JSON.stringify(product))
    for (const dataMode of TOP_PICK_DATA_MODES) {
      for (const capFilter of TOP_PICK_CAP_FILTERS) {
        const served = reviveTopPickVariant(topPickVariant(wire, dataMode, capFilter), now)
        const local = topPickVariant(product, dataMode, capFilter)
        expect(served.adCount).toBe(local.adCount)
        expect(served.candidates.length).toBe(local.candidates.length)
        served.candidates.forEach((c, i) => {
          const o = local.candidates[i]
          // Every field that is a pure function of the tape must be identical.
          for (const k of Object.keys(o)) {
            if (k === 'daysSince' || k === 'freshLabel') continue
            expect(c[k], `field "${k}" did not survive the wire`).toEqual(o[k])
          }
          // lastDate comes back as a real Date, not a string.
          if (o.lastDate) expect(c.lastDate).toBeInstanceOf(Date)
          // …and the clock-derived pair is re-derived against the reader's now.
          expect({ daysSince: c.daysSince, freshLabel: c.freshLabel })
            .toEqual(freshnessFrom(o.lastDate, now))
        })
      }
    }
  })

  it('CONTROL: a naive round trip WOULD differ — the revive is load-bearing', () => {
    // Without this, reviveTopPickVariant could be a no-op wrapper and the test
    // above would still pass.
    const withDate = product.variants['stocks|All'].candidates.find(c => c.lastDate)
    expect(withDate, 'no candidate carries a lastDate — the check below is vacuous').toBeTruthy()
    const naive = JSON.parse(JSON.stringify(withDate))
    expect(naive.lastDate).not.toBeInstanceOf(Date)
    expect(typeof naive.lastDate).toBe('string')
  })
})

describe('the generation gate fails closed', () => {
  it('accepts only an exact non-empty match', () => {
    expect(topPicksUsable(product, 'gen-test-1')).toBe(true)
  })

  it('declines mismatch, absent, empty, null and malformed', () => {
    expect(topPicksUsable(product, 'gen-test-2')).toBe(false)
    expect(topPicksUsable(product, '')).toBe(false)
    expect(topPicksUsable(product, null)).toBe(false)
    expect(topPicksUsable(product, undefined)).toBe(false)
    expect(topPicksUsable(null, 'gen-test-1')).toBe(false)
    expect(topPicksUsable({}, 'gen-test-1')).toBe(false)
    expect(topPicksUsable({ variants: {} }, 'gen-test-1')).toBe(false)
    expect(topPicksUsable({ generation: 'gen-test-1' }, 'gen-test-1')).toBe(false)
  })

  it('⛔ two unknowns are NOT agreement', () => {
    // The failure this is here to prevent: null === null is true, so a naive
    // equality check treats "neither side knows" as "both sides agree".
    expect(topPicksUsable({ generation: null, variants: {} }, null)).toBe(false)
    expect(topPicksUsable({ generation: '', variants: {} }, '')).toBe(false)
  })

  it('a product built without a generation can never be used', () => {
    const ungenerated = buildTopPickProduct(D, { isEtfFn })
    expect(ungenerated.generation).toBeNull()
    expect(topPicksUsable(ungenerated, 'anything')).toBe(false)
  })
})

describe('the transport is actually worth making', () => {
  it('measures the product against the raw arrays it replaces', () => {
    const rawJson = JSON.stringify({ all_directional: D.all_directional, all_trades: D.all_trades })
    const prodJson = JSON.stringify(product)
    const rawGz = gzipSync(Buffer.from(rawJson)).length
    const prodGz = gzipSync(Buffer.from(prodJson)).length

    const t0 = performance.now()
    buildTopPickProduct(D, { isEtfFn, generation: 'x' })
    const buildMs = performance.now() - t0

    // Reported, not merely asserted — the owner asked for the numbers.
    console.log('[3b cost] raw arrays  json=%d KB  gzip=%d KB  rows=%d+%d',
      Math.round(rawJson.length / 1024), Math.round(rawGz / 1024),
      D.all_directional.length, D.all_trades.length)
    console.log('[3b cost] 8-variant product  json=%d KB  gzip=%d KB  build=%d ms',
      Math.round(prodJson.length / 1024), Math.round(prodGz / 1024), Math.round(buildMs))

    // The whole justification: the derived product must be materially smaller
    // than the rows it removes from first paint. If this ever fails, 3b is not
    // worth shipping and the assertion is the honest place to find that out.
    expect(prodGz).toBeLessThan(rawGz / 2)
  })
})

describe('not-computable is distinguishable from computed-and-empty', () => {
  it('returns null when the dataset carries neither raw array', () => {
    expect(buildTopPickProduct({}, { isEtfFn })).toBeNull()
    expect(buildTopPickProduct(null, { isEtfFn })).toBeNull()
  })

  it('refuses to run without a classifier', () => {
    // Classification is load-bearing; defaulting it would silently pick a
    // universe. Mutation-checked: removing this throws nothing and ships a
    // wrong TOP 10.
    expect(() => buildTopPickProduct(D, {})).toThrow(/isEtfFn/)
  })
})

// ── The unread `contracts` projection ──────────────────────────────────────
describe('served candidates carry no unread contracts map', () => {
  it('CONTROL: the LOCAL computation still has contracts — the strip is real', () => {
    // Without this, "served has no contracts" could be true because the
    // computation stopped producing them at all, which would be a semantic
    // change rather than a transport one.
    const local = buildTopPickCandidates(D.all_directional, D.all_trades,
      { dataMode: 'stocks', capFilter: 'All', isEtfFn, includeStandout: true })
    const withMap = local.candidates.filter(c => c.contracts && Object.keys(c.contracts).length > 0)
    expect(withMap.length).toBeGreaterThan(0)
  })

  it('no candidate, standout, or _moreStrikes entry carries `contracts`', () => {
    let checked = 0
    const assertClean = (c) => {
      checked++
      expect(c).not.toHaveProperty('contracts')
      for (const m of (c._moreStrikes || [])) assertClean(m)
    }
    for (const k of topPickVariantKeys()) {
      const v = product.variants[k]
      v.candidates.forEach(assertClean)
      ;(v.standoutCandidates || []).forEach(assertClean)
    }
    // CONTROL: the sweep actually visited candidates.
    expect(checked).toBeGreaterThan(50)
  })

  it('⛔ everything the renderer READS survives, including inside _moreStrikes', () => {
    const v = product.variants['stocks|All']
    const c = v.candidates[0]
    for (const f of ['sym', 'dir', 'net', 'score', 'mktcap', 'volOI', 'topC',
                     'topCDisplayPrem', 'topCDisplayHits', 'daysSince', 'freshLabel']) {
      expect(c, `renderer reads "${f}"`).toHaveProperty(f)
    }
    // topC is a reference INTO the removed map; it must still be a full object.
    for (const f of ['cp', 'K', 'exp', 'oi', 'prem']) expect(c.topC).toHaveProperty(f)
    // _moreStrikes entries: the renderer reads m.topC.cp/K/exp and m.net.
    const withMore = (v.standoutCandidates || []).find(x => (x._moreStrikes || []).length > 0)
    if (withMore) {
      for (const m of withMore._moreStrikes) {
        expect(m).toHaveProperty('net')
        for (const f of ['cp', 'K', 'exp']) expect(m.topC).toHaveProperty(f)
        expect(m).not.toHaveProperty('contracts')
      }
    }
  })

  it('ranking, identity and standout membership are untouched', () => {
    for (const dataMode of TOP_PICK_DATA_MODES) {
      for (const capFilter of TOP_PICK_CAP_FILTERS) {
        const local = buildTopPickCandidates(D.all_directional, D.all_trades,
          { dataMode, capFilter, isEtfFn, includeStandout: true })
        const served = topPickVariant(product, dataMode, capFilter)
        expect(served.candidates.map(c => c.sym)).toEqual(local.candidates.map(c => c.sym))
        expect(served.candidates.map(c => c.net)).toEqual(local.candidates.map(c => c.net))
        expect(served.candidates.map(c => c.score)).toEqual(local.candidates.map(c => c.score))
        expect((served.standoutCandidates || []).map(c => c.sym))
          .toEqual((local.standoutCandidates || []).map(c => c.sym))
      }
    }
  })

  it('measures what the projection actually saves', () => {
    const withMap = { generation: product.generation, variants: {} }
    for (const k of topPickVariantKeys()) {
      const [dataMode, capFilter] = k.split('|')
      const l = buildTopPickCandidates(D.all_directional, D.all_trades,
        { dataMode, capFilter, isEtfFn, includeStandout: true })
      withMap.variants[k] = { candidates: l.candidates, standoutCandidates: l.standoutCandidates, adCount: l.ad.length }
    }
    const before = gzipSync(Buffer.from(JSON.stringify(withMap))).length
    const after = gzipSync(Buffer.from(JSON.stringify(product))).length
    console.log('[3b contracts] gzip %d KB -> %d KB (-%d%%)',
      Math.round(before / 1024), Math.round(after / 1024), Math.round((1 - after / before) * 100))
    expect(after).toBeLessThan(before)
  })
})
