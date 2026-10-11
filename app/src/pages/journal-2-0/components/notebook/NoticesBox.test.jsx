// @vitest-environment jsdom
// P0.4 -- Research Home's Notices box (owner decision 2, 2026-10-11: the desktop bell was removed
// by request, so resurfaced notes, task reminders and fill notices land on Home instead).
// The rows are the CAPTURED ones in lib/__fixtures__/notices.json (see its _provenance).
//   * folded by default, and renders NOTHING when empty or when a read fails;
//   * opening a notice marks it read; Dismiss does the same without leaving Home;
//   * one source failing leaves the other's notices on screen.
// ⛔ Copy and roles are asserted as rendered, after the action settles.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { SWRConfig } from 'swr'
import NoticesBox from './NoticesBox'
import { AuthContext } from '../../../../context/AuthContext'
import fx from '../../lib/__fixtures__/notices.json'

const ALERTS = '/api/alerts?limit=20'
const INSIGHTS = '/api/voice/insights'
const reminder = fx.alertsBody.find((a) => a.type === 'notebook_task_reminder')
const fill = fx.alertsBody.find((a) => a.type === 'notebook_entry_context_new_fill')
const insight = fx.insightsBody.insights[0]

let state
let calls
function res(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}
function failure(mode) {
  if (mode === 'network') throw new TypeError('Failed to fetch')
  return res(mode, {})
}
/** `fail` fails BOTH reads; `failAlerts` / `failInsights` fail one. A POST marks the row, like the server. */
function stubFetch({ alerts = fx.alertsBody, insights = fx.insightsBody.insights, fail, failAlerts, failInsights, failPost } = {}) {
  state = { alerts: structuredClone(alerts), insights: structuredClone(insights) }
  calls = []
  globalThis.fetch = vi.fn(async (url, init) => {
    const u = String(url)
    const method = init?.method || 'GET'
    calls.push({ url: u, method })
    if (method === 'POST') {
      if (failPost) throw new TypeError('Failed to fetch')
      const m = u.match(/^\/api\/alerts\/(.+)\/read$/)
      if (m) state.alerts = state.alerts.map((a) => (a.id === decodeURIComponent(m[1]) ? { ...a, read: true } : a))
      const d = u.match(/^\/api\/voice\/insights\/(.+)\/dismiss$/)
      if (d) state.insights = state.insights.map((i) => (String(i.id) === decodeURIComponent(d[1]) ? { ...i, dismissed_at: '2026-10-11 12:00:00' } : i))
      return res(200, { ok: true })
    }
    if (u === ALERTS) return fail || failAlerts ? failure(fail || failAlerts) : res(200, state.alerts)
    if (u === INSIGHTS) return fail || failInsights ? failure(fail || failInsights) : res(200, { insights: state.insights })
    return res(200, {})
  })
}
const fetchCalls = () => calls.filter((c) => c.method === 'GET').length
const postUrls = () => calls.filter((c) => c.method === 'POST').map((c) => c.url)

function Where() {
  const loc = useLocation()
  return <p data-testid="where">{`${loc.pathname}${loc.search}`}</p>
}
function renderBox({ user = { id: 'u1' } } = {}) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AuthContext.Provider value={{ user }}>
        <MemoryRouter initialEntries={['/journal/notebook']}>
          <NoticesBox />
          <Routes><Route path="*" element={<Where />} /></Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </SWRConfig>,
  )
}
const openBox = async (count) => {
  const summary = await screen.findByText(new RegExp(`Notices · ${count}`))
  fireEvent.click(summary)
  return summary
}

beforeEach(() => { window.localStorage.clear() })
afterEach(() => { vi.restoreAllMocks() })

describe('NoticesBox', () => {
  it('renders nothing when there is nothing to show', async () => {
    stubFetch({ alerts: [], insights: [] })
    const { container } = renderBox()
    await waitFor(() => expect(fetchCalls()).toBeGreaterThan(1))
    expect(container.querySelector('details')).toBeNull()
    expect(screen.queryByText(/Notices/)).toBeNull()
  })

  it('fetchFails: a 401/500/network failure leaves nothing on screen', async () => {
    for (const mode of [401, 500, 'network']) {
      stubFetch({ fail: mode })
      const { container, unmount } = renderBox()
      await waitFor(() => expect(fetchCalls()).toBeGreaterThan(1))
      await new Promise((r) => setTimeout(r, 20))
      expect(container.querySelector('details')).toBeNull()
      expect(screen.queryByText(/Notices/)).toBeNull()
      unmount()
    }
  })

  it('one failing source leaves the other one\'s notices on screen', async () => {
    stubFetch({ failInsights: 403 })
    renderBox()
    expect(await screen.findByText(/Notices · 2/)).toBeTruthy()
    stubFetch({ failAlerts: 500 })
    renderBox()
    expect(await screen.findByText(/Notices · 1/)).toBeTruthy()
  })

  it('starts folded, with the count on the summary', async () => {
    stubFetch()
    const { container } = renderBox()
    const summary = await screen.findByText(/Notices · 3/)
    expect(summary.tagName).toBe('SUMMARY')
    expect(container.querySelector('details').hasAttribute('open')).toBe(false)
  })

  it('reads nothing while nobody is signed in', async () => {
    stubFetch()
    const { container } = renderBox({ user: null })
    await new Promise((r) => setTimeout(r, 30))
    expect(fetchCalls()).toBe(0)
    expect(container.querySelector('details')).toBeNull()
  })

  it('lists the three notices with their titles and lines, and the links go where the rows say', async () => {
    stubFetch()
    const { container } = renderBox()
    await screen.findByText(/Notices · 3/)
    container.querySelector('details').open = true
    const rows = within(container.querySelector('ul')).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    const link = (name) => screen.getByRole('link', { name })
    expect(link('Tasks due today').getAttribute('href')).toBe('/journal/notebook?view=tasks')
    expect(link('New fill captured').getAttribute('href')).toBe('/journal?j2tab=positions')
    expect(link('NVDA reached 142.50, the stop you named').getAttribute('href')).toBe(insight.link)
    expect(screen.getByText('You have 1 task due today and 1 overdue task in your Notebook.')).toBeTruthy()
    expect(screen.getByText(/the stop you named/, { selector: 'a' })).toBeTruthy()
  })

  it('opening a reminder marks it read, and the notice leaves the box', async () => {
    stubFetch()
    renderBox()
    await openBox(3)
    fireEvent.click(screen.getByRole('link', { name: /Tasks due today/ }))
    await waitFor(() => expect(postUrls()).toContain(`/api/alerts/${reminder.id}/read`))
    await screen.findByText(/Notices · 2/)
    expect(screen.getByTestId('where').textContent).toBe('/journal/notebook?view=tasks')
  })

  it('Dismiss on an alert marks it read and stays on Home', async () => {
    stubFetch()
    renderBox()
    await openBox(3)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss New fill captured' }))
    await waitFor(() => expect(postUrls()).toContain(`/api/alerts/${fill.id}/read`))
    await screen.findByText(/Notices · 2/)
    expect(screen.queryByRole('link', { name: 'New fill captured' })).toBeNull()
    expect(screen.getByTestId('where').textContent).toBe('/journal/notebook')
  })

  it('Dismiss on a resurfaced note dismisses the insight, not an alert', async () => {
    stubFetch()
    renderBox()
    await openBox(3)
    fireEvent.click(screen.getByRole('button', { name: `Dismiss ${insight.headline}` }))
    await waitFor(() => expect(postUrls()).toEqual([`/api/voice/insights/${insight.id}/dismiss`]))
    await screen.findByText(/Notices · 2/)
  })

  it('a dismiss that did not reach the server leaves the notice where it was', async () => {
    stubFetch({ failPost: true })
    renderBox()
    await openBox(3)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Tasks due today' }))
    await waitFor(() => expect(postUrls()).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 30))
    expect(screen.getByText(/Notices · 3/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Tasks due today' })).toBeTruthy()
  })

  it('a resurfaced note whose link is not a Notebook door is a plain title with a Dismiss', async () => {
    stubFetch({ alerts: [], insights: [{ ...insight, link: 'https://evil.example/' }] })
    renderBox()
    await openBox(1)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText(insight.headline)).toBeTruthy()
    expect(screen.getByRole('button', { name: `Dismiss ${insight.headline}` })).toBeTruthy()
  })
})
