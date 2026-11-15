// RS screens, unit U11: UCT Agent opens an RS screen WITH a quick choice, on the real Focus page.
//
// The Agent's `screener.openSaved` goes through the page's own door (applyScreen, the one the Screen menu calls).
// From this unit the door also takes a choice named with the open (`item.choices`, { controlId: optionId }).
// What has to hold, and is held here on the MOUNTED page with only the network mocked:
//
//   the scan the page sends when the Agent opens a screen with a choice is the scan the page sends when a member
//   picks that option themselves.
//
// "The scan the page sends when a member picks it" is not retyped: it is tests/fixtures/rs_screens_scan_requests.json,
// captured from this same page by rsScanRequests.test.jsx (and replayed against the real scan route by the server's
// end-to-end test). So an Agent open, a member's tap and the server's own list are one request.
//
// The Agent reaches the page the way it does in the product: the page hands its host to the provider
// (useScreenerAgentHost), and the capability's own check / apply / commit run against that host.
import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { vi, beforeEach, describe, expect, test } from 'vitest'
vi.mock('../../../../components/StockChart', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../ScreenerChartWidget', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../../shell/ScannerShell', () => ({ default: () => <div data-testid="table-mode" /> }))
vi.mock('../../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../../../hooks/useNeighborWarm', () => ({ useNeighborWarm: () => {} }))
vi.mock('../../../../utils/prefetchBars', () => ({ prefetchBars: () => {}, prefetchBarsToIDB: () => {}, warmMemFromIDB: () => {}, prewarmVisibleList: () => {} }))
import FocusScreener from '../FocusScreener'
import { AuthContext } from '../../../../context/AuthContext'
import { AgentContext } from '../../../../agent/agentApp'
import { registerBuiltins } from '../../../../agent/builtins'
import { getCapability } from '../../../../agent/capabilities'
import { screenerPageKind } from '../../../../agent/capabilities/screenerPage'
import { __resetCountCache } from '../useLazyCounts'
import { __resetRevisionStateForTests } from '../../../../hooks/usePreferences'
import { RS_CONTROLS_PREF, RS_NOTE_PREF } from '../rsScreens'
import { net, resetNet, installFetch, scanBodies, prefPosts, pin } from './rsHarness'
import { RS_STARTERS, PLAIN_STARTERS, NEW_HIGHS, SERVED, readServerFixture } from './rsScreensFixture'

registerBuiltins()

const REQUESTS = readServerFixture('rs_screens_scan_requests.json').requests
// The page's own request for a screen with these choices ({} = as it opens).
const requestFor = (starterId, choices = {}) => {
  const hit = REQUESTS.find(r => r.starter === starterId && JSON.stringify(r.choices) === JSON.stringify(choices))
  if (!hit) throw new Error(`rs_screens_scan_requests.json holds no request for ${starterId} ${JSON.stringify(choices)}`)
  return hit.body
}
const asSet = list => list.map(f => JSON.stringify(Object.fromEntries(Object.entries(f).sort()))).sort()
// A screen the page lands on that is none of the five.
const HOME = PLAIN_STARTERS[0]

beforeEach(() => {
  __resetCountCache()
  __resetRevisionStateForTests()
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
  resetNet()
  net.meta = { filters: SERVED.meta.filters, categories: [{ key: 'relative_strength', label: 'Relative strength' }], views: SERVED.meta.views }
  net.prefs = { [RS_NOTE_PREF]: '1' }
  installFetch()
})

// The Focus page inside an Agent provider that keeps the host the page registers.
function renderWithAgent() {
  let host = null
  const app = { allowed: true, navigate: () => {}, registerPage: ({ host: h }) => { host = h; return () => {} } }
  pin([HOME.id])
  render(
    <MemoryRouter><AuthContext.Provider value={{ user: { id: 'member-a' } }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <AgentContext.Provider value={app}><FocusScreener /></AgentContext.Provider>
      </SWRConfig>
    </AuthContext.Provider></MemoryRouter>)
  return () => host
}
// ... and the page landed on its pinned screen, with its first scan sent.
async function mountWithAgent() {
  const getHost = renderWithAgent()
  await waitFor(() => expect(screen.getByRole('button', { name: new RegExp(`^${HOME.name}.*Change screen`) })).toBeInTheDocument())
  await waitFor(() => expect(scanBodies().length).toBeGreaterThan(0))
  expect(getHost()?.screenerPage?.apply).toBeTypeOf('function')
  return getHost
}

// What the Agent does with one op, through the capability's own functions and the kind's commit.
async function agentOpens(getHost, args) {
  const host = getHost()
  const cap = getCapability('screener.openSaved')
  const target = screenerPageKind.read(host, 'screenerPage')
  const before = screenerPageKind.stateOf(target)
  const refusal = cap.check(before, args, { target })
  if (refusal) return { refusal }
  const after = cap.apply(before, args, { target })
  const patch = screenerPageKind.patch(before, after)
  if (!patch) return { noop: true }
  await act(async () => { await screenerPageKind.commit(host, 'screenerPage', patch) })
  return { patch }
}
const onScreen = name => waitFor(() => expect(screen.getByRole('button', { name: new RegExp(`^${name}.*Change screen`) })).toBeInTheDocument())

describe('the Agent opens an RS screen on the page', () => {
  test('the page tells the Agent it lays a named choice over the screen, and hands on the starters\' own controls', async () => {
    const getHost = await mountWithAgent()
    const target = screenerPageKind.read(getHost(), 'screenerPage')
    expect(target.canOpen).toBe(true)
    expect(target.canChoose).toBe(true)
    const by = Object.fromEntries(target.starters.map(s => [s.id, s]))
    for (const st of RS_STARTERS) expect(by[st.id].controls).toEqual(st.controls)
  })

  test.each(RS_STARTERS.map(st => [st.name, st]))('"%s" by name: the scan is the one the page sends when it opens that screen', async (_name, st) => {
    const getHost = await mountWithAgent()
    const before = scanBodies().length
    expect(await agentOpens(getHost, { screen: st.name, choose: null })).toHaveProperty('patch')
    await onScreen(st.name)
    const want = requestFor(st.id)
    await waitFor(() => expect(asSet(scanBodies().at(-1)?.filters || [])).toEqual(asSet(want.filters)))
    const body = scanBodies().at(-1)
    expect(body.view).toBe(want.view)
    expect(body.rank ?? null).toEqual(want.rank ?? null)
    if (!want.rank) expect(body.sort).toEqual(want.sort)
    expect([...body.columns].sort()).toEqual([...want.columns].sort())
    expect(scanBodies().length).toBe(before + 1)
  })

  const WITH_CHOICE = REQUESTS.filter(r => Object.keys(r.choices).length)
  test.each(WITH_CHOICE.map(r => [`${r.starter} ${JSON.stringify(r.choices)}`, r]))('with a choice, %s: the scan is the one the page sends when a member picks it', async (_id, r) => {
    const st = RS_STARTERS.find(s => s.id === r.starter)
    const [[controlId, optionId]] = Object.entries(r.choices)
    const control = st.controls.find(c => c.id === controlId)
    const option = control.options.find(o => o.id === optionId)
    const getHost = await mountWithAgent()
    const before = scanBodies().length
    // the member's words: the option's own label, as the payload serves it
    const done = await agentOpens(getHost, { screen: st.id, choose: option.label })
    expect(done.patch.open.choices).toEqual(r.choices)
    await onScreen(st.name)
    await waitFor(() => expect(asSet(scanBodies().at(-1)?.filters || [])).toEqual(asSet(r.body.filters)))
    const body = scanBodies().at(-1)
    expect(body.rank ?? null).toEqual(r.body.rank ?? null)
    if (!r.body.rank) expect(body.sort).toEqual(r.body.sort)
    expect(body.view).toBe(r.body.view)
    expect([...body.columns].sort()).toEqual([...r.body.columns].sort())
    // ONE scan: the choice is laid over the starter before anything is asked
    expect(scanBodies().length).toBe(before + 1)
    // and it is not written to the member's remembered choices: a tap on the control is what remembers one
    expect(prefPosts(RS_CONTROLS_PREF)).toEqual([])
  })
})

describe('a named choice and the choices a member has remembered', () => {
  test('the named choice goes over a remembered one on the same control, and beside one on another', async () => {
    net.prefs = { [RS_NOTE_PREF]: '1', [RS_CONTROLS_PREF]: JSON.stringify({ [NEW_HIGHS.id]: { when: 'month', min: 'r90' } }) }
    const getHost = await mountWithAgent()
    await agentOpens(getHost, { screen: NEW_HIGHS.id, choose: 'today' })
    await onScreen(NEW_HIGHS.name)
    const today = requestFor(NEW_HIGHS.id, { when: 'today' }).filters.find(f => f.key === 'rs_nh_bars_ago')
    const r90 = requestFor(NEW_HIGHS.id, { min: 'r90' }).filters.find(f => f.key === 'rs_rank')
    await waitFor(() => {
      const filters = scanBodies().at(-1).filters
      expect(filters.find(f => f.key === 'rs_nh_bars_ago')).toEqual(today)
      expect(filters.find(f => f.key === 'rs_rank')).toEqual(r90)
    })
    // the member's own remembered choices are what they were
    expect(JSON.parse(net.prefs[RS_CONTROLS_PREF])).toEqual({ [NEW_HIGHS.id]: { when: 'month', min: 'r90' } })
    expect(prefPosts(RS_CONTROLS_PREF)).toEqual([])
  })

  test('without a named choice the screen opens as the Screen menu opens it: the remembered choices', async () => {
    net.prefs = { [RS_NOTE_PREF]: '1', [RS_CONTROLS_PREF]: JSON.stringify({ [NEW_HIGHS.id]: { when: 'month' } }) }
    const getHost = await mountWithAgent()
    await agentOpens(getHost, { screen: NEW_HIGHS.id, choose: null })
    await onScreen(NEW_HIGHS.name)
    const month = requestFor(NEW_HIGHS.id, { when: 'month' })
    await waitFor(() => expect(asSet(scanBodies().at(-1).filters)).toEqual(asSet(month.filters)))
  })

  test('asked before the member\'s remembered choices have been read, the named choice is still in the scan', async () => {
    // the starters have answered and the preferences have not (a slow read): the door cannot know what the member
    // remembered, and it still lays the choice it was handed
    net.prefsDelay = 1500
    const getHost = renderWithAgent()
    await waitFor(() => expect(getHost()?.screenerPage.saved().starters.length).toBeGreaterThan(0))
    await act(async () => { getHost().screenerPage.apply({ id: NEW_HIGHS.id, name: NEW_HIGHS.name, kind: 'starter', spec: NEW_HIGHS.spec, choices: { when: 'today' } }) })
    const want = requestFor(NEW_HIGHS.id, { when: 'today' })
    await waitFor(() => expect(asSet(scanBodies().at(-1)?.filters || [])).toEqual(asSet(want.filters)))
    expect(scanBodies().some(b => asSet(b.filters).join() === asSet(requestFor(NEW_HIGHS.id).filters).join())).toBe(false)
  })

  test('a choice the screen does not offer never reaches the scan', async () => {
    const getHost = await mountWithAgent()
    const refused = await agentOpens(getHost, { screen: NEW_HIGHS.id, choose: 'tomorrow' })
    expect(refused.refusal).toContain('has no choice called “tomorrow”')
    // and the door itself drops an option id the starter does not carry (a stale plan)
    const before = scanBodies().length
    await act(async () => { getHost().screenerPage.apply({ id: NEW_HIGHS.id, name: NEW_HIGHS.name, kind: 'starter', spec: NEW_HIGHS.spec, choices: { when: 'tomorrow', nope: 'x' } }) })
    await onScreen(NEW_HIGHS.name)
    await waitFor(() => expect(scanBodies().length).toBe(before + 1))
    expect(asSet(scanBodies().at(-1).filters)).toEqual(asSet(requestFor(NEW_HIGHS.id).filters))
  })
})
