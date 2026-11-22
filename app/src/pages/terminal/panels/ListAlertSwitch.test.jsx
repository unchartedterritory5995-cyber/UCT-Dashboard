// List alerts: the "Alert me when a stock I follow appears here" switch, against a fake network
// (the real jsonFetcher runs, so a 404, a 402, a 500 and a dropped connection reach the control
// the way they do live). Rails:
//   * DARK BY DEFAULT: with the server setting off (the route answers 404) NOTHING is drawn, and
//     nothing is drawn while the read is out, for a signed-out member or behind the paywall;
//   * every switch starts OFF, and nothing is written until the member presses it;
//   * NOTHING FLIPS BEFORE THE SERVER ANSWERS: while a write is out the switch still shows the old
//     state, and a second press sends nothing;
//   * every write outcome is said, and a write that did not land changes nothing on screen;
//   * the switches are read again after every write, and two controls on screen stay in step;
//   * a failed read is "could not be read" with a retry, never a switch that reads off;
//   * the control says how the member is told, and when there is nothing to alert on.
// The fixtures are the routes' real shapes (api/routers/list_alerts.py, tests/test_list_alerts.py).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import ListAlertSwitch from './ListAlertSwitch'
import { LIST_ALERTS_URL, LIST_ALERT_LABEL } from './listAlertModel'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const NETWORK = Symbol('no network')
const KINDS = [
  ['highs52', 'H52', 'H52 HIGHS', 'New 52-week highs'],
  ['confluence', 'CONFL', 'CONFL', 'Confluence board'],
  ['repeat_contracts', 'ACCUM', 'ACCUM', 'Repeat-hit option contracts'],
]

const realFetch = globalThis.fetch
/** What the fake server holds: which switches are on, and how many names the member follows. */
let server
let calls
const answer = () => ({
  available: true, follows: server.follows, rearm_sessions: 5, max_named: 12, checks_et: ['18:10', '21:50'],
  kinds: KINDS.map(([kind, code, command, name]) => ({ kind, on: server.on.has(kind), code, command, name })),
})
/**
 * `over[METHOD]`: a number (that status), an object (that 200 body), NETWORK (the request never
 * connects) or a function (called with the request, returns a Response or a promise of one).
 */
function serve(over = {}) {
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    const u = new URL(String(url), 'http://x')
    calls.push([method, String(url), init.body ?? null])
    if (!u.pathname.startsWith(LIST_ALERTS_URL)) return json({ detail: 'not found' }, 404)
    const hit = over[method]
    if (hit === NETWORK) throw new TypeError('Failed to fetch')
    if (typeof hit === 'number') return json({ detail: 'x' }, hit)
    if (typeof hit === 'function') return hit({ url: u, init })
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

function renderSwitch(kind = 'confluence', { second = null } = {}) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <ListAlertSwitch kind={kind} />
      {second ? <section data-testid="second"><ListAlertSwitch kind={second} /></section> : null}
    </SWRConfig>,
  )
}
const box = () => screen.getAllByTestId('terminal-list-alert')[0]
const button = () => screen.getAllByTestId('terminal-list-alert-button')[0]
const status = () => screen.getAllByTestId('terminal-list-alert-status')[0]
const how = () => screen.getAllByTestId('terminal-list-alert-how')[0].textContent
const press = async () => { await act(async () => { fireEvent.click(button()) }) }
const outcome = (kind) => waitFor(() => expect(status().getAttribute('data-outcome')).toBe(kind))
/** The read was asked, and everything it set off has had time to land. */
const settled = async () => {
  await waitFor(() => expect(sent('GET').length).toBeGreaterThan(0))
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
}

beforeEach(() => {
  server = { on: new Set(), follows: 37 }
  calls = []
})
afterEach(() => { cleanup(); globalThis.fetch = realFetch })

describe('list alert switch: dark by default', () => {
  it.each([[404, 'the server setting is off'], [401, 'signed out'], [402, 'not on a paid plan']])(
    'draws nothing at all when the read answers %i (%s)', async (code) => {
      serve({ GET: code })
      const { container } = renderSwitch()
      await settled()
      expect(container.innerHTML).toBe('')
      expect(sent('PUT')).toEqual([])
    })

  it('draws nothing while the read is out, so no switch appears and then disappears', async () => {
    let release
    serve({ GET: () => new Promise((resolve) => { release = () => resolve(json({ detail: 'x' }, 404)) }) })
    const { container } = renderSwitch()
    await settled()
    expect(container.innerHTML).toBe('')
    await act(async () => { release() })
    await settled()
    expect(container.innerHTML).toBe('')
  })

  it('draws nothing for an answer that does not say the alerts are available', async () => {
    serve({ GET: { ...answer(), available: false } })
    const { container } = renderSwitch()
    await settled()
    expect(container.innerHTML).toBe('')
  })

  it('draws nothing for a list that is not one of the three', async () => {
    serve()
    const { container } = renderSwitch('lows52')
    await settled()
    expect(container.innerHTML).toBe('')
  })
})

describe('list alert switch: reading', () => {
  it('starts off, is one toggle button with the label, says how the member is told, and writes nothing', async () => {
    serve()
    renderSwitch('confluence')
    await screen.findByTestId('terminal-list-alert')
    expect(box().getAttribute('data-on')).toBe('false')
    expect(box().getAttribute('data-kind')).toBe('confluence')
    expect(screen.getByRole('button', { name: LIST_ALERT_LABEL, pressed: false })).toBe(button())
    expect(how()).toBe('Off. Switch it on for a note in the alert bell and one email, after the 6:10 PM ET check on trading days, when a stock on your watchlists or your Flagged list comes onto the confluence board.')
    // a status region is there before anything is written, and it is empty
    expect(status().getAttribute('role')).toBe('status')
    expect(status().textContent).toBe('')
    expect(sent('PUT')).toEqual([])
    expect(sent('GET')).toEqual([['GET', LIST_ALERTS_URL, null]])
  })

  it('a switch the server holds as on is drawn pressed, with the word On beside it', async () => {
    server.on.add('highs52')
    serve()
    renderSwitch('highs52')
    await screen.findByTestId('terminal-list-alert')
    expect(button().getAttribute('aria-pressed')).toBe('true')
    expect(how().startsWith('On: a note in the alert bell and one email')).toBe(true)
    expect(how().endsWith('New 52-week highs only, not lows.')).toBe(true)
  })

  it('a member who follows nothing is told there is nothing to alert on', async () => {
    server.follows = 0
    serve()
    renderSwitch('confluence')
    await screen.findByTestId('terminal-list-alert')
    expect(how()).toBe('You have no stocks on a watchlist and none flagged yet, so there is nothing to alert on.')
  })

  it.each([[500], [503], [403]])('a read that fails with %i says the switch could not be read, offers a retry, and draws no switch', async (code) => {
    serve({ GET: code })
    renderSwitch()
    const note = await screen.findByTestId('terminal-list-alert-error')
    expect(note.getAttribute('role')).toBe('status')
    expect(note.textContent).toContain('Your alert switch for this list could not be read just now.')
    expect(note.textContent).toContain('So this panel cannot say whether the alert is on.')
    expect(screen.queryByTestId('terminal-list-alert-button')).toBeNull()
    serve()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry the alert switch' })) })
    await screen.findByTestId('terminal-list-alert')
    expect(button().getAttribute('aria-pressed')).toBe('false')
  })

  it('a dropped connection and an unreadable answer are "could not be read", never a switch that reads off', async () => {
    serve({ GET: NETWORK })
    renderSwitch()
    await screen.findByTestId('terminal-list-alert-error')
    expect(screen.queryByTestId('terminal-list-alert')).toBeNull()
    cleanup()
    serve({ GET: { rows: [] } })
    renderSwitch()
    expect((await screen.findByTestId('terminal-list-alert-error')).textContent).toContain('could not be read just now')
  })

  it('a kind the answer does not carry is not drawn (never guessed as off)', async () => {
    serve({ GET: { ...answer(), kinds: answer().kinds.filter((k) => k.kind !== 'confluence') } })
    const { container } = renderSwitch('confluence')
    await settled()
    expect(container.innerHTML).toBe('')
  })
})

describe('list alert switch: writing', () => {
  it('a press that lands: {on: true} is sent to that list, the result is said, and the same button is now pressed', async () => {
    serve()
    renderSwitch('confluence')
    await screen.findByTestId('terminal-list-alert')
    const before = button()
    before.focus()
    await press()
    await outcome('on')
    expect(sent('PUT')).toEqual([['PUT', '/api/alerts/lists/confluence', JSON.stringify({ on: true })]])
    expect(status().textContent).toBe('Alert switched on for Confluence board.')
    expect(button()).toBe(before)
    expect(document.activeElement).toBe(before)
    expect(button().getAttribute('aria-pressed')).toBe('true')
    expect(box().getAttribute('data-on')).toBe('true')
    expect(how().startsWith('On: ')).toBe(true)
    // and the switches were read again after the write
    await waitFor(() => expect(sent('GET').length).toBe(2))
  })

  it('pressing again switches it off', async () => {
    server.on.add('confluence')
    serve()
    renderSwitch('confluence')
    await screen.findByTestId('terminal-list-alert')
    await press()
    await outcome('off')
    expect(sent('PUT')).toEqual([['PUT', '/api/alerts/lists/confluence', JSON.stringify({ on: false })]])
    expect(status().textContent).toBe('Alert switched off for Confluence board.')
    expect(button().getAttribute('aria-pressed')).toBe('false')
    expect(server.on.has('confluence')).toBe(false)
  })

  it('NOTHING FLIPS BEFORE THE SERVER ANSWERS, and a second press while it is out sends nothing', async () => {
    let release
    serve({ PUT: () => new Promise((resolve) => { release = () => { server.on.add('confluence'); resolve(json(answer())) } }) })
    renderSwitch('confluence')
    await screen.findByTestId('terminal-list-alert')
    await press()
    expect(button().getAttribute('aria-pressed')).toBe('false')
    expect(box().getAttribute('data-on')).toBe('false')
    expect(button().textContent).toBe('Switching the alert on')
    expect(button().getAttribute('aria-disabled')).toBe('true')
    expect(button().getAttribute('aria-busy')).toBe('true')
    await press()
    await press()
    expect(sent('PUT').length).toBe(1)
    await act(async () => { release() })
    await outcome('on')
    expect(button().getAttribute('aria-pressed')).toBe('true')
    expect(button().textContent).toBe(LIST_ALERT_LABEL)
    expect(button().getAttribute('aria-disabled')).toBeNull()
  })

  it.each([
    [500, 'The alert for Confluence board could not be switched on just now. Nothing changed. Try again.'],
    [402, 'List alerts need a paid plan, so the alert for Confluence board was not switched on.'],
    [401, 'You are signed out, so the alert for Confluence board was not switched on. Sign in again.'],
    [404, 'List alerts are not switched on for this server, so the alert for Confluence board was not switched on.'],
  ])('a write refused with %i says so and leaves the switch off', async (code, text) => {
    serve({ PUT: code })
    renderSwitch('confluence')
    await screen.findByTestId('terminal-list-alert')
    await press()
    await outcome('failed')
    expect(status().textContent).toBe(text)
    expect(button().getAttribute('aria-pressed')).toBe('false')
    expect(server.on.size).toBe(0)
  })

  it('a write whose answer was lost says it cannot know, and the re-read shows the server\'s truth', async () => {
    // the write LANDED on the server and the connection dropped before the answer
    serve({ PUT: async ({ url }) => { server.on.add(url.pathname.split('/').pop()); throw new TypeError('Failed to fetch') } })
    renderSwitch('confluence')
    await screen.findByTestId('terminal-list-alert')
    await press()
    await outcome('failed')
    expect(status().textContent).toBe('The server could not be reached, so this control cannot say whether the alert for Confluence board was switched on. Your switches are being read again. If nothing changed, try again.')
    await waitFor(() => expect(button().getAttribute('aria-pressed')).toBe('true'))
  })

  it('a switch the server left where it was is said, and stays where the server has it', async () => {
    serve({ PUT: () => json(answer()) })   // answers the switches, unchanged
    renderSwitch('confluence')
    await screen.findByTestId('terminal-list-alert')
    await press()
    await outcome('mismatch')
    expect(status().textContent).toBe('The server did not change the alert for Confluence board. It is still off.')
    expect(button().getAttribute('aria-pressed')).toBe('false')
  })

  it('an answer the control cannot read claims nothing, and the switches are read again', async () => {
    serve({ PUT: { ok: true } })
    renderSwitch('confluence')
    await screen.findByTestId('terminal-list-alert')
    await press()
    await outcome('unreadable')
    expect(status().textContent).toContain('cannot say whether the alert for Confluence board changed')
    expect(button().getAttribute('aria-pressed')).toBe('false')
    await waitFor(() => expect(sent('GET').length).toBe(2))
  })

  it('the switches the server sent WITH the write are kept when the re-read after it fails', async () => {
    serve()
    renderSwitch('confluence')
    await screen.findByTestId('terminal-list-alert')
    serve({ GET: 500 })
    await press()
    await outcome('on')
    await waitFor(() => expect(sent('GET').length).toBe(2))   // the re-read was asked, and failed
    await settled()
    expect(button().getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByTestId('terminal-list-alert-error')).toBeNull()
  })

  it('two controls on screen share one read: a press on one list never moves the other, and both follow the server', async () => {
    serve()
    renderSwitch('confluence', { second: 'highs52' })
    await waitFor(() => expect(screen.getAllByTestId('terminal-list-alert').length).toBe(2))
    expect(sent('GET').length).toBe(1)
    await press()
    await outcome('on')
    const [first, other] = screen.getAllByTestId('terminal-list-alert')
    expect(first.getAttribute('data-on')).toBe('true')
    expect(other.getAttribute('data-on')).toBe('false')
    // the other control says nothing about a write that was not its own
    expect(screen.getAllByTestId('terminal-list-alert-status')[1].textContent).toBe('')
    // the server changed behind both (another tab): the next read moves both
    server.on = new Set(['highs52'])
    await press()
    await waitFor(() => expect(screen.getAllByTestId('terminal-list-alert')[1].getAttribute('data-on')).toBe('true'))
  })
})

describe('list alert switch: the look', () => {
  it('uses the panel stylesheet and no colour of its own', () => {
    for (const file of ['ListAlertSwitch.jsx', 'useListAlerts.js', 'listAlertModel.js']) {
      const text = fs.readFileSync(path.join(HERE, file), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${file}`, text).map((h) => h.lit), file).toEqual([])
    }
  })

  it('sets no timer and no poll of its own', () => {
    for (const file of ['ListAlertSwitch.jsx', 'useListAlerts.js']) {
      const src = fs.readFileSync(path.join(HERE, file), 'utf8').replace(/\/\/[^\n]*/g, '')
      expect(src).not.toMatch(/setInterval|setTimeout|refreshInterval/)
    }
  })
})

describe('list alert switch: accessibility', () => {
  it('off, on with a write result, and a failed write pass axe (WCAG A and AA)', async () => {
    serve()
    renderSwitch('highs52')
    await screen.findByTestId('terminal-list-alert')
    await expectNoAxeViolations(document.body.firstElementChild)
    await press()
    await outcome('on')
    await expectNoAxeViolations(document.body.firstElementChild)
    serve({ PUT: 500 })
    await press()
    await outcome('failed')
    await expectNoAxeViolations(document.body.firstElementChild)
  }, 60_000)

  it('a failed read passes axe', async () => {
    serve({ GET: 500 })
    renderSwitch()
    await screen.findByTestId('terminal-list-alert-error')
    await expectNoAxeViolations(document.body.firstElementChild)
  }, 60_000)
})
