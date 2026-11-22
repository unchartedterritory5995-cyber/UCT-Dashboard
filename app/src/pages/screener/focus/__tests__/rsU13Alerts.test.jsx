// RS screens, unit U13: "Tell me what joins and leaves". The saved-screens payload carries
// `rs_alerts: { available, subscribed: [starter ids] }` only while the daily joined-and-left
// message is on for this member. On a screen whose starter has `row`, an available payload draws
// ONE small text switch at the end of the header line. Pressing it changes the screen at once
// (optimistic), asks the server (POST to turn on, DELETE to turn off), and puts the switch back,
// with one short sentence, if the server refuses or cannot be reached.
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { vi, beforeEach, describe, expect, test } from 'vitest'
vi.mock('../../../../components/StockChart', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../ScreenerChartWidget', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../../shell/ScannerShell', () => ({ default: () => <div data-testid="table-mode" /> }))
vi.mock('../../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../../../hooks/useNeighborWarm', () => ({ useNeighborWarm: () => {} }))
vi.mock('../../../../utils/prefetchBars', () => ({ prefetchBars: () => {}, prefetchBarsToIDB: () => {}, warmMemFromIDB: () => {}, prewarmVisibleList: () => {} }))
import { __resetCountCache } from '../useLazyCounts'
import { __resetRevisionStateForTests } from '../../../../hooks/usePreferences'
import { rsAlertsOf, withRsAlert, rsAlertHint, RS_ALERT_LABEL, RS_ALERT_FAILED } from '../rsAlerts'
import { RS_NOTE_PREF } from '../rsScreens'
import { decodeSpec } from '../../shell/specUrl'
import { net, resetNet, installFetch, mount, pin } from './rsHarness'
import { LEADERS, PLAIN_STARTERS } from './rsScreensFixture'

const L = 'starter_rs_leaders'
const T = 'starter_rs_top_rating'
const ON = { available: true, subscribed: [L] }
const OFF = { available: true, subscribed: [] }

beforeEach(() => {
  __resetCountCache()
  __resetRevisionStateForTests()
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
  resetNet()
  net.prefs = { [RS_NOTE_PREF]: '1' }
  installFetch()
})
const landedOn = name => waitFor(() => expect(screen.getByRole('button', { name: new RegExp(`^${name}.*Change screen`) })).toBeInTheDocument())
const rowsIn = () => waitFor(() => screen.getByTestId('focus-row-NVDA'))
const toggle = () => screen.queryByRole('switch', { name: RS_ALERT_LABEL })
const shown = async () => { await waitFor(() => expect(toggle()).toBeInTheDocument()); return toggle() }
const openScreen = async name => {
  fireEvent.click(screen.getByRole('button', { name: /Change screen/ }))
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^Open ${name}`) }))
}
const alertCalls = () => fetch.mock.calls.filter(([u]) => String(u).startsWith('/api/screener/rs-alerts')).map(([u, o]) => [o?.method, String(u)])
const savedReads = () => fetch.mock.calls.filter(([u]) => String(u).startsWith('/api/screener/saved-screens')).length
// An answer the test lets go of when it chooses: what is on screen meanwhile is the optimistic state.
const held = () => { let release; const p = new Promise(r => { release = r }); return { p, release } }

describe('what the payload says', () => {
  test('available: the screens the message is on for', () => {
    expect(rsAlertsOf(ON).subscribed.has(L)).toBe(true)
    expect([...rsAlertsOf(OFF).subscribed]).toEqual([])
    // ids that are not text are dropped, not trusted
    expect([...rsAlertsOf({ available: true, subscribed: [L, 7, null, ''] }).subscribed]).toEqual([L])
    expect([...rsAlertsOf({ available: true }).subscribed]).toEqual([])
  })
  test.each([
    ['a payload without the key (the flag is off)', undefined],
    ['null', null],
    ['not available', { available: false, subscribed: [L] }],
    ['available that is not exactly true', { available: 'yes', subscribed: [L] }],
    ['available: 1', { available: 1, subscribed: [L] }],
    ['a bare string', 'on'],
    ['a list', [ON]],
  ])('%s draws nothing', (_n, a) => { expect(rsAlertsOf(a)).toBeNull() })

  test('turning one screen on or off makes a new payload and touches nothing else', () => {
    const data = Object.freeze({ saved: [1], starters: [2], rs_alerts: Object.freeze({ available: true, subscribed: Object.freeze([T]) }) })
    const on = withRsAlert(data, L, true)
    expect(on).toEqual({ saved: [1], starters: [2], rs_alerts: { available: true, subscribed: [T, L] } })
    expect(withRsAlert(on, L, true).rs_alerts.subscribed).toEqual([T, L])        // on twice is on once
    expect(withRsAlert(on, T, false).rs_alerts.subscribed).toEqual([L])
    expect(withRsAlert(data, L, false)).toEqual(data)                            // off when already off
    // a payload with no such key has nothing to turn
    const plain = { saved: [], starters: [] }
    expect(withRsAlert(plain, L, true)).toBe(plain)
    expect(withRsAlert(undefined, L, true)).toBeUndefined()
  })

  test('the words are plain and are not advice', () => {
    expect(RS_ALERT_LABEL).toBe('Tell me what joins and leaves')
    expect(rsAlertHint('UCT RS Leaders')).toBe('One message a day for UCT RS Leaders, at its standard settings: what joined and what left.')
    for (const s of [RS_ALERT_LABEL, RS_ALERT_FAILED, rsAlertHint('UCT RS Leaders'), rsAlertHint()]) {
      expect(s).not.toMatch(/\b(buy|buys|buyable|sell|sells|lens|gate|red day|ADR|RSI)\b/i)
      expect(s).not.toMatch(/[–—]/)
    }
  })
})

describe('on the page', () => {
  test('an RS screen shows one switch in the header line, off, labelled and described', async () => {
    net.alerts = OFF
    pin([L])
    mount()
    await landedOn('UCT RS Leaders')
    const sw = await shown()
    expect(screen.getAllByRole('switch', { name: RS_ALERT_LABEL })).toHaveLength(1)
    expect(sw).toHaveAttribute('aria-checked', 'false')
    expect(sw.tagName).toBe('BUTTON')
    expect(sw).toHaveAttribute('type', 'button')
    expect(sw).not.toHaveAttribute('tabindex', '-1')
    // what it does, for a screen reader and for a pointer: this screen, at its standard settings.
    // The description is a real element the switch points at (a title alone is not read on touch).
    expect(sw).toHaveAccessibleDescription(rsAlertHint(LEADERS.name))
    expect(document.getElementById(sw.getAttribute('aria-describedby'))).toHaveTextContent(rsAlertHint(LEADERS.name))
    expect(sw).toHaveAttribute('title', rsAlertHint(LEADERS.name))
    // the shared switch (components/ui/Switch, 2026-11-20): its visible label is a real <label> for it, and the state
    // word beside it is not read twice
    const box = screen.getByTestId('rs-alert')
    const label = box.querySelector(`label[for="${sw.id}"]`)
    expect(label).toHaveTextContent(RS_ALERT_LABEL)
    // named by aria-labelledby, not by the <label> alone: HTML-AAM names a <button> from aria-labelledby, its content
    // or its title, so a reader that does not follow label-for on a button would read the title instead
    expect(sw).toHaveAttribute('aria-labelledby', label.id)
    expect(box.querySelector('[aria-hidden="true"]')).toHaveTextContent('Off')
    // in the list's header line, above the list
    expect(screen.getByTestId('rs-head')).toContainElement(sw)
    const list = await screen.findByRole('listbox')
    expect(sw.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // read from the payload the page already fetches: nothing is asked for it
    expect(alertCalls()).toEqual([])
    expect(savedReads()).toBe(1)
  })

  test('a screen the message is on for shows the switch on', async () => {
    net.alerts = ON
    pin([L])
    mount()
    await landedOn('UCT RS Leaders')
    const sw = await shown()
    expect(sw).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('rs-alert').querySelector('[aria-hidden="true"]')).toHaveTextContent('On')
  })

  test.each([
    ['a payload without the key (the flag is off)', undefined],
    ['not available', { available: false, subscribed: [] }],
    ['a malformed payload', 'yes'],
  ])('%s draws no switch', async (_n, alerts) => {
    net.alerts = alerts
    pin([L])
    mount()
    await landedOn('UCT RS Leaders')
    await rowsIn()
    expect(toggle()).toBeNull()
    expect(screen.queryByTestId('rs-alert')).toBeNull()
  })

  test('a screen without `row` never shows it; each RS screen shows its own state', async () => {
    net.alerts = ON
    pin([PLAIN_STARTERS[0].id])
    mount()
    await landedOn(PLAIN_STARTERS[0].name)
    await rowsIn()
    expect(toggle()).toBeNull()
    await openScreen('Top RS Rating')
    await landedOn('Top RS Rating')
    expect(await shown()).toHaveAttribute('aria-checked', 'false')
    expect(toggle()).toHaveAccessibleDescription(rsAlertHint('Top RS Rating'))
    await openScreen('UCT RS Leaders')
    await landedOn('UCT RS Leaders')
    await waitFor(() => expect(toggle()).toHaveAttribute('aria-checked', 'true'))
  })
})

describe('pressing it', () => {
  test('off to on: the switch moves at once, then the server is asked with POST, and it stays on', async () => {
    net.alerts = OFF
    const answer = held()
    net.alertSet = () => answer.p
    pin([L])
    mount()
    await landedOn('UCT RS Leaders')
    const sw = await shown()
    fireEvent.click(sw)
    // optimistic: on before the server has answered
    await waitFor(() => expect(toggle()).toHaveAttribute('aria-checked', 'true'))
    expect(alertCalls()).toEqual([['POST', `/api/screener/rs-alerts/${L}`]])
    expect(toggle()).toHaveAttribute('aria-busy', 'true')
    // a second press while the first is in flight asks nothing more
    fireEvent.click(toggle())
    expect(alertCalls()).toHaveLength(1)
    await act(async () => { answer.release() })
    await waitFor(() => expect(toggle()).not.toHaveAttribute('aria-busy'))
    expect(toggle()).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByRole('alert')).toBeNull()
    // the payload is not read again: the request's own answer is the new state
    expect(savedReads()).toBe(1)
  })

  test('a click on its visible label presses it too (the words were inside the old button)', async () => {
    net.alerts = OFF
    pin([L])
    mount()
    await landedOn('UCT RS Leaders')
    const sw = await shown()
    fireEvent.click(screen.getByTestId('rs-alert').querySelector(`label[for="${sw.id}"]`))
    await waitFor(() => expect(alertCalls()).toEqual([['POST', `/api/screener/rs-alerts/${L}`]]))
    await waitFor(() => expect(toggle()).not.toHaveAttribute('aria-busy'))
    expect(toggle()).toHaveAttribute('aria-checked', 'true')
  })

  test('on to off asks with DELETE', async () => {
    net.alerts = ON
    pin([L])
    mount()
    await landedOn('UCT RS Leaders')
    fireEvent.click(await shown())
    await waitFor(() => expect(toggle()).toHaveAttribute('aria-checked', 'false'))
    await waitFor(() => expect(alertCalls()).toEqual([['DELETE', `/api/screener/rs-alerts/${L}`]]))
    await waitFor(() => expect(toggle()).not.toHaveAttribute('aria-busy'))
    expect(toggle()).toHaveAttribute('aria-checked', 'false')
    // and on again
    fireEvent.click(toggle())
    await waitFor(() => expect(alertCalls()).toEqual([['DELETE', `/api/screener/rs-alerts/${L}`], ['POST', `/api/screener/rs-alerts/${L}`]]))
    await waitFor(() => expect(toggle()).toHaveAttribute('aria-checked', 'true'))
  })

  test('a refusal puts the switch back and says so; the next press can succeed', async () => {
    net.alerts = OFF
    const answer = held()
    net.alertSet = () => answer.p
    pin([L])
    mount()
    await landedOn('UCT RS Leaders')
    fireEvent.click(await shown())
    await waitFor(() => expect(toggle()).toHaveAttribute('aria-checked', 'true'))
    await act(async () => { answer.release({ status: 404 }) })
    await waitFor(() => expect(toggle()).toHaveAttribute('aria-checked', 'false'))
    expect(screen.getByRole('alert')).toHaveTextContent(RS_ALERT_FAILED)
    expect(toggle()).not.toHaveAttribute('aria-busy')
    // try again: the sentence goes, the switch turns on
    net.alertSet = null
    fireEvent.click(toggle())
    await waitFor(() => expect(toggle()).toHaveAttribute('aria-checked', 'true'))
    await waitFor(() => expect(toggle()).not.toHaveAttribute('aria-busy'))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(toggle()).toHaveAttribute('aria-checked', 'true')
  })

  test('a server that cannot be reached rolls back too', async () => {
    net.alerts = ON
    net.alertSet = () => { throw new Error('offline') }
    pin([L])
    mount()
    await landedOn('UCT RS Leaders')
    fireEvent.click(await shown())
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(RS_ALERT_FAILED))
    expect(toggle()).toHaveAttribute('aria-checked', 'true')
  })

  test('a refusal about one screen is not shown under another', async () => {
    net.alerts = OFF
    net.alertSet = () => ({ status: 500 })
    pin([L])
    mount()
    await landedOn('UCT RS Leaders')
    fireEvent.click(await shown())
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    await openScreen('Top RS Rating')
    await landedOn('Top RS Rating')
    await shown()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('touch and the link', () => {
  test('the switch is a 44 px target on the whole touch tier', () => {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const css = readFileSync(path.join(here, '..', 'RsScreens.module.css'), 'utf8')
    const touch = css.slice(css.indexOf('@media (max-width: 1024px)'))
    expect(touch).toMatch(/\.alertToggle[^{]*\{\s*min-height:\s*var\(--tap-min\)/)
  })

  // The message's link (api/services/screener/rs_screen_alerts.py `screen_link`) is the page's own
  // `?s=` form. This is the string the server builds for UCT RS Leaders
  // (tests/test_rs_screens_u13_alerts.py holds the same one): the page reads it back as that
  // screen's spec, which is what names it as the starter.
  test('the link the server puts in a message opens the screen at its standard settings', () => {
    const link = 'eyJmIjp7InByaWNlIjp7Im9wIjoiZ3RlIiwibWluIjoxMH0sImRvbGxhcl92b2xfMzBkIjp7Im9wIjoiZ3RlIiwibWluIjoyMDAwMDAwMH0sImFkcl9wY3QiOnsib3AiOiJndGUiLCJtaW4iOjN9LCJtYXJrZXRfY2FwIjp7Im9wIjoiZ3RlIiwibWluIjozMDAwMDAwMDB9LCJyc19yYW5rIjp7Im9wIjoiZ3RlIiwibWluIjo4MH0sInBjdF92c19zbWEyMDAiOnsib3AiOiJndCIsIm1pbiI6MH0sInNtYTIwMF9yaXNpbmciOnsib3AiOiJlcSIsInZhbHVlIjoxfSwiZGlzdF81MndfaGlnaF9wY3QiOnsib3AiOiJndGUiLCJtaW4iOi0yNX0sInJzX2xpbmVfYWJvdmVfbWEiOnsib3AiOiJlcSIsInZhbHVlIjoxfSwicnNfZmxhZyI6eyJvcCI6Im5vdF9pbiIsInZhbHVlcyI6WyJidXlvdXRfcGVuZGluZyJdfSwicnNfbGVhZGVyc19tZW1iZXIiOnsib3AiOiJlcSIsInZhbHVlIjoxfSwic2VjdXJpdHlfdHlwZSI6eyJvcCI6Im5vdF9pbiIsInZhbHVlcyI6WyJFVEYiXX19LCJzb3J0Ijp7ImtleSI6InJzX3JhdGluZ19zY29yZSIsImRpciI6ImRlc2MifSwidmlldyI6InJzX2xlYWRlcnMifQ'
    const got = decodeSpec(link)
    expect(Object.entries(got.filters).map(([key, rest]) => ({ key, ...rest }))).toEqual(LEADERS.spec.filters)
    // unit U12: the list is kept by the server, so the screen is a plain sort and carries no rank
    expect(LEADERS.spec.rank).toBeUndefined()
    expect(got.rank).toBeNull()
    expect(got.sort).toEqual(LEADERS.spec.sort)
    expect(got.filters.rs_leaders_member).toEqual({ op: 'eq', value: 1 })
    expect(got.view).toBe(LEADERS.spec.view)
    expect(got.logic).toBeNull()
  })
})
