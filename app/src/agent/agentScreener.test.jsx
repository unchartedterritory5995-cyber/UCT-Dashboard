import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import screenerSource from './capabilities/screener.js?raw'
import { manifestFor, buildContext, getCapability } from './capabilities'
import { registerBuiltins } from './builtins'
import { fastParse } from './fastPath'
import { _resetScreenerCache, loadMeta } from './capabilities/screener'
import { decodeSpec } from '../pages/screener/shell/specUrl'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'

registerBuiltins()
const CTX = { surface: 'charts' }

// The catalog shape /api/screener/fields serves.
const META = { fields: [
  { key: 'adr_pct', label: 'ADR %', type: 'range', unit: '%' },
  { key: 'price', label: 'Price', type: 'range', unit: '$' },
  { key: 'chg_pct_1m', label: 'Change 1M', type: 'range', unit: '%' },
  { key: 'above_50sma', label: 'Above 50 SMA', type: 'bool' },
  { key: 'sector', label: 'Sector', type: 'enum' },
] }
const ROWS = [
  { ticker: 'AAA', company: 'A Co', price: 12.5, chg_pct_1d: 1.2, adr_pct: 9.1 },
  { ticker: 'BBB', company: 'B Co', price: 44, chg_pct_1d: -0.4, adr_pct: 7.3 },
]
let calls
beforeEach(() => {
  _resetScreenerCache()
  calls = []
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null
    calls.push([init.method || 'GET', String(url), body])
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    if (url === '/api/screener/fields') return json(META)
    if (url === '/api/screener/saved-screens') return json({ saved: [{ id: 7, name: 'Momentum', spec: { filters: [{ key: 'chg_pct_1m', op: 'gte', min: 20 }], sort: { key: 'chg_pct_1m', dir: 'desc' } } }], starters: [{ id: 'starter_uct_50', name: 'UCT 50', spec: { filters: [], rank: { criteria: [] } } }] })
    if (url === '/api/screener/scan') {
      if (body.filters.some(f => f.key === 'price' && f.min === 999999)) return json({ detail: 'Price: that value is out of range' }, 400)
      return json({ total: 660, rows: ROWS.slice(0, body.page_size), snapshot_date: '2026-10-05', snapshot: { live: { state: 'live' } } })
    }
    if (url === '/api/agent/record') return json({ conversationId: 'ac_1' })
    return json({ conversations: [] })
  })
})
afterEach(() => { vi.restoreAllMocks() })

const run = (args) => getCapability('screener.run').answer(null, { filters: [], sort_field: null, sort_dir: null, mode: 'new', show: null, as: null, ...args })
const scanCalls = () => calls.filter(c => c[1] === '/api/screener/scan')

describe('Screener: the real engine, the real catalog', () => {
  it('the field catalog reaches the model compactly (keys from /fields, enum lists left out) — in full when the request could be a screen', async () => {
    await loadMeta()
    const { context, refMap } = buildContext({}, { ...CTX, message: 'find stocks with ADR above 5%' })
    const s = context.screener[0]
    expect(refMap[s.ref]).toEqual({ kind: 'screener', ref: 'screener' })
    expect(s.fields).toBe('adr_pct:ADR %(%);price:Price($);chg_pct_1m:Change 1M(%);above_50sma:Above 50 SMA(yes/no)')
    expect(s.fieldsDetail).toBeUndefined()
  })
  it('CONTEXT RELEVANCE: an unrelated request gets the field KEYS only (still discoverable), and says so', async () => {
    await loadMeta()
    const s = buildContext({}, { ...CTX, message: 'make the left chart weekly' }).context.screener[0]
    expect(s.fields).toBe('adr_pct,price,chg_pct_1m,above_50sma')
    expect(s.fieldsDetail).toMatch(/keys only/)
    const { screenRelevant } = await import('./capabilities/screener')
    for (const m of ['Find stocks with high ADR and open the top four in Charts', 'now only above $20', 'sort those by 1-month performance', 'exclude ETFs', 'what moved more than 10% today'])
      expect(screenRelevant(m), m).toBe(true)
    for (const m of ['make the left chart weekly', 'open my Swing layout', 'switch to bars', 'what is an EMA?'])
      expect(screenRelevant(m), m).toBe(false)
  })
  it('ACCEPTANCE: "ADR above 5% and price above $10" → the Screener\'s own wire spec, the real count, the rows it returned', async () => {
    const a = await run({ filters: [{ field: 'adr_pct', op: 'gt', value: 5, max: null }, { field: 'price', op: 'gt', value: 10, max: null }] })
    const [, , body] = scanCalls()[0]
    expect(body.filters).toEqual([{ key: 'adr_pct', op: 'gt', min: 5 }, { key: 'price', op: 'gt', min: 10 }])
    expect(a.text).toBe('660 stocks match (ADR % > 5% · Price > $10). Showing the first 2. Data: 2026-10-05 snapshot, live prices.')
    expect(a.table.rows.map(r => r.ticker)).toEqual(['AAA', 'BBB'])                       // exactly the server's rows
    const spec = decodeSpec(new URLSearchParams(a.link.href.split('?')[1]).get('s'))
    expect(spec.filters).toEqual({ adr_pct: { op: 'gt', min: 5 }, price: { op: 'gt', min: 10 } })   // the Screener's own door
  })
  it('"up at least 20% over the last month with ADR above 4%" uses the catalog\'s Change 1M field', async () => {
    await run({ filters: [{ field: 'chg_pct_1m', op: 'gte', value: 20, max: null }, { field: 'adr_pct', op: 'gt', value: 4, max: null }] })
    expect(scanCalls()[0][2].filters).toEqual([{ key: 'chg_pct_1m', op: 'gte', min: 20 }, { key: 'adr_pct', op: 'gt', min: 4 }])
  })
  it('an UNKNOWN field or bad value is refused before anything runs; a list field is not offered', async () => {
    expect(await run({ filters: [{ field: 'adr_pcx', op: 'gt', value: 5, max: null }] })).toBe('I didn\'t run it: the Screener has no field “adr_pcx”.')
    expect(await run({ filters: [{ field: 'sector', op: 'eq', value: 1, max: null }] })).toMatch(/no field “sector”/)
    expect(await run({ filters: [{ field: 'price', op: 'between', value: 20, max: 10 }] })).toMatch(/higher upper bound/)
    expect(await run({ filters: [{ field: 'above_50sma', op: 'eq', value: 3, max: null }] })).toMatch(/yes\/no/)
    expect(scanCalls()).toHaveLength(0)
  })
  it('the server\'s own refusal is passed through as a sentence', async () => {
    const r = await getCapability('screener.run').answer(null, { filters: [{ field: 'price', op: 'gt', value: 999999, max: null }], sort_field: null, sort_dir: null, mode: 'new', show: null }).catch(e => e.message)
    expect(String(r)).toMatch(/out of range/)
  })
  it('REFINE adds to / replaces within the last screen; NEW starts over', async () => {
    await run({ filters: [{ field: 'adr_pct', op: 'gt', value: 5, max: null }] })
    await run({ mode: 'refine', filters: [{ field: 'price', op: 'gt', value: 10, max: null }] })
    expect(scanCalls()[1][2].filters).toEqual([{ key: 'adr_pct', op: 'gt', min: 5 }, { key: 'price', op: 'gt', min: 10 }])
    await run({ mode: 'refine', filters: [{ field: 'adr_pct', op: 'gt', value: 8, max: null }] })
    expect(scanCalls()[2][2].filters).toEqual([{ key: 'price', op: 'gt', min: 10 }, { key: 'adr_pct', op: 'gt', min: 8 }])
    await run({ mode: 'new', filters: [{ field: 'price', op: 'lt', value: 20, max: null }] })
    expect(scanCalls()[3][2].filters).toEqual([{ key: 'price', op: 'lt', max: 20 }])
  })
  it('sorting uses a catalog field; "show the first N" is bounded', async () => {
    await run({ filters: [{ field: 'adr_pct', op: 'gt', value: 5, max: null }], sort_field: 'adr_pct', sort_dir: 'desc', show: 500 })
    expect(scanCalls()[0][2]).toMatchObject({ sort: { key: 'adr_pct', dir: 'desc' }, page_size: 25 })
    expect(await run({ filters: [], sort_field: 'nope', sort_dir: 'desc' })).toMatch(/no field “nope” to sort by/)
  })
  it('state questions answer from the LAST screen run here — and say the page itself is not visible', async () => {
    expect(fastParse('what filters am I using').ops[0].action).toBe('screener.state')
    expect(getCapability('screener.state').answer()).toMatch(/can't see the filters open on the Screener page/)
    await run({ filters: [{ field: 'adr_pct', op: 'gt', value: 5, max: null }], sort_field: 'adr_pct', sort_dir: 'desc' })
    expect(getCapability('screener.state').answer()).toBe('The last screen I ran: ADR % > 5%. Sorted by ADR %, highest first. 660 matches (data 2026-10-05).')
  })
  it('saved screens: listed, run by real id (fast path on an exact name), opened through the Screener\'s door', async () => {
    expect(await getCapability('screener.listSaved').answer()).toBe('Your screens: Momentum\nUCT starters: UCT 50')
    expect(fastParse('run my Momentum screen').ops[0]).toEqual({ action: 'screener.runSaved', args: { screen: '7', show: null, as: null } })
    expect(fastParse('run mom')).toBeNull()                                             // never guessed
    const a = await getCapability('screener.runSaved').answer(null, { screen: '7', show: null })
    expect(scanCalls()[0][2].filters).toEqual([{ key: 'chg_pct_1m', op: 'gte', min: 20 }])
    expect(a.text).toMatch(/^Momentum: 660 stocks match/)
    expect(a.link.href).toBe('/screener?savedScreen=7')
  })
  it('READ-ONLY: every Screener action is a query (nothing to undo); the manifest stays closed-schema', () => {
    const m = manifestFor(CTX)
    // Running screens is read-only; SAVED-screen management (savedScreens.js) is the only write.
    const sc = m.filter(c => c.name.startsWith('screener.') && getCapability(c.name).target === 'screener')
    expect(sc.map(c => c.name).sort()).toEqual(['screener.listSaved', 'screener.run', 'screener.runSaved', 'screener.state'])
    for (const c of sc) expect(getCapability(c.name).query).toBe(true)
    expect(m.filter(c => getCapability(c.name).target === 'savedScreens').map(c => c.name).sort())
      .toEqual(['screener.deleteSaved', 'screener.duplicateSaved', 'screener.renameSaved', 'screener.saveAs'])
    expect(m.length).toBe(77)                    // overnight Batch 8: + drawing.addLevel/style/remove/list. Batch 6: + template, defaults, goToDate, compare, custom tf, resize, 5 tab actions (rail-checked by agentContracts.test.js)
  })
  it('no Screener field is hard-coded in the Agent', () => {
    const src = screenerSource
    for (const k of ['adr_pct', 'chg_pct_1m', 'dollar_vol', 'market_cap']) expect(src).not.toContain(k)
  })
  it('the panel shows the rows and the Open-in-Screener link (results never written by the model)', async () => {
    render(<AgentPanel host={{ charts: { list: () => [], read: () => null } , otherWidgets: () => [] }} onClose={() => {}} />)
    await loadMeta()
    const box = screen.getByLabelText('Message UCT Agent')
    fireEvent.change(box, { target: { value: 'run my Momentum screen' } })
    // saved screens load on warm-up; give them a moment, then ask
    await new Promise(r => setTimeout(r, 30))
    fireEvent.change(box, { target: { value: 'run my Momentum screen' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    const table = await screen.findByTestId('agent-result-table')
    expect(table.textContent).toContain('AAA')
    expect(screen.getByTestId('agent-open-link').getAttribute('href')).toBe('/screener?savedScreen=7')
    expect(calls.some(c => c[1] === '/api/agent/turn')).toBe(false)
  })
})
