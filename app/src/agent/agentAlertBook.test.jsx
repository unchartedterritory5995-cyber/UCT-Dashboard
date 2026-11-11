// UCT Agent — "what alerts do I have" answers for the member's WHOLE alert book, and says so when it can't.
// It used to read the price alerts alone, so a member with only RSI alerts was told "You have no alerts."
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'
import { fastParse } from './fastPath'
import { _resetAlertCache } from './capabilities/alert'
import { _resetIndicatorAlertCache, loadIndicatorAlerts } from './capabilities/indicatorAlerts'
import { buildIndicatorAlertSource } from './host'
import { setupPanel, ONE } from './testing/panelHarness'

registerBuiltins()
const PRICE_ROUTE = '/api/watchlist-alerts'
const IND_ROUTE = '/api/indicator-alerts'
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
const CATALOG = [{ indicator: 'rsi', label: 'RSI', conditions: [], plots: [{ value: 'rsi', label: 'RSI', conditions: [], inputs: { period: 14 } }] }]
const price = (id, sym, o = {}) => ({ id, sym, target_price: 100, direction: 'above', is_active: true, triggered_at: null, alert_type: 'price', ...o })
const ind = (id, sym, o = {}) => ({ id, sym, indicator: 'rsi', condition: 'above', threshold: 70, tf: 'D', active: true, params_json: { period: 7 }, instance_label: 'RSI(7)', ...o })

let st
const handle = (u) => {
  if (u.startsWith(PRICE_ROUTE)) return st.priceFails ? json({ detail: 'nope' }, 500) : json(st.prices)
  if (u === `${IND_ROUTE}/catalog`) return json({ catalog: CATALOG, refusals: [] })
  if (u.startsWith(IND_ROUTE)) { st.indReads += 1; return st.indFails ? json({ detail: 'nope' }, 500) : json({ alerts: st.inds }) }
  return null
}
const host = () => ({ indicatorAlerts: buildIndicatorAlertSource() })
const ask = (args = {}, h = host()) => getCapability('alert.list').answer(null, { symbol: null, status: null, triggered_today: null, ...args }, h)

beforeEach(() => {
  st = { prices: [], inds: [], priceFails: false, indFails: false, indReads: 0 }
  _resetAlertCache(); _resetIndicatorAlertCache()
  globalThis.fetch = vi.fn(async (url) => handle(String(url)) || json({}))
})
afterEach(() => { vi.restoreAllMocks() })

describe('alert.list: the whole book', () => {
  it.each(['what alerts do I have', 'What alerts do I have?', 'my alerts', 'show my alerts', 'show me all my alerts', 'list my alerts'])('“%s” is the same request', (text) => {
    expect(fastParse(text, { host: {} })?.ops?.[0]?.action).toBe('alert.list')
  })
  it('both kinds: each named, each counted, nothing mixed', async () => {
    st.prices = [price('p1', 'AMD'), price('p2', 'TSLA', { is_active: false, triggered_at: '2026-11-02T15:00:00Z' })]
    st.inds = [ind(1, 'NVDA'), ind(2, 'NVDA', { active: false, params_json: { period: 14 }, instance_label: 'RSI(14)' })]
    const text = await ask()
    const [priceBlock, indicatorBlock, ...rest] = text.split('\n\n')
    expect(rest).toEqual([])
    expect(priceBlock).toMatch(/^Your price alerts \(2\):\n• AMD at or above \$100 — active\n• TSLA at or above \$100 — went off/)
    expect(indicatorBlock).toBe('Your indicator alerts (2):\n• NVDA RSI(7) above 70 (D) — active\n• NVDA RSI(14) above 70 (D) — paused')
  })
  it('⛔ only indicator alerts: never "you have no alerts"', async () => {
    st.inds = [ind(1, 'NVDA')]
    const text = await ask()
    expect(text).toMatch(/^You have no price alerts\.\n\nYour indicator alerts \(1\):\n• NVDA RSI\(7\) above 70 \(D\) — active$/)
  })
  it('only price alerts: the indicator half is answered too, not skipped', async () => {
    st.prices = [price('p1', 'AMD')]
    expect(await ask()).toMatch(/^Your price alerts \(1\):\n• AMD .*\n\nYou have no indicator alerts\.$/)
  })
  it('neither: one plain sentence', async () => expect(await ask()).toBe('You have no alerts.'))
  it('a symbol filters both kinds: "do I have an alert on NVDA" sees the RSI alert', async () => {
    st.prices = [price('p1', 'AMD')]
    st.inds = [ind(1, 'NVDA'), ind(2, 'AMD')]
    expect(await ask({ symbol: 'nvda' })).toBe('You have no price alerts on NVDA.\n\nYour indicator alerts on NVDA (1):\n• NVDA RSI(7) above 70 (D) — active')
    expect(await ask({ symbol: 'MSFT' })).toBe('You have no alerts on MSFT.')
  })
  it('"active" filters both kinds: a paused indicator alert is not active', async () => {
    st.prices = [price('p1', 'AMD')]
    st.inds = [ind(1, 'NVDA'), ind(2, 'TSLA', { active: false })]
    const text = await ask({ status: 'active' })
    expect(text).toContain('Your active price alerts (1):')
    expect(text).toContain('Your active indicator alerts (1):\n• NVDA RSI(7)')
    expect(text).not.toContain('TSLA')
  })
  it('an alert that cannot fire says so; "active" alone would be a false comfort', async () => {
    st.inds = [ind(1, 'NVDA', { instance_missing: true })]
    expect(await ask()).toMatch(/NVDA RSI\(7\) above 70 \(D\) — active \(needs attention: it can't fire\)/)
  })
  it('"went off" is a price-alert reading: named as such, the indicator list is not read as if it answered', async () => {
    st.prices = [price('p2', 'TSLA', { is_active: false, triggered_at: '2026-11-02T15:00:00Z' })]
    st.inds = [ind(1, 'NVDA')]
    const text = await ask({ status: 'triggered' })
    expect(text).toMatch(/^Your price alerts that went off \(1\):\n• TSLA/)
    expect(text).toMatch(/That covers price alerts only/)
    expect(text).not.toContain('NVDA')
    expect(st.indReads).toBe(0)
    expect(await ask({ triggered_today: true })).toMatch(/^You have no price alerts that went off today\.\n\nThat covers price alerts only/)
  })
})

describe('alert.list: a half it could not read is said, never counted as none', () => {
  it('the indicator list fails: the price half stands and the gap is stated, never "no indicator alerts"', async () => {
    st.prices = [price('p1', 'AMD')]
    st.indFails = true
    const text = await ask()
    expect(text).toMatch(/^Your price alerts \(1\):/)
    expect(text).toMatch(/I couldn't read your indicator alerts right now, so they aren't included\.$/)
    expect(text).not.toMatch(/no indicator alerts|no alerts/)
  })
  it('no price alerts and an unreadable indicator list is not "You have no alerts"', async () => {
    st.indFails = true
    expect(await ask()).toBe('You have no price alerts.\n\nI couldn\'t read your indicator alerts right now, so they aren\'t included.')
  })
  it('the indicator book answered from a stale cache is not what is shown: every answer reads it fresh', async () => {
    const h = host()
    st.inds = [ind(1, 'NVDA')]
    await loadIndicatorAlerts(h, { force: true })
    st.inds = []
    expect(await ask({}, h)).toBe('You have no alerts.')
  })
  it('the price list fails: says so and invents nothing', async () => {
    st.priceFails = true
    st.inds = [ind(1, 'NVDA')]
    expect(await ask()).toMatch(/^I couldn't read your alerts right now/)
  })
})

describe('through the REAL panel: what the member reads, no model turn', () => {
  let p
  beforeEach(() => { p = setupPanel() })
  afterEach(() => { cleanup() })
  it('"what alerts do I have" shows both kinds and writes nothing', async () => {
    const base = globalThis.fetch
    const calls = []
    globalThis.fetch = vi.fn((url, init) => { if (/alerts/.test(String(url))) calls.push(init?.method || 'GET'); const r = handle(String(url)); return r ? Promise.resolve(r) : base(url, init) })
    const [widgets, syms] = ONE('NVDA')
    const { say, h } = p.mount(widgets, syms)
    h.indicatorAlerts = buildIndicatorAlertSource()
    st.prices = [price('p1', 'AMD')]
    st.inds = [ind(1, 'NVDA')]
    await say('what alerts do I have')
    const seen = screen.getByTestId('agent-transcript').textContent
    expect(seen).toContain('Your price alerts (1):')
    expect(seen).toContain('AMD at or above $100 — active')
    expect(seen).toContain('Your indicator alerts (1):')
    expect(seen).toContain('NVDA RSI(7) above 70 (D) — active')
    expect(p.turns()).toBe(0)
    expect(st.indReads).toBeGreaterThan(0)
  }, 40000)
})
