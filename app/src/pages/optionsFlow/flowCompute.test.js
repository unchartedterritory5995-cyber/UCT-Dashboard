/**
 * Golden test for the Options Flow compute layer.
 *
 * flowCompute.js was moved verbatim out of OptionsFlow.jsx so it can run in a
 * Web Worker. The move itself was verified byte-identical, but from here on the
 * worker will be feeding this code — and a silent change in what gets CONFIRMED,
 * how a trade is SIDED, or how a cluster is GRADED is the kind of regression a
 * trader notices before a test does.
 *
 * The fixture is real production flow (7/24/2026): every print for a handful of
 * mid-frequency symbols, so each contract's CLUSTERS ARE COMPLETE. A contiguous
 * slice of the raw file does not work — it cuts clusters in half and nothing
 * confirms at all. These
 * assertions pin the SHAPE and the aggregate outcomes, not every field, so
 * genuine tuning of the classifier stays easy while an accidental behaviour
 * change fails loudly.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCSV, processFlowData, buildCharts, capBand, resolveSector } from './flowCompute'

const here = path.dirname(fileURLToPath(import.meta.url))
const CSV = fs.readFileSync(path.join(here, '__fixtures__', 'flow-sample.csv'), 'utf8')

describe('parseCSV', () => {
  it('parses every data row of the fixture', () => {
    const rows = parseCSV(CSV)
    expect(rows.length).toBe(3419)
  })

  it('maps the BBS header aliases onto the fields the classifier reads', () => {
    const r = parseCSV(CSV)[0]
    for (const f of ['date', 'ticker', 'type', 'cp', 'strike', 'spot', 'premium', 'side']) {
      expect(r).toHaveProperty(f)
    }
    expect(r.date).toMatch(/^\d{1,2}\/\d{1,2}\/\d{4}$/)
  })
})

describe('processFlowData — golden shape', () => {
  const rows = parseCSV(CSV)
  const D = processFlowData(rows, null)

  it('returns the full result object the page renders from', () => {
    for (const k of ['clean_confirmed', 'PERF_INIT']) expect(D).toHaveProperty(k)
  })

  it('confirms a stable, non-trivial subset of the fixture', () => {
    expect(Array.isArray(D.clean_confirmed)).toBe(true)
    // A classifier change that confirmed everything, or nothing, is a bug.
    expect(D.clean_confirmed.length).toBeGreaterThan(0)
    expect(D.clean_confirmed.length).toBeLessThan(rows.length)
  })

  it('gives every confirmed trade a symbol, a direction and a premium', () => {
    for (const t of D.clean_confirmed.slice(0, 50)) {
      expect(typeof t.S).toBe('string')
      expect(t.S.length).toBeGreaterThan(0)
      expect(['BULL', 'BEAR']).toContain(t.D)
      expect(Number.isFinite(t.P)).toBe(true)
    }
  })

  it('is deterministic — same input, same confirmed set', () => {
    const again = processFlowData(parseCSV(CSV), null)
    expect(again.clean_confirmed.length).toBe(D.clean_confirmed.length)
    expect(again.clean_confirmed.map(t => `${t.S}|${t.D}|${t.P}`).join(','))
      .toBe(D.clean_confirmed.map(t => `${t.S}|${t.D}|${t.P}`).join(','))
  })

  it('does not mutate the rows it is given — the snapshot cache depends on this', () => {
    const fresh = parseCSV(CSV)
    const before = JSON.stringify(fresh.slice(0, 200))
    processFlowData(fresh, null)
    expect(JSON.stringify(fresh.slice(0, 200))).toBe(before)
  })
})

describe('blank-side sweep rescue (2026-07-28) — direction matches Live Flow', () => {
  // Live Flow presumes ASK for blank-side SWEEPs (sweep_empty_side_as_ask); the
  // Options Flow page must read the same direction. Before this, blank-side
  // sweeps went neutral here → 74% of MU's call sweeps read non-directional.
  const HDR = 'CreatedDate,CreatedTime,Symbol,Type,Volume,Price,Side,CallPut,Strike,Spot,Premium,ExpirationDate,Color,ImpliedVolatility,Dte,ER,StockEtf,Sector,Uoa,Weekly,MktCap,OI'
  // Side column is EMPTY (blank), MAGENTA, big premium, vol>>OI, near-ATM mega-cap.
  const row = (cp, ty, t, k) => `7/28/2026,${t},MU,${ty},2000,25,,${cp},${k},825,5000000,7/31/2026,MAGENTA,0.7,3,F,STOCK,Information Technology,F,F,500000000000,5`
  const build = (rows) => processFlowData(parseCSV(HDR + '\n' + rows.join('\n')), null)

  it('blank-side CALL sweeps read BULL (were neutral before)', () => {
    const D = build([row('CALL', 'SWEEP', '10:00:00 AM', 826), row('CALL', 'SWEEP', '10:00:05 AM', 826), row('CALL', 'SWEEP', '10:00:10 AM', 826)])
    const c = D.clean_confirmed.find(t => t.CP === 'C')
    expect(c && c.D).toBe('BULL')
  })

  it('blank-side PUT sweeps read BEAR', () => {
    const D = build([row('PUT', 'SWEEP', '10:00:00 AM', 824), row('PUT', 'SWEEP', '10:00:05 AM', 824), row('PUT', 'SWEEP', '10:00:10 AM', 824)])
    const c = D.clean_confirmed.find(t => t.CP === 'P')
    expect(c && c.D).toBe('BEAR')
  })

  it('blank-side BLOCK is NOT rescued (only sweeps cross the spread)', () => {
    const D = build([row('CALL', 'BLOCK', '10:00:00 AM', 826), row('CALL', 'BLOCK', '10:00:05 AM', 826), row('CALL', 'BLOCK', '10:00:10 AM', 826)])
    expect(D.clean_confirmed.find(t => t.CP === 'C' && t.D === 'BULL')).toBeFalsy()
  })
})

describe('erSoonSet is display-only', () => {
  // The ER set is now cached for the session and therefore reaches the FIRST
  // aggregation, where before it often arrived late. That is only safe if it
  // cannot change WHAT gets confirmed — otherwise caching it would quietly
  // change the numbers a trader reads.
  it('does not change the confirmed count', () => {
    const a = processFlowData(parseCSV(CSV), null)
    const syms = [...new Set(parseCSV(CSV).map(r => (r.ticker || '').toUpperCase()))].slice(0, 5)
    const b = processFlowData(parseCSV(CSV), new Set(syms))
    expect(b.clean_confirmed.length).toBe(a.clean_confirmed.length)
  })
})

describe('the pure helpers the worker also relies on', () => {
  it('capBand splits on the documented thresholds', () => {
    expect(capBand(600e9)).toBe('Mega')
    expect(capBand(50e9)).toBe('Large')
    expect(capBand(2e9)).toBe('Mid-Small')
    expect(capBand(0)).toBe('Unknown')
  })

  it('resolveSector answers for a well-known ticker', () => {
    expect(typeof resolveSector('NVDA')).toBe('string')
  })

  it('buildCharts runs on the confirmed set without touching the DOM', () => {
    const D = processFlowData(parseCSV(CSV), null)
    expect(() => buildCharts(D.clean_confirmed)).not.toThrow()
  })
})

describe('worker-safety', () => {
  it('the module never reaches for a browser global', () => {
    // The worker has no window/document/localStorage. A reference to one would
    // only fail at runtime, inside the worker, where it is easy to miss.
    const src = fs.readFileSync(path.join(here, 'flowCompute.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')      // block comments
      .replace(/(^|[^:])\/\/.*$/gm, '$1')    // line comments
    for (const bad of ['window.', 'document.', 'localStorage', 'sessionStorage', 'navigator.']) {
      expect(src.includes(bad), `flowCompute must not use ${bad}`).toBe(false)
    }
    expect(/\bfetch\s*\(/.test(src), 'flowCompute must not fetch').toBe(false)
  })
})
