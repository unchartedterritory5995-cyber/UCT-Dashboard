// TERM-033 for the Agent (AUDIT bar, 2026-11-10): stock.profile's gateway statements read used to end in
// `.catch(() => null)`, so a read that FAILED became the same `null` as "the kind is not served": the profile then
// went out with no statements line and no word that they could not be read. A failure is now SAID and logged.
// (calendar.js and scanRefine.js carry their own cases in agentPageCalendar.test.jsx / agentScanRefine.test.jsx.)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./capabilities/marketDataFacts', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, readFundamentalsFacts: vi.fn(real.readFundamentalsFacts) }
})

const { getCapability } = await import('./capabilities')
const { registerBuiltins } = await import('./builtins')
const facts = await import('./capabilities/marketDataFacts')

registerBuiltins()

let warn
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  globalThis.fetch = vi.fn(async (url) => {
    const u = String(url)
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    if (u.startsWith('/api/fundamentals-full/')) return json({ ticker: 'NVDA', name: 'NVIDIA Corporation', sector: 'Technology', market_cap: 5.64e12, price: 233.49 })
    if (u.startsWith('/api/live-prices')) throw new Error('an Agent read called /api/live-prices')
    return json({}, 404)
  })
})
afterEach(() => { vi.restoreAllMocks() })

const profile = () => getCapability('stock.profile').answer(null, { symbol: 'NVDA' })

describe('stock.profile: a FAILED statements read is said, never dropped as if it were absent', () => {
  it('the read throws: the profile says the statements could not be read, states no statement figure, and logs the cause', async () => {
    facts.readFundamentalsFacts.mockRejectedValueOnce(new Error('gateway exploded'))
    const p = await profile()
    expect(p.text).toMatch(/^NVDA — NVIDIA Corporation · Technology/)               // the snapshot fields stay
    expect(p.text).toMatch(/\nFinancial statements: I couldn't read NVDA's financial statements from UCT's data gateway right now; no statement figure is stated\.\n/)
    expect(p.text).not.toMatch(/Income statement|Net income|newest period ending/)
    expect(p.present.items.map(i => i.label)).not.toContain('Net income')
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[uct-agent\] stock\.profile: the fundamentals read for NVDA failed \(gateway exploded\)/))
  })
  it('the kind is not served (null, no failure): the profile carries its snapshot fields alone and logs nothing, as before', async () => {
    facts.readFundamentalsFacts.mockResolvedValueOnce(null)
    const p = await profile()
    expect(p.text).toMatch(/^NVDA — NVIDIA Corporation · Technology/)
    expect(p.text).not.toMatch(/Financial statements/)
    expect(warn).not.toHaveBeenCalled()
  })
})
