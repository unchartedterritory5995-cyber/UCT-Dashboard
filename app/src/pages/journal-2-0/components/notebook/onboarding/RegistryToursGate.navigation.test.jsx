// Finish program, lane FE, finding I1 (I6 joins this file next): a tour never traps navigation, and a tour that
// cannot start says so and gets out of the way.
//
// The REAL gate and the REAL engine, mounted the way the app shell mounts them (inside the
// pathname-keyed RouteErrorBoundary), over a router with real history entries.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { SWRConfig } from 'swr'
import RouteErrorBoundary from '../../../../../components/RouteErrorBoundary'
import { makeRegistryToursGate } from './RegistryToursGate'
import GenericTourEngine from './GenericTourEngine'
import {
  REGISTRY_TOUR_CLOSED_EVENT, openRegistryTour, hasPendingRegistryTourOpen, __resetRegistryTourControl,
} from './tourRegistryControl'
import { __resetNotebookFlags, latchNotebookFlags } from '../../../lib/offline/notebookFlags'
import { chunkRetry } from '../../../lib/lazyChunk'
import { installTourLayout } from './__fixtures__/tourLayout'

const FLAG = 'notebook_template_gallery_enabled'   // a key FLAG_FALLBACKS knows (see RegistryToursGate.test.jsx)
const CONTENT = {
  steps: [{ id: 's1', anchor: 'trade-anchor', file: 'x' }],
  copy: { s1: { title: 'On the trade', body: 'Body' } },
}
const TRADE_TOUR = {
  id: 'fin-fe-trade-tour', flag: FLAG, title: 'Trade tour', replayable: true,
  start: '/journal-2-0/trade/1', load: async () => CONTENT,
}
const HOME_TOUR = {
  id: 'fin-fe-home-tour', flag: FLAG, title: 'Home tour', replayable: true,
  load: async () => ({ steps: [{ id: 'h1', anchor: 'home-anchor', file: 'x' }], copy: { h1: { title: 'On home', body: 'Body' } } }),
}
const NOWHERE_TOUR = {
  id: 'fin-fe-nowhere-tour', flag: FLAG, title: 'Nowhere tour', replayable: true,
  load: async () => ({ steps: [{ id: 'n1', anchor: 'never-rendered', file: 'x' }], copy: { n1: { title: 'x', body: 'y' } } }),
}
const TOURS = [TRADE_TOUR, HOME_TOUR, NOWHERE_TOUR]

let here = null
let go = null
function Probe() {
  const l = useLocation()
  here = l
  go = useNavigate()
  return null
}

function App({ Gate, entries, index, tours = TOURS }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter initialEntries={entries} initialIndex={index ?? entries.length - 1}>
        <Probe />
        <RouteErrorBoundary>
          <Routes>
            <Route path="/support" element={<h1>Help</h1>} />
            <Route path="/journal/trades" element={<h1>Trades</h1>} />
            <Route path="/journal-2-0/trade/1" element={<div data-tour="trade-anchor">The trade</div>} />
            <Route path="/journal/notebook" element={<div data-tour="home-anchor">Home</div>} />
          </Routes>
          <Gate tours={tours} />
        </RouteErrorBoundary>
      </MemoryRouter>
    </SWRConfig>
  )
}

// The real engine with short waits, so "the anchor never arrives" costs milliseconds.
const fastEngine = () => async () => ({
  default: (props) => <GenericTourEngine {...props} startWaitMs={150} stepWaitMs={100} />,
})

let restoreLayout
let closedEvents
const onClosed = (e) => closedEvents.push(e.detail)
beforeEach(() => {
  __resetNotebookFlags()
  __resetRegistryTourControl()
  latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: true, [FLAG]: true })
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
  restoreLayout = installTourLayout()
  closedEvents = []
  window.addEventListener(REGISTRY_TOUR_CLOSED_EVENT, onClosed)
  here = null
})
afterEach(() => {
  window.removeEventListener(REGISTRY_TOUR_CLOSED_EVENT, onClosed)
  restoreLayout()
  __resetNotebookFlags()
  __resetRegistryTourControl()
  vi.restoreAllMocks()
})
const pause = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const replayEntry = (pathname, id, extra = {}) => ({ pathname, state: { startRegistryTourId: id, ...extra } })

describe('I1 — a tour never traps the Back button', () => {
  it('Help, Replay, the tour navigates to a trade: Back leaves the tour for good', async () => {
    const Gate = makeRegistryToursGate(fastEngine(), 0)
    render(<App Gate={Gate} entries={['/support', replayEntry('/journal/trades', TRADE_TOUR.id)]} />)
    expect(await screen.findByRole('dialog', { name: 'On the trade' })).toBeInTheDocument()
    expect(here.pathname).toBe('/journal-2-0/trade/1')
    act(() => { go(-1) })
    await pause(500)
    // not pushed forward again, and no tour on the page Back landed on
    expect(here.pathname).toBe('/journal/trades')
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => { go(-1) })
    await pause(200)
    expect(here.pathname).toBe('/support')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a tour that opens where it lands does not replay on reload: the request is spent when read', async () => {
    const Gate = makeRegistryToursGate(fastEngine(), 0)
    const first = render(<App Gate={Gate} entries={[replayEntry('/journal/notebook', HOME_TOUR.id, { keep: 'me' })]} />)
    expect(await screen.findByRole('dialog', { name: 'On home' })).toBeInTheDocument()
    // the entry no longer carries the request; anything else it carried is kept
    expect(here.state).toEqual({ keep: 'me' })
    // a reload restores the entry exactly as history holds it
    const restored = { pathname: here.pathname, search: here.search, state: here.state }
    first.unmount()
    __resetRegistryTourControl()
    render(<App Gate={Gate} entries={[restored]} />)
    await pause(300)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('CONTROL — the request does open the tour once (the rail is not passing by never opening)', async () => {
    const Gate = makeRegistryToursGate(fastEngine(), 0)
    render(<App Gate={Gate} entries={[replayEntry('/journal/notebook', HOME_TOUR.id)]} />)
    expect(await screen.findByRole('dialog', { name: 'On home' })).toBeInTheDocument()
    expect(here.state).toBeNull()
  })
})
