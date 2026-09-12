import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AlertsPage from './AlertsPage'
import { AuthContext } from '../../context/AuthContext'

const navigate = vi.fn()
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig()),
  useNavigate: () => navigate,
}))

const api = { indicator: [], watchlist: [], fires: [], calls: [] }

vi.mock('swr', async (orig) => {
  const mod = await orig()
  return {
    ...mod,
    default: (key) => {
      if (!key) return { data: undefined }
      const url = Array.isArray(key) ? key[0] : key
      if (String(url).startsWith('/api/watchlist-alerts')) return { data: api.watchlist }
      if (String(url).includes('/fires')) return { data: { fires: api.fires } }
      return { data: { alerts: api.indicator } }
    },
    mutate: vi.fn(),
  }
})

vi.mock('../../hooks/useIndicatorAlerts', async (orig) => {
  const mod = await orig()
  return {
    ...mod,
    useIndicatorAlerts: () => ({ alerts: api.indicator, refresh: vi.fn() }),
    useAlertFires: () => ({ fires: api.fires, isLoading: false, error: null }),
    toggleIndicatorAlert: vi.fn(async (id) => { api.calls.push(['toggle', id]) }),
    deleteIndicatorAlert: vi.fn(async (id) => { api.calls.push(['delete', id]) }),
    snoozeIndicatorAlert: vi.fn(async (id, m) => { api.calls.push(['snooze', id, m]); return { ok: true } }),
    rearmIndicatorAlert: vi.fn(async (id) => { api.calls.push(['rearm', id]); return { ok: true } }),
  }
})

const DEF = 'u_275dadc9fafe'
const ind = (over = {}) => ({
  id: 1, sym: 'TSLA', tf: 'D', indicator: `${DEF}.value`, instance_label: 'Trend Up',
  condition: 'cross_above', threshold: 0.5, active: true, state: 'armed',
  trigger_count: 0, triggered_at: null, ...over,
})
const wl = (over = {}) => ({
  id: 'w1', sym: 'AAPL', target_price: 450, direction: 'above',
  is_active: 1, triggered_at: null, alert_type: 'price', ...over,
})

const mount = () => render(
  <AuthContext.Provider value={{ user: { id: 'u1' } }}>
    <MemoryRouter><AlertsPage /></MemoryRouter>
  </AuthContext.Provider>,
)

beforeEach(() => {
  api.indicator = []; api.watchlist = []; api.fires = []; api.calls = []
  navigate.mockClear()
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
})

describe('one Alerts product, three backends', () => {
  it('⭐⭐ condition, price and drawing alerts stand in ONE list', () => {
    api.indicator = [ind()]
    api.watchlist = [wl(), wl({ id: 'w2', drawing_id: 'd1', alert_type: 'trendline' })]
    mount()
    expect(screen.getByText('Trend Up')).toBeTruthy()
    expect(screen.getByText(/Price crosses above/)).toBeTruthy()
    expect(screen.getByText(/crosses this trendline/)).toBeTruthy()
  })

  it('⭐ the filter counts each kind, and filtering narrows the list', () => {
    api.indicator = [ind()]
    api.watchlist = [wl()]
    mount()
    expect(within(screen.getByRole('tab', { name: /Conditions/ })).getByText('1')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /Price/ }))
    expect(screen.queryByText('Trend Up')).toBeNull()
    expect(screen.getByText(/Price crosses above/)).toBeTruthy()
  })

  it('⭐⭐ WHAT · WHERE · WHEN · IS IT LIVE · LAST FIRED are all on the row', () => {
    api.indicator = [ind({ triggered_at: 1757635200 })]
    mount()
    const row = document.querySelector('[data-alert-id="1"]')
    expect(row.textContent).toMatch(/TSLA/)          // where
    expect(row.textContent).toMatch(/Trend Up/)      // what
    expect(row.textContent).toMatch(/becomes true/)  // when it triggers
    expect(row.textContent).toMatch(/1D/)            // the timeframe
    expect(row.textContent).toMatch(/Watching/)      // is it live
    expect(row.textContent).toMatch(/last fired/)    // when it last fired
  })

  it('⛔ the engine terminology never reaches the member', () => {
    api.indicator = [ind()]
    mount()
    expect(document.body.textContent).not.toMatch(/cross_above|fire_key|0\.5|u_275/)
  })
})

describe('⛔⛔ a row offers only what its backend can honour', () => {
  it('a PRICE alert has no pause, no mute, no re-arm and no history', () => {
    api.watchlist = [wl()]
    mount()
    const row = document.querySelector('[data-kind="price"]')
    const labels = [...row.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))
    expect(labels.some((l) => /Pause|Mute|again now|History/.test(l))).toBe(false)
    // …but it can be deleted and opened on a chart
    expect(labels.some((l) => /Delete/.test(l))).toBe(true)
    expect(labels.some((l) => /Open .* on a chart/.test(l))).toBe(true)
  })

  it('a CONDITION alert has pause, mute, history and delete', () => {
    api.indicator = [ind()]
    mount()
    const row = document.querySelector('[data-kind="condition"]')
    const labels = [...row.querySelectorAll('button')].map((b) => b.getAttribute('aria-label')).join(' ')
    expect(labels).toMatch(/Pause/)
    expect(labels).toMatch(/Mute/)
    expect(labels).toMatch(/History/)
    expect(labels).toMatch(/Delete/)
  })

  it('⭐⭐ RE-ARM APPEARS ONLY WHERE IT DOES SOMETHING', () => {
    // An alert comes back BY ITSELF when the condition goes false. Manual re-arm
    // is the advanced case of asking for it now, so it must not sit beside Pause
    // on every row as though it were an equal choice.
    api.indicator = [ind({ state: 'armed' })]
    const armed = mount()
    expect(armed.container.querySelector('[aria-label*="again now"]')).toBeNull()
    armed.unmount()

    api.indicator = [ind({ state: 'fired' })]
    const fired = mount()
    expect(fired.container.querySelector('[aria-label*="again now"]')).toBeTruthy()
  })
})

describe('the actions reach the shipped routes', () => {
  it('⭐ pause calls toggle', async () => {
    api.indicator = [ind()]
    mount()
    fireEvent.click(screen.getByRole('button', { name: /Pause Trend Up/ }))
    await waitFor(() => expect(api.calls).toContainEqual(['toggle', 1]))
  })

  it('⭐⭐ mute offers real windows and sends MINUTES', () => {
    api.indicator = [ind()]
    mount()
    fireEvent.click(screen.getByRole('button', { name: /Mute Trend Up/ }))
    const menu = screen.getByRole('menu')
    expect(within(menu).getByText('1 hour')).toBeTruthy()
    expect(within(menu).getByText('1 week')).toBeTruthy()
    fireEvent.click(within(menu).getByText('4 hours'))
    expect(api.calls).toContainEqual(['snooze', 1, 240])
  })

  it('⭐ "watch again now" calls rearm', async () => {
    api.indicator = [ind({ state: 'fired' })]
    mount()
    fireEvent.click(screen.getByRole('button', { name: /again now/ }))
    await waitFor(() => expect(api.calls).toContainEqual(['rearm', 1]))
  })

  it('⭐ delete routes to the right backend for each kind', async () => {
    api.indicator = [ind()]
    api.watchlist = [wl()]
    mount()
    fireEvent.click(screen.getByRole('button', { name: /Delete Trend Up/ }))
    await waitFor(() => expect(api.calls).toContainEqual(['delete', 1]))
    fireEvent.click(screen.getByRole('button', { name: /Delete Price crosses above/ }))
    // ⛔ a price alert is a watchlist row — deleting it through the indicator
    // route would 404 and the member would watch nothing happen
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/watchlist-alerts/w1', expect.objectContaining({ method: 'DELETE' }),
    ))
  })
})

describe('history, in the member’s words', () => {
  it('⭐⭐ the BAR is the time, and the verb is the policy’s', () => {
    api.indicator = [ind()]
    api.fires = [{
      id: 9, bar_time: 1757635200, fired_at: 1757650000,
      condition: 'cross_above', threshold: 0.5,
      delivery_channels: { in_app: 'ok', email: 'failed' },
    }]
    mount()
    fireEvent.click(screen.getByRole('button', { name: /History for Trend Up/ }))
    const row = document.querySelector('[data-alert-id="1"]')
    expect(row.textContent).toMatch(/1D bar/)
    expect(row.textContent).toMatch(/becomes true/)
    // ⭐ a channel that failed is named; "skipped" is not a failure
    expect(row.textContent).toMatch(/email not delivered/)
    expect(row.textContent).not.toMatch(/fire_key|cross_above/)
  })

  it('⭐ an alert that has never fired says so, rather than showing an empty box', () => {
    api.indicator = [ind()]
    api.fires = []
    mount()
    fireEvent.click(screen.getByRole('button', { name: /History for Trend Up/ }))
    expect(screen.getByText(/has not fired/)).toBeTruthy()
  })
})

describe('back to the chart', () => {
  it('⭐⭐ it navigates through the CANONICAL deep-link shape', () => {
    api.indicator = [ind()]
    mount()
    fireEvent.click(screen.getByRole('button', { name: /Open TSLA on a chart/ }))
    // `chartDeepLink.chartsLinkPath` — not a hand-typed query string
    expect(navigate).toHaveBeenCalledWith('/charts?sym=TSLA&tf=D')
  })

  it('⭐ a price alert has no timeframe, so the link carries only the symbol', () => {
    api.watchlist = [wl()]
    mount()
    fireEvent.click(screen.getByRole('button', { name: /Open AAPL on a chart/ }))
    expect(navigate).toHaveBeenCalledWith('/charts?sym=AAPL')
  })
})

describe('the empty state teaches the gesture', () => {
  it('⭐ it says where alerts come from', () => {
    mount()
    expect(screen.getByText(/No alerts yet/)).toBeTruthy()
    expect(screen.getByText(/click its bell/)).toBeTruthy()
  })
})
