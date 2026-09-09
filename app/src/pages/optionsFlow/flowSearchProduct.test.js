// Shadow parity for the server-derived Search product.
//
//   LEGACY:  raw ticker feed -> client processFlowData(rows, erSoonSet)
//   NEW:     server processFlowData(rows, null) -> narrow product -> client overlay
//
// The two must be deep-equal on the ENTIRE Search-consumed projection. Every
// assertion carries a control, because this directory has already shipped one
// parity suite that compared two paths over expired fixture data, produced empty
// arrays on both sides, and passed for weeks.
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parseCSV, processFlowData, capBand } from './flowCompute'
import {
  buildSearchProduct, applyErOverlay, searchProductUsable, stampSearchProduct,
  SEARCH_CONSUMED_KEYS,
} from './flowSearchProduct'

const HERE = dirname(fileURLToPath(import.meta.url))
const CSV = resolve(HERE, '../../../public/flow-data.csv')

let rows
let syms

// LEGACY path: what the browser does today.
const legacy = (r, erSet) => {
  const D = processFlowData(r, erSet)
  return D ? { all_directional: D.all_directional || [], TICKER_DB: D.TICKER_DB || [] } : null
}
// NEW path: server computes with null, client overlays its own set.
const viaServer = (r, erSet) => applyErOverlay(buildSearchProduct(processFlowData(r, null)), erSet)

const forTicker = (sym) => rows.filter((x) => (x.ticker || x.sym || x.S || '').toUpperCase() === sym)

beforeAll(() => {
  rows = parseCSV(readFileSync(CSV, 'utf8'))
  syms = [...new Set(rows.map((r) => (r.ticker || r.sym || r.S || '').toUpperCase()).filter(Boolean))]
})

describe('the fixture exercises what the matrix claims', () => {
  it('CONTROL: real rows and many symbols', () => {
    expect(rows.length).toBeGreaterThan(1000)
    expect(syms.length).toBeGreaterThan(20)
  })

  it('CONTROL: heavy and thin tickers both exist, and differ materially', () => {
    const counts = syms.map((s) => [s, forTicker(s).length]).sort((a, b) => b[1] - a[1])
    const heavy = counts[0], thin = counts[counts.length - 1]
    expect(heavy[1]).toBeGreaterThan(20)
    expect(thin[1]).toBeGreaterThan(0)
    expect(heavy[1]).toBeGreaterThan(thin[1] * 3)
  })

  it('CONTROL: calls AND puts, and more than one cap band, are present', () => {
    const cps = new Set(rows.map((r) => (r.cp || '').toUpperCase()).filter(Boolean))
    expect(cps.size).toBeGreaterThan(1)
    const D = processFlowData(rows, null)
    expect(new Set(D.all_directional.map((t) => capBand(t.mktcap))).size).toBeGreaterThan(1)
  })
})

describe('LEGACY === NEW across the parity matrix', () => {
  const cases = () => {
    const counts = syms.map((s) => [s, forTicker(s).length]).sort((a, b) => b[1] - a[1])
    return [
      ['heavy-volume', forTicker(counts[0][0]), counts[0][0]],
      ['mid-volume', forTicker(counts[Math.floor(counts.length / 2)][0]), counts[Math.floor(counts.length / 2)][0]],
      ['thin', forTicker(counts[counts.length - 1][0]), counts[counts.length - 1][0]],
      ['whole-tape (multi-ticker, uncapped shape)', rows, '*'],
      ['empty feed', [], '(none)'],
    ]
  }

  for (const setName of ['empty set', 'populated set', 'materially different set']) {
    it(`matches with an ${setName}`, () => {
      const build = (all) => setName === 'empty set' ? new Set()
        : setName === 'populated set' ? new Set(all.slice(0, Math.floor(all.length / 2)))
          : new Set(all.slice(Math.floor(all.length / 2)))
      let compared = 0
      for (const [label, r, sym] of cases()) {
        const erSet = build(syms)
        const a = legacy(r, erSet)
        const b = viaServer(r, erSet)
        if (a === null || b === null) { expect(a).toEqual(b); continue }
        expect(b.all_directional, `${label} / ${setName} — all_directional`).toEqual(a.all_directional)
        expect(b.TICKER_DB, `${label} / ${setName} — TICKER_DB (${sym})`).toEqual(a.TICKER_DB)
        compared += a.all_directional.length + a.TICKER_DB.length
      }
      // CONTROL: the comparison touched real data, not five empty arrays.
      expect(compared, 'the matrix compared nothing').toBeGreaterThan(100)
    })
  }

  it('a ticker IN the earnings set and one OUT of it both round-trip', () => {
    const D0 = processFlowData(rows, null)
    const someSym = D0.all_directional[0].S
    const inSet = new Set([someSym])
    const outSet = new Set(['__NOT_A_REAL_TICKER__'])
    for (const s of [inSet, outSet]) {
      expect(viaServer(rows, s).all_directional).toEqual(legacy(rows, s).all_directional)
    }
    // CONTROL: those two sets really do produce different `er` on that symbol.
    const a = legacy(rows, inSet).all_directional.find((t) => t.S === someSym)
    const b = legacy(rows, outSet).all_directional.find((t) => t.S === someSym)
    expect(!!a.er).not.toBe(!!b.er)
  })

  it('⛔ CONTROL: the WRONG overlay set does NOT reproduce legacy', () => {
    const half = Math.floor(syms.length / 2)
    const right = new Set(syms.slice(0, half)), wrong = new Set(syms.slice(half))
    const base = buildSearchProduct(processFlowData(rows, null))
    expect(applyErOverlay(base, wrong).all_directional).not.toEqual(legacy(rows, right).all_directional)
  })
})

describe('the overlay cannot contaminate the shared base product', () => {
  it('⛔ does not mutate the base, and two overlays do not see each other', () => {
    // The base IS the cached response for a (ticker, source, version) key. If
    // the overlay wrote through it, one member's earnings set would leak into
    // an object another read inherits — a user-specific value poisoning a
    // user-independent cache.
    const base = buildSearchProduct(processFlowData(rows, null))
    const before = JSON.stringify(base)
    const a = applyErOverlay(base, new Set(syms.slice(0, 5)))
    const b = applyErOverlay(base, new Set())
    expect(JSON.stringify(base), 'the overlay mutated the shared base').toBe(before)
    // Fresh objects, not shared references.
    expect(a.all_directional[0]).not.toBe(base.all_directional[0])
    expect(a.TICKER_DB[0]).not.toBe(base.TICKER_DB[0])
    if (base.TICKER_DB[0] && base.TICKER_DB[0].t) {
      expect(a.TICKER_DB[0].t[0]).not.toBe(base.TICKER_DB[0].t[0])
    }
    // CONTROL: the two overlays genuinely differ, so this is not vacuous.
    const flipped = a.all_directional.filter((t, i) => !!t.er !== !!b.all_directional[i].er).length
    expect(flipped).toBeGreaterThan(0)
  })

  it('a null/absent set leaves the base untouched rather than forcing er false', () => {
    // `processFlowData(rows, null)` means "this caller is not the authority on
    // earnings" and lets the CSV's own column speak. Forcing every flag false
    // would be a different answer.
    const base = buildSearchProduct(processFlowData(rows, null))
    expect(applyErOverlay(base, null)).toBe(base)
    expect(applyErOverlay(base, undefined)).toBe(base)
  })
})

describe('cache identity fails closed and excludes erSoon', () => {
  const P = () => stampSearchProduct(buildSearchProduct(processFlowData(rows, null)),
    { sym: 'AMD', source: 'stocks', version: 'v1' })

  it('accepts only an exact match on ticker, source and version', () => {
    expect(searchProductUsable(P(), { sym: 'AMD', source: 'stocks', version: 'v1' })).toBe(true)
  })

  it('⛔ declines a different ticker, source, or tape version', () => {
    expect(searchProductUsable(P(), { sym: 'NVDA', source: 'stocks', version: 'v1' })).toBe(false)
    expect(searchProductUsable(P(), { sym: 'AMD', source: 'indexes', version: 'v1' })).toBe(false)
    expect(searchProductUsable(P(), { sym: 'AMD', source: 'stocks', version: 'v2' })).toBe(false)
  })

  it('⛔ two unknowns are NOT agreement', () => {
    expect(searchProductUsable({ all_directional: [], TICKER_DB: [] }, {})).toBe(false)
    expect(searchProductUsable(stampSearchProduct({ all_directional: [], TICKER_DB: [] },
      { sym: '', source: '', version: '' }), { sym: '', source: '', version: '' })).toBe(false)
  })

  it('declines a malformed or shapeless product', () => {
    expect(searchProductUsable(null, { sym: 'AMD', source: 'stocks', version: 'v1' })).toBe(false)
    expect(searchProductUsable({ sym: 'AMD', source: 'stocks', version: 'v1' },
      { sym: 'AMD', source: 'stocks', version: 'v1' })).toBe(false)
  })

  it('erSoon is NOT part of the identity', () => {
    // Putting it there would re-fragment the cache per member and undo the
    // entire reason the base product is computed with null.
    const p = P()
    expect(Object.keys(p)).toEqual(expect.not.arrayContaining(['er', 'erSoon', 'user', 'userId']))
    expect(searchProductUsable(p, { sym: 'AMD', source: 'stocks', version: 'v1', erSoon: ['ANY'] })).toBe(true)
  })
})

describe('the transport is worth making', () => {
  it('measures the projection against the full processFlowData result', () => {
    const D = processFlowData(rows, null)
    const fullGz = gzipSync(Buffer.from(JSON.stringify(D))).length
    const prodGz = gzipSync(Buffer.from(JSON.stringify(buildSearchProduct(D)))).length
    console.log('[search product] full processFlowData gzip=%d KB -> Search projection gzip=%d KB (-%d%%)',
      Math.round(fullGz / 1024), Math.round(prodGz / 1024), Math.round((1 - prodGz / fullGz) * 100))
    console.log('[search product] keys kept: %s of %d', SEARCH_CONSUMED_KEYS.join(','), Object.keys(D).length)
    expect(prodGz).toBeLessThan(fullGz)
  })
})
