// CHARTS OUTCOME 2 — price alerts: the state on the fixture server with the real routes' semantics (GET / POST / DELETE
// /api/watchlist-alerts), written and re-read by the REAL alert capability. `m.st.alerts` is the server's book.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { open, outcomeSuite, afterEachOutcome, QUAD, QUAD_SYMS, chartAt, selectedChart, must, waitFor, proposalsNow } from './outcomeHarness'

vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
await outcomeSuite()
afterEach(afterEachOutcome)

const quad = (o = {}) => open(QUAD(), QUAD_SYMS, o)
const lib = (c) => must(c.alertLibrary?.[0]?.ref, 'alert library')
const CREATE = (c, symbol, price, direction) => ({ action: 'alert.create', target: lib(c), args: { symbol, price, direction } })
const alertRow = (c, symbol, when) => must((c.alerts || []).find(a => a.symbol === symbol && a.when.includes(when)), `alert ${symbol} ${when}`)
const DELETE = (c, symbol, when) => ({ action: 'alert.delete', target: alertRow(c, symbol, when).ref, args: {} })
const BOOK = [{ id: 'a1', sym: 'NVDA', target_price: 200, direction: 'above' }, { id: 'a2', sym: 'AMD', target_price: 90, direction: 'below' }]
const book = (m) => m.st.alerts.map(a => `${a.sym} ${a.direction} ${a.target_price}`).sort()
const posts = (m) => m.p.st.calls.filter(c => c[0] === 'POST' && c[1] === '/api/watchlist-alerts')
const deletes = (m) => m.p.st.calls.filter(c => c[0] === 'DELETE' && c[1].startsWith('/api/watchlist-alerts'))

describe('create', () => {
  it('nothing reaches the server until Apply; then exactly that alert, and the list reads it back', async () => {
    const m = quad({ selected: 'bl' })
    await m.say('alert me when this one goes above 210', (c) => [CREATE(c, selectedChart(c).symbol, 210, 'above')])
    expect(proposalsNow()).toHaveLength(1)
    expect(proposalsNow()[0].textContent).toMatch(/NVDA at or above \$210/)
    expect(posts(m)).toEqual([])
    await m.apply()
    await waitFor(() => expect(book(m)).toEqual(['NVDA above 210']))
    expect(posts(m)).toHaveLength(1)
    expect(posts(m)[0][2]).toEqual({ sym: 'NVDA', target_price: 210, direction: 'above', alert_type: 'price' })
    expect(m.lastReceipt().textContent).toMatch(/NVDA at or above \$210/)
    const out = await m.say('show my alerts')
    expect(out).toMatch(/NVDA at or above \$210 — active/)
    expect(m.p.turns()).toBe(1)                       // the list is answered without the model
  })
  it('"the top-left chart": the alert lands on that chart\'s symbol', async () => {
    const m = quad()
    await m.say('alert on the top-left chart below 300', (c) => [CREATE(c, chartAt(c, 'top-left').symbol, 300, 'below')])
    await m.apply()
    await waitFor(() => expect(book(m)).toEqual(['SPY below 300']))
  })
  it('the natural follow-up: Undo takes back exactly the alert it made, not the one already there', async () => {
    const m = quad({ seed: { alerts: BOOK } })
    await m.say('alert me when NVDA goes above 210', (c) => [CREATE(c, 'NVDA', 210, 'above')])
    await m.apply()
    await waitFor(() => expect(book(m)).toContain('NVDA above 210'))
    await m.say('undo')
    await waitFor(() => expect(book(m)).toEqual(['AMD below 90', 'NVDA above 200']))
  })
  it('a server that refuses the write: no alert, and no receipt claiming one', async () => {
    const m = quad()
    const base = globalThis.fetch
    globalThis.fetch = async (u, i = {}) => (u === '/api/watchlist-alerts' && i.method === 'POST' ? new Response('{"detail":"nope"}', { status: 500 }) : base(u, i))
    await m.say('alert me when NVDA goes above 210', (c) => [CREATE(c, 'NVDA', 210, 'above')])
    await m.apply()
    await waitFor(() => expect(m.p.transcript()).toMatch(/nope|couldn't|failed|nothing/i))
    expect(book(m)).toEqual([])
    expect(m.p.summaries().join(' ')).not.toMatch(/NVDA at or above \$210/)
  })
  it('a duplicate is refused before anything is written', async () => {
    const m = quad({ seed: { alerts: BOOK } })
    const out = await m.say('alert me when NVDA is above 200', (c) => [CREATE(c, 'NVDA', 200, 'above')])
    expect(out).toMatch(/already have an active alert/)
    expect(m.pending()).toBe(0)
    expect(posts(m)).toEqual([])
  })
})

describe('delete asks first, and is permanent', () => {
  it('the proposal says what goes and that it is permanent; Dismiss keeps it; "do it" on a new proposal deletes it; no Undo is offered', async () => {
    const m = quad({ seed: { alerts: BOOK } })
    await m.say('delete my NVDA alert', (c) => [DELETE(c, 'NVDA', '$200')])
    expect(proposalsNow()).toHaveLength(1)
    expect(proposalsNow()[0].textContent).toMatch(/NVDA at or above \$200/)
    expect(proposalsNow()[0].textContent).toMatch(/permanent/i)
    expect(deletes(m)).toEqual([])
    await m.dismiss()
    expect(book(m)).toEqual(['AMD below 90', 'NVDA above 200'])
    await m.say('delete my NVDA alert', (c) => [DELETE(c, 'NVDA', '$200')])
    await m.say('do it')
    await waitFor(() => expect(book(m)).toEqual(['AMD below 90']))
    expect(deletes(m)).toHaveLength(1)
    expect(m.lastReceipt().getAttribute('data-undoable')).not.toBe('true')
    const out = await m.say('show my alerts')
    expect(out).not.toMatch(/NVDA/)
  })
  it('the natural follow-up: "delete that one" right after creating it finds the newest row at the top of the book', async () => {
    const m = quad({ seed: { alerts: BOOK } })
    await m.say('alert me when NVDA goes above 210', (c) => [CREATE(c, 'NVDA', 210, 'above')])
    await m.apply()
    await waitFor(() => expect(book(m)).toContain('NVDA above 210'))
    await m.say('actually delete that one', (c) => { expect(c.alerts[0].when).toMatch(/\$210/); return [{ action: 'alert.delete', target: c.alerts[0].ref, args: {} }] })
    expect(proposalsNow()).toHaveLength(1)
    await m.apply()
    await waitFor(() => expect(book(m)).toEqual(['AMD below 90', 'NVDA above 200']))
  })
  it('an alert that went off after the proposal is not deleted behind the member\'s back', async () => {
    const m = quad({ seed: { alerts: BOOK } })
    await m.say('delete my NVDA alert', (c) => [DELETE(c, 'NVDA', '$200')])
    m.st.alerts = m.st.alerts.map(a => (a.id === 'a1' ? { ...a, is_active: 0, triggered_at: '2026-11-03T15:00:00Z' } : a))
    await m.apply()
    await waitFor(() => expect(m.p.idle()).resolves.toBeUndefined())
    expect(book(m)).toEqual(['AMD below 90', 'NVDA above 200'])
    expect(deletes(m)).toEqual([])
    expect(m.p.summaries().join(' ')).not.toMatch(/Deleted the alert/)
  })
})
