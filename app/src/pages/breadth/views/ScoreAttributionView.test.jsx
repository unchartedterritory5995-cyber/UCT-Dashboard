import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

const mockData = { current: null }
const mockUrls = []
vi.mock('swr', () => ({
  default: (url) => { mockUrls.push(url); return { data: mockData.current, isLoading: false, error: null } },
}))

const { default: ScoreAttributionView } = await import('./ScoreAttributionView')

const row = { date: '2026-08-28' }

describe('ScoreAttributionView', () => {
  it('draws a bar per component with its share of the total', () => {
    mockData.current = {
      ok: true, date: '2026-08-28', total: 80, min_weight_met: true,
      components: [
        { key: 'vix', label: 'VIX (inverted)', weight: 10, points: 10, max_points: 10, present: true, value: 18 },
        { key: 'ratio_5day', label: '5-day up/down ratio', weight: 15, points: 6, max_points: 15, present: true, value: 1.0 },
      ],
      prev: { date: '2026-08-27', total: 70,
              components: [{ key: 'vix', label: 'VIX (inverted)', weight: 10, points: 4, max_points: 10, present: true, value: 24 }] },
    }
    const { getByTestId } = render(<ScoreAttributionView rows={[row]} rowIdx={0} currentRow={row} options={{}} />)
    expect(getByTestId('attribution-component-vix').textContent).toMatch(/10 \/ 10/)
    expect(getByTestId('attribution-delta-vix').textContent).toMatch(/\+6/)
  })

  it('marks an absent component as dropped from the ratio, not as zero', () => {
    mockData.current = {
      ok: true, date: '2026-08-28', total: 80, min_weight_met: true,
      components: [
        { key: 'cboe_putcall', label: 'CBOE put/call (contrarian)', weight: 10, points: 0, max_points: 10, present: false, value: null },
      ],
      prev: null,
    }
    const { getByTestId } = render(<ScoreAttributionView rows={[row]} rowIdx={0} currentRow={row} options={{}} />)
    expect(getByTestId('attribution-component-cboe_putcall').textContent).toMatch(/not reported/i)
  })

  it('says so when the session was never recorded', () => {
    mockData.current = { ok: false, date: '2026-08-28', provisional: false,
                         reason: 'no stored session for that date' }
    const { getByTestId } = render(<ScoreAttributionView rows={[row]} rowIdx={0} currentRow={row} options={{}} />)
    expect(getByTestId('attribution-refusal').textContent).toMatch(/no stored session/i)
  })

  // 🔴 A LIVE ROW IS NOT A MISSING ONE. The cursor sits on the provisional row
  // for most of every trading day, and the server used to answer both cases
  // with "no stored session for that date" — telling a member today had never
  // been recorded. The server distinguishes them now; this is the wire.
  it('passes the provisional reason through instead of calling today missing', () => {
    mockData.current = {
      ok: false, date: '2026-08-29', provisional: true, latest_stored: '2026-08-28',
      reason: 'this session is still provisional — the 4:15 PM collector has not '
              + 'written it yet (latest stored session is 2026-08-28)',
    }
    const { getByTestId } = render(<ScoreAttributionView rows={[row]} rowIdx={0} currentRow={row} options={{}} />)
    const text = getByTestId('attribution-refusal').textContent
    expect(text).toMatch(/provisional/i)
    expect(text).not.toMatch(/no stored session/i)
  })

  // 🔴 THE SHAPE THAT TOOK THE WHOLE ROUTE DOWN. A 401 from `require_paid` on an
  // expired session — or a 503 — answers JSON, and `{detail: …}` has no `ok`
  // key at all. `data.ok === false` is `undefined === false`, so the refusal
  // branch was skipped and `data.components.filter(...)` threw; the nearest
  // boundary is `RouteErrorBoundary` in App.jsx, which replaces the ENTIRE
  // Breadth page and keeps it replaced until the route changes.
  it('🔴 renders the refusal — not a crash — when the body is a non-ok payload', () => {
    mockData.current = { detail: 'Subscription inactive' }
    let out
    expect(() => { out = render(<ScoreAttributionView rows={[row]} rowIdx={0} currentRow={row} options={{}} />) })
      .not.toThrow()
    expect(out.getByTestId('attribution-refusal').textContent).toMatch(/subscription inactive/i)
  })

  it('refuses a body whose components are not an array at all', () => {
    // The guard checks the shape the render NEEDS, not the shape a healthy
    // server happens to send — `ok: true` is not a promise of a components list.
    mockData.current = { ok: true, date: '2026-08-28', total: 80, components: null }
    const { getByTestId } = render(<ScoreAttributionView rows={[row]} rowIdx={0} currentRow={row} options={{}} />)
    expect(getByTestId('attribution-refusal')).toBeTruthy()
  })

  it('asks for the window the page actually loaded, not a fourth one', () => {
    // `get_history` caches per `days`; startup warms only 90. A hardcoded 400
    // meant a cold ~415-row fetch plus a full derivation pass every 5 minutes.
    mockData.current = { ok: true, date: '2026-08-28', total: 80, min_weight_met: true,
                         components: [], prev: null }
    const rows = Array.from({ length: 180 }, (_, i) => ({ date: `d${i}` }))
    render(<ScoreAttributionView rows={rows} rowIdx={0} currentRow={row} options={{}} />)
    expect(mockUrls.at(-1)).toBe('/api/breadth-monitor/score-components/2026-08-28?days=180')
  })
})
