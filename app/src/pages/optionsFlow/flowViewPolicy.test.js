import { describe, it, expect } from 'vitest'
import {
  flowBaseFor,
  gexDteLabel,
  gexPayloadDte,
  applyStillOpenOverlay,
  capNoticeFor,
} from './flowViewPolicy'

describe('flowBaseFor — GEX/Dark Pool must not drag in the stocks CSV', () => {
  it('uses the matching endpoint for each real flow mode', () => {
    expect(flowBaseFor('stocks', 'stocks').base).toBe('/api/flow/data')
    expect(flowBaseFor('index', 'stocks').base).toBe('/api/flow/indexes-data')
  })

  it('PINS to the last flow mode for gex and darkpool', () => {
    // The bug: these fell through to the stocks url, so entering GEX from
    // Indexes fired a full ~12.4MB stocks download the user never sees AND
    // evicted the index dataset the worker was holding.
    expect(flowBaseFor('gex', 'index').base).toBe('/api/flow/indexes-data')
    expect(flowBaseFor('darkpool', 'index').base).toBe('/api/flow/indexes-data')
    expect(flowBaseFor('gex', 'stocks').base).toBe('/api/flow/data')
  })

  it('defaults sanely when no prior flow mode is known', () => {
    expect(flowBaseFor('gex', null).base).toBe('/api/flow/data')
  })
})

describe('gexPayloadDte — label the data you HAVE, not the button you clicked', () => {
  it('prefers the stamped request params', () => {
    expect(gexPayloadDte({ _reqDte: 'week', dteFilter: 'month' }, 'all')).toBe('week')
  })

  it('falls back to the API echo, then to UI state', () => {
    expect(gexPayloadDte({ dteFilter: 'month' }, 'all')).toBe('month')
    // dteFilter comes back null on an empty result (no 0DTE contracts on a
    // weekend), which is exactly why the stamp exists.
    expect(gexPayloadDte({ dteFilter: null }, '0dte')).toBe('0dte')
    expect(gexPayloadDte(null, 'week')).toBe('week')
  })

  it('labels every window', () => {
    expect(gexDteLabel('0dte')).toBe('0DTE')
    expect(gexDteLabel('week')).toBe('Weekly')
    expect(gexDteLabel('month')).toBe('Monthly')
    expect(gexDteLabel('all')).toBe('All')
  })
})

describe('applyStillOpenOverlay — never rank on quote coverage', () => {
  const mk = (sym, bull, bear, computable) => ({
    s: sym, bull, bear, _trades: [{ sym, computable }],
  })
  const compute = tk => {
    const c = tk[0].computable
    return { computable: c, bullOpen: c ? 500 : 0, bearOpen: c ? 250 : 0 }
  }

  it('overlays only the tickers it can actually compute', () => {
    const t = [mk('A', 1000, 400, true), mk('B', 900, 300, false)]
    const r = applyStillOpenOverlay(t, compute)
    expect(r).toEqual({ applied: true, priced: 1, total: 2 })
    expect(t[0].bull).toBe(500)
    expect(t[0]._bullRaw).toBe(1000)   // raw preserved
    // B is zeroed so it drops OUT of the ranking rather than being ranked on raw
    // premium against still-open rows — that comparison is meaningless.
    expect(t[1].bull).toBe(0)
    expect(t[1].bear).toBe(0)
  })

  it('does NOT apply when nothing is priced — raw stands, board is not blanked', () => {
    // THE BLANK-BOARD BUG: the enable gate only checks that priceCache is
    // non-empty, and that map is shared with every tab, so it can pass while
    // none of THESE tickers are priced. Blindly overlaying zeroed everything and
    // the board rendered "0 tickers" with no explanation.
    const t = [mk('A', 1000, 400, false), mk('B', 900, 300, false)]
    const r = applyStillOpenOverlay(t, compute)
    expect(r).toEqual({ applied: false, priced: 0, total: 2 })
    expect(t[0].bull).toBe(1000)   // untouched
    expect(t[1].bull).toBe(900)
  })

  it('recomputes bullPct from the still-open figures, not the raw ones', () => {
    const t = [mk('A', 9999, 1, true)]
    applyStillOpenOverlay(t, compute)
    expect(t[0].bullPct).toBe(67)  // 500 / 750
  })

  it('is safe on empty input and a broken compute fn', () => {
    expect(applyStillOpenOverlay([], compute).applied).toBe(false)
    const t = [mk('A', 10, 5, true)]
    expect(applyStillOpenOverlay(t, () => { throw new Error('boom') }).applied).toBe(false)
    expect(t[0].bull).toBe(10)     // untouched when we cannot compute
  })
})

describe('capNoticeFor — stop implying completeness the payload does not have', () => {
  // PRODUCTION runs FLOW_CSV_CAP_DAYS=2, so days>=2 all return exactly the top
  // 50,000 by premium. A "90d" view is the same budget spread thinner.
  it('says nothing for the uncapped 1-day view', () => {
    expect(capNoticeFor({ fetchDays: 1, rowCount: 96178 })).toBeNull()
  })

  it('flags every multi-day range that hit the ceiling', () => {
    for (const d of [2, 5, 20, 60, 90]) {
      const n = capNoticeFor({ fetchDays: d, rowCount: 50000 })
      expect(n, `days=${d} should be flagged`).not.toBeNull()
      expect(n.text).toBe('top 50,000 by premium')
    }
  })

  it('flags all_data', () => {
    expect(capNoticeFor({ fetchDays: 0, rowCount: 50000 })).not.toBeNull()
  })

  it('does NOT cry wolf when the range genuinely fits under the ceiling', () => {
    expect(capNoticeFor({ fetchDays: 5, rowCount: 12000 })).toBeNull()
  })

  it('leaves an explicit calendar range alone (scoped server-side to those dates)', () => {
    expect(capNoticeFor({ fetchDays: 0, dateFrom: '2026-07-16', dateTo: '2026-07-16', rowCount: 50000 })).toBeNull()
  })
})
