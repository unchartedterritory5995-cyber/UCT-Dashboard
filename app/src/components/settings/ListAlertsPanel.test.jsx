// List alerts in Settings, Notifications, against a fake network (the real jsonFetcher runs).
// Rails:
//   * DARK BY DEFAULT: with the server setting off (404) the row renders nothing, the idiom of
//     the rows beside it; nothing either while the read is out, signed out or behind the paywall;
//   * the three switches are listed by name and Terminal code, every one starts OFF, and each
//     says how the member is told;
//   * a box shows the server's answer only: a write that lands checks it and says so, a write
//     that does not land says so and the box stays where the server has it;
//   * a failed read says the switches could not be read, with a Retry, and draws no box;
//   * ONE SOURCE OF TRUTH with the Terminal's own switch: a press there moves the box here.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor, within } from '@testing-library/react'
import { SWRConfig } from 'swr'

import ListAlertsPanel from './ListAlertsPanel'
import ListAlertSwitch from '../../pages/terminal/panels/ListAlertSwitch'
import { LIST_ALERTS_URL } from '../../pages/terminal/panels/listAlertModel'
import { expectNoAxeViolations } from '../../pages/journal-2-0/a11y/axeHarness'

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const KINDS = [
  ['highs52', 'H52', 'H52 HIGHS', 'New 52-week highs'],
  ['confluence', 'CONFL', 'CONFL', 'Confluence board'],
  ['repeat_contracts', 'ACCUM', 'ACCUM', 'Repeat-hit option contracts'],
]
const realFetch = globalThis.fetch
let server
let calls
const answer = () => ({
  available: true, follows: server.follows, rearm_sessions: 5, max_named: 12, checks_et: ['18:10', '21:50'],
  kinds: KINDS.map(([kind, code, command, name]) => ({ kind, on: server.on.has(kind), code, command, name })),
})
/** `over[METHOD]`: a number (that status) or an object (that 200 body); otherwise the fake server answers. */
function serve(over = {}) {
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    const u = new URL(String(url), 'http://x')
    calls.push([method, String(url), init.body ?? null])
    if (!u.pathname.startsWith(LIST_ALERTS_URL)) return json({ detail: 'not found' }, 404)
    const hit = over[method]
    if (typeof hit === 'number') return json({ detail: 'x' }, hit)
    if (hit !== undefined) return json(hit)
    if (method === 'PUT') {
      const kind = u.pathname.slice(LIST_ALERTS_URL.length + 1)
      if (JSON.parse(init.body).on) server.on.add(kind)
      else server.on.delete(kind)
    }
    return json(answer())
  })
}
const sent = (method) => calls.filter(([m]) => m === method)
const settled = async () => {
  await waitFor(() => expect(sent('GET').length).toBeGreaterThan(0))
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
}
function renderPanel({ withSwitch = null } = {}) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <ListAlertsPanel />
      {withSwitch ? <ListAlertSwitch kind={withSwitch} /> : null}
    </SWRConfig>,
  )
}
const box = (kind) => within(screen.getByTestId(`list-alerts-${kind}`)).getByRole('checkbox')
const said = () => screen.getByTestId('list-alerts-status').textContent

beforeEach(() => {
  server = { on: new Set(), follows: 12 }
  calls = []
})
afterEach(() => { cleanup(); globalThis.fetch = realFetch })

describe('Settings list alerts: dark by default', () => {
  it.each([[404], [401], [402]])('renders nothing when the read answers %i', async (code) => {
    serve({ GET: code })
    const { container } = renderPanel()
    await settled()
    expect(container.textContent).toBe('')
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing for an answer that does not say the alerts are available', async () => {
    serve({ GET: { ...answer(), available: false } })
    const { container } = renderPanel()
    await settled()
    expect(container.innerHTML).toBe('')
  })
})

describe('Settings list alerts: the switches', () => {
  it('lists the three lists by name and code, every one off, each saying how the member is told', async () => {
    serve()
    renderPanel()
    await screen.findByTestId('list-alerts-row')
    expect(screen.getByText('List alerts')).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: 'New 52-week highs (H52)' })).toBe(box('highs52'))
    expect(screen.getByRole('checkbox', { name: 'Confluence board (CONFL)' })).toBe(box('confluence'))
    expect(screen.getByRole('checkbox', { name: 'Repeat-hit option contracts (ACCUM)' })).toBe(box('repeat_contracts'))
    for (const [kind] of KINDS) expect(box(kind).checked).toBe(false)
    expect(screen.getByTestId('list-alerts-confluence').textContent).toContain(
      'Off. Switch it on for a note in the alert bell and one email, after the 6:10 PM ET check on trading days')
    expect(screen.getByTestId('list-alerts-notes').textContent).toBe(
      'A stock that is already on a list when you switch on is not announced; only a stock that comes onto it later is. '
      + 'A stock that stays on a list is said once, and again only after 5 sessions off it. '
      + 'At most one message per list each evening, naming up to 12 stocks. '
      + 'A second check at 9:50 PM ET sends only what the first could not.')
    expect(screen.getByTestId('list-alerts-status').getAttribute('role')).toBe('status')
    expect(said()).toBe('')
    expect(sent('PUT')).toEqual([])
  })

  it('a box is checked when the server says so', async () => {
    server.on = new Set(['confluence'])
    serve()
    renderPanel()
    await screen.findByTestId('list-alerts-row')
    expect([box('highs52').checked, box('confluence').checked, box('repeat_contracts').checked]).toEqual([false, true, false])
  })

  it('ticking a box sends {on: true} to that list, and the box follows the server\'s answer', async () => {
    serve()
    renderPanel()
    await screen.findByTestId('list-alerts-row')
    await act(async () => { fireEvent.click(box('repeat_contracts')) })
    await waitFor(() => expect(said()).toBe('Alert switched on for Repeat-hit option contracts.'))
    expect(sent('PUT')).toEqual([['PUT', '/api/alerts/lists/repeat_contracts', JSON.stringify({ on: true })]])
    expect(box('repeat_contracts').checked).toBe(true)
    expect(box('highs52').checked).toBe(false)
    await act(async () => { fireEvent.click(box('repeat_contracts')) })
    await waitFor(() => expect(said()).toBe('Alert switched off for Repeat-hit option contracts.'))
    expect(box('repeat_contracts').checked).toBe(false)
  })

  it('a write that did not land says so and the box stays where the server has it', async () => {
    serve({ PUT: 500 })
    renderPanel()
    await screen.findByTestId('list-alerts-row')
    await act(async () => { fireEvent.click(box('highs52')) })
    await waitFor(() => expect(said()).toBe('The alert for New 52-week highs could not be switched on just now. Nothing changed. Try again.'))
    expect(box('highs52').checked).toBe(false)
    expect(server.on.size).toBe(0)
  })

  it('a failed read says the switches could not be read, offers Retry, and draws no box', async () => {
    serve({ GET: 500 })
    renderPanel()
    const row = await screen.findByTestId('list-alerts-row')
    expect(row.textContent).toContain('Your list alert switches could not be read just now.')
    expect(row.textContent).toContain('Nothing here says whether an alert is on.')
    expect(screen.queryByRole('checkbox')).toBeNull()
    serve()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry' })) })
    await waitFor(() => expect(screen.getAllByRole('checkbox').length).toBe(3))
  })

  it('ONE SOURCE OF TRUTH: a press on the Terminal\'s own switch moves the box here', async () => {
    serve()
    renderPanel({ withSwitch: 'confluence' })
    await screen.findByTestId('terminal-list-alert')
    expect(sent('GET').length).toBe(1)
    expect(box('confluence').checked).toBe(false)
    await act(async () => { fireEvent.click(screen.getByTestId('terminal-list-alert-button')) })
    await waitFor(() => expect(box('confluence').checked).toBe(true))
    expect(sent('PUT')).toEqual([['PUT', '/api/alerts/lists/confluence', JSON.stringify({ on: true })]])
  })
})

describe('Settings list alerts: accessibility', () => {
  it('the switches, with a write result, and a failed read pass axe (WCAG A and AA)', async () => {
    serve()
    renderPanel()
    await screen.findByTestId('list-alerts-row')
    await act(async () => { fireEvent.click(box('confluence')) })
    await waitFor(() => expect(said()).not.toBe(''))
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ GET: 500 })
    renderPanel()
    await screen.findByTestId('list-alerts-row')
    await expectNoAxeViolations(document.body.firstElementChild)
  }, 60_000)
})
