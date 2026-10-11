// SCREENER RESULT REPORTING (2026-10-11 acceptance, owner option B): a screen sorted by RS Rank is
// described as RS-Rank-ordered only as far as the RETURNED rows carry an RS Rank. The screen itself is
// unchanged (whole market, rs_rank desc) — only the sentence about it.
//   all null   → "RS Rank data is unavailable for these results, so they are not in RS Rank order"
//   partial    → "by RS Rank (highest first); only K of these N have an RS Rank value — …"
//   all present → "by RS Rank (highest first)" (as before)
// The opt-in test at the bottom runs the same request against the REAL Screener route over the
// local 3,665-row snapshot copy (UCT_SCREENER_ROUTE=http://127.0.0.1:<port>).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'
import * as screenerMod from './capabilities/screener'

registerBuiltins()
const NODE_FETCH = globalThis.fetch   // the real one, before any test mocks it
const FIELDS = [
  { key: 'rs_rank', label: 'RS Rank', type: 'range', unit: '', category: 'technical' },
  { key: 'price', label: 'Price', type: 'range', unit: '$', category: 'descriptive' },
  { key: 'chg_pct_1d', label: 'Chg 1D', type: 'range', unit: '%', category: 'descriptive' },
]
const STRONGEST = { filters: [], sort_field: 'rs_rank', sort_dir: 'desc', mode: 'new', show: null, as: null, within: null }
const row = (ticker, rs, price = 100) => ({ ticker, company: ticker, price, chg_pct_1d: 0.5, rs_rank: rs })

let scans
function serve(rows, total = rows.length) {
  scans = []
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url === '/api/screener/fields') return json({ fields: FIELDS })
    if (url === '/api/screener/fields?options=1') return json({ options: {} })
    if (url === '/api/screener/saved-screens') return json({ saved: [], starters: [] })
    if (url === '/api/screener/scan') { scans.push(JSON.parse(init.body)); return json({ total, rows, snapshot_date: '2026-10-11' }) }
    return json({})
  })
}
beforeEach(() => { screenerMod._resetScreenerCache() })
afterEach(() => { vi.restoreAllMocks() })
const run = async (args = STRONGEST) => getCapability('screener.run').answer(null, args, null)

describe('RS Rank coverage of the RETURNED rows decides how the order is described', () => {
  it('ALL NULL: says RS Rank data is unavailable and does not call the order a ranking', async () => {
    serve(['XRAY', 'XPRO', 'XLK', 'USNA'].map(t => row(t, null)), 3665)
    const a = await run()
    expect(scans[0].sort).toEqual({ key: 'rs_rank', dir: 'desc' })            // the screen is unchanged
    expect(a.text).toMatch(/3,665 stocks match\./)
    expect(a.text).toMatch(/Showing the first 4 — RS Rank data is unavailable for these results, so they are not in RS Rank order\./)
    expect(a.text).not.toMatch(/by RS Rank|highest first/)
    expect(a.table.rows.map(r => r.rs_rank)).toEqual(['—', '—', '—', '—'])    // nothing invented
  })

  it('PARTIAL: keeps the ranking words and says exactly how many of the shown rows have an RS Rank', async () => {
    serve([row('PLTR', 99), row('HOOD', 98), row('NVDA', 97), row('XLK', null), row('SPY', null)], 120)
    const a = await run()
    expect(a.text).toMatch(/Showing the first 5 by RS Rank \(highest first\); only 3 of these 5 have RS Rank values — the other 2 have none and are not ranked by it\./)
    expect(a.table.rows.map(r => r.rs_rank)).toEqual(['99.00', '98.00', '97.00', '—', '—'])
  })

  it('FULL: the normal ranking description, unchanged', async () => {
    serve([row('PLTR', 99), row('HOOD', 98), row('NVDA', 97)])
    const a = await run()
    expect(a.text).toMatch(/Showing the first 3 by RS Rank \(highest first\)\./)
    expect(a.text).not.toMatch(/unavailable|only \d+ of these/)
  })

  it('a value of 0 is a real RS Rank (not "missing"); non-numbers are not', async () => {
    serve([row('A', 0), row('B', 'n/a'), row('C', null)])
    expect((await run()).text).toMatch(/only 1 of these 3 have RS Rank values/)
  })

  it('the refined follow-up is described by the same rule (price > $50, still sorted by RS Rank)', async () => {
    serve([row('PLTR', 99, 209), row('XLK', null, 198)])
    await run()
    const a = await run({ filters: [{ field: 'price', op: 'gt', value: 50, max: null, values: null }], sort_field: null, sort_dir: null, mode: 'refine', show: null, as: null, within: null })
    expect(scans[1].sort).toEqual({ key: 'rs_rank', dir: 'desc' })
    expect(scans[1].filters).toEqual([{ key: 'price', op: 'gt', min: 50 }])
    expect(a.text).toMatch(/only 1 of these 2 have RS Rank values/)
  })

  it('an unsorted screen says nothing about order', async () => {
    serve([row('A', null)])
    const a = await run({ filters: [{ field: 'price', op: 'gt', value: 50, max: null, values: null }], sort_field: null, sort_dir: null, mode: 'new', show: null, as: null, within: null })
    expect(a.text).toMatch(/Showing the first 1\./)
  })
})

const ROUTE = globalThis.process?.env?.UCT_SCREENER_ROUTE
describe('opt-in: the REAL Screener route over the local 3,665-row snapshot', () => {
  it.skipIf(!ROUTE)('"strongest" on real rows with no RS Rank says so; the refine keeps the screen', async () => {
    const realFetch = NODE_FETCH
    globalThis.fetch = vi.fn((url, init = {}) => realFetch(`${ROUTE}${url}`, { method: init.method || 'GET', headers: { 'content-type': 'application/json' }, body: init.body }))
    const a = await run()
    expect(a.text).toMatch(/^3,665 stocks match\. Showing the first 10 — RS Rank data is unavailable for these results, so they are not in RS Rank order\./)
    const b = await run({ filters: [{ field: 'price', op: 'gt', value: 50, max: null, values: null }], sort_field: null, sort_dir: null, mode: 'refine', show: null, as: null, within: null })
    expect(b.text).toMatch(/^1,343 stocks match \(Price > \$50\)\. Showing the first 10 — RS Rank data is unavailable/)
  })
})
