// What each /r/* panel page shows when the server refuses its read, and when it answers.
//
// One check, on the server: a page forwards the `?token=` from its address and takes the answer.
//   - 403 or 401          -> the page's "unauthorized" line, no panel, the ready flag never set
//   - any other failure   -> "data unavailable", no panel, the ready flag never set
//   - 200                 -> the panel, and the ready flag once the page has settled
// The three pages that draw only what their address carries have no data read, so they ask the
// server once before they draw (their cases are further down). /r/calendar reads public data and
// makes no token check.
import { act, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BookRender from '../BookRender'
import BreadthRender from '../BreadthRender'
import CalendarRender from '../CalendarRender'
import CatalystsRender from '../CatalystsRender'
import EarnCardsRender from '../EarnCardsRender'
import EarnResultsRender from '../EarnResultsRender'
import EconRender from '../EconRender'
import FlowRender from '../FlowRender'
import MoversRender from '../MoversRender'
import ThemesRender from '../ThemesRender'
import TweetsRender from '../TweetsRender'

const TOKEN = 'token-from-the-address'
const SETTLE_MS = 6000 // longer than any page's settle timer

const answer = (status, body = {}) => Promise.resolve({
  ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body),
})

function stubFetch(reply) {
  const fetchMock = vi.fn((url) => reply(String(url)))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const mount = (Page, url) => render(<MemoryRouter initialEntries={[url]}><Page /></MemoryRouter>)

const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(SETTLE_MS) })

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  delete window.__panelReady
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// [route, page, the door it reads, a 200 body the page can draw]
const TOKEN_CHECKED = [
  ['/r/book', BookRender, '/api/r/book', { rows: [] }],
  ['/r/breadth', BreadthRender, '/api/r/breadth-monitor', { rows: [] }],
  ['/r/catalysts', CatalystsRender, '/api/r/catalysts', { rows: [] }],
  ['/r/econ', EconRender, '/api/r/econ', {}],
  ['/r/flow', FlowRender, '/api/r/flow', { orders: [] }],
  ['/r/themes', ThemesRender, '/api/r/themes', {}],
  ['/r/tweets', TweetsRender, '/api/r/tweets', { tweets: [] }],
]

describe.each(TOKEN_CHECKED)('%s takes the server\'s answer', (route, Page, door, okBody) => {
  it.each([403, 401])('a %i answer shows "unauthorized", no panel, and the ready flag stays false', async (status) => {
    const fetchMock = stubFetch(() => answer(status))
    const { container, findByText } = mount(Page, `${route}?token=${TOKEN}`)

    expect(await findByText('unauthorized')).toBeInTheDocument()
    expect(container.querySelector('#panel-export')).toBeNull()
    await settle()
    expect(window.__panelReady).toBe(false)
    expect(container.textContent).toBe('unauthorized')

    // The page asked the server, with the address's token, and decided nothing before the answer.
    const asked = fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith(door))
    expect(asked).toHaveLength(1)
    expect(asked[0]).toContain(`token=${TOKEN}`)
  })

  it('any other failed read shows "data unavailable", not "unauthorized"', async () => {
    stubFetch(() => answer(500))
    const { container, findByText } = mount(Page, `${route}?token=${TOKEN}`)

    expect(await findByText('data unavailable')).toBeInTheDocument()
    expect(container.querySelector('#panel-export')).toBeNull()
    await settle()
    expect(window.__panelReady).toBe(false)
  })

  it('a read that never answers (network error) shows "data unavailable"', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    const { findByText } = mount(Page, `${route}?token=${TOKEN}`)
    expect(await findByText('data unavailable')).toBeInTheDocument()
  })

  it('a 200 answer draws the panel and then sets the ready flag', async () => {
    stubFetch(() => answer(200, okBody))
    const { container } = mount(Page, `${route}?token=${TOKEN}`)

    await waitFor(() => expect(container.querySelector('#panel-export')).not.toBeNull())
    expect(container.textContent).not.toContain('unauthorized')
    await settle()
    expect(window.__panelReady).toBe(true)
  })

  it('the page draws on the server\'s word alone: any token the server accepts is drawn', async () => {
    stubFetch(() => answer(200, okBody))
    const { container } = mount(Page, `${route}?token=some-other-value`)
    await waitFor(() => expect(container.querySelector('#panel-export')).not.toBeNull())
  })
})

const b64url = (obj) => btoa(unescape(encodeURIComponent(JSON.stringify(obj))))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

// ---- the three pages that draw only what their address carries ----
//
// They have no data read to take the server's answer from, so each asks the server once, with the
// address's token, before it draws (`useServerTokenCheck` in lib/renderToken.js).

const CHECK_ROUTE = '/api/r/chart-settings'
const MARK = 'ZQXA' // a ticker only the payload carries
const EARN_CARD = {
  sym: MARK, name: 'Payload Marker Co', session: 'AMC', label: 'Wed Oct 1',
  last_q: { eps: 1.18, rev_m: 9301 }, eps_est: 2.85, rev_est: 11200,
  proj_eps_yoy: 141, proj_rev_yoy: 20, exp_move_pct: 9.1,
}
const EARN_RESULT = {
  sym: MARK, name: 'Payload Marker Co', session: 'AMC', is_beat: true,
  eps_act: 0.49, eps_est: 0.27, eps_surp: 81, rev_act: 11720, rev_est: 11000, rev_surp: 6.5,
  eps_yoy: -30, rev_yoy: 2,
}
const MOVERS = [{
  key: 'big_up', title: 'Top Big-Cap Positive', marker: '+',
  items: [{ sym: MARK, pct: '+3.1%', news: 'payload line', has_why: true }],
}]

// [route with its data, page]
const ADDRESS_ONLY = [
  [`/r/earncards?data=${b64url({ rows: [EARN_CARD] })}`, EarnCardsRender],
  [`/r/earnresults?data=${b64url({ rows: [EARN_RESULT] })}`, EarnResultsRender],
  [`/r/movers?data=${b64url({ buckets: MOVERS })}`, MoversRender],
]

const checks = (fetchMock) => fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith(CHECK_ROUTE))
const pass = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

describe.each(ADDRESS_ONLY)('%s asks the server before it draws', (url, Page) => {
  it.each([403, 401])('a %i answer shows "unauthorized", draws nothing of the payload, and the ready flag is never set', async (status) => {
    const fetchMock = stubFetch(() => answer(status))
    const { container, findByText } = mount(Page, `${url}&token=${TOKEN}`)

    expect(await findByText('unauthorized')).toBeInTheDocument()
    expect(container.querySelector('#panel-export')).toBeNull()
    expect(container.textContent).toBe('unauthorized')
    await settle()
    expect(window.__panelReady).toBe(false)
    expect(container.textContent).toBe('unauthorized')

    // One question, to the token-checked route, with the address's token.
    expect(checks(fetchMock)).toEqual([`${CHECK_ROUTE}?token=${TOKEN}`])
  })

  it('an address with no token is refused by the server, not by the page', async () => {
    const fetchMock = stubFetch(() => answer(403))
    const { container, findByText } = mount(Page, url)

    expect(await findByText('unauthorized')).toBeInTheDocument()
    expect(container.textContent).not.toContain(MARK)
    expect(checks(fetchMock)).toEqual([`${CHECK_ROUTE}?token=`])
  })

  it.each([200, 429, 500])('a %i answer draws the payload and then sets the ready flag', async (status) => {
    const fetchMock = stubFetch(() => answer(status))
    const { container } = mount(Page, `${url}&token=${TOKEN}`)

    await waitFor(() => expect(container.querySelector('#panel-export')).not.toBeNull())
    expect(container.textContent).toContain(MARK)
    expect(container.textContent).not.toContain('unauthorized')
    await settle()
    expect(window.__panelReady).toBe(true)
    expect(checks(fetchMock)).toHaveLength(1)
  })

  it('a check that fails to reach the server draws the payload and sets the ready flag', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    const { container } = mount(Page, `${url}&token=${TOKEN}`)

    await waitFor(() => expect(container.querySelector('#panel-export')).not.toBeNull())
    expect(container.textContent).toContain(MARK)
    await settle()
    expect(window.__panelReady).toBe(true)
  })

  it('while the server has not answered it draws nothing and does not start the ready timer; after four seconds it draws', async () => {
    stubFetch(() => new Promise(() => {}))
    const { container } = mount(Page, `${url}&token=${TOKEN}`)

    // Past the page's settle time, short of the four seconds.
    await pass(3000)
    expect(container.innerHTML).toBe('')
    expect(window.__panelReady).toBe(false)

    await pass(1500)
    expect(container.querySelector('#panel-export')).not.toBeNull()
    expect(container.textContent).toContain(MARK)
    expect(window.__panelReady).toBe(false) // the settle time starts once the page draws
    await settle()
    expect(window.__panelReady).toBe(true)
  })
})

describe('/r/calendar reads public data and makes no token check', () => {
  it.each(['', '&token=anything'])('draws the panel and sets the ready flag (address suffix "%s")', async (suffix) => {
    const fetchMock = stubFetch(() => answer(200, { days: {} }))
    const { container } = mount(CalendarRender, `/r/calendar?w=728${suffix}`)

    await waitFor(() => expect(container.querySelector('#panel-export')).not.toBeNull())
    expect(container.textContent).not.toContain('unauthorized')
    await settle()
    expect(window.__panelReady).toBe(true)

    // No read from this page goes to a token-checked door.
    const doors = fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('/api/r/'))
    expect(doors).toEqual([])
  })
})
