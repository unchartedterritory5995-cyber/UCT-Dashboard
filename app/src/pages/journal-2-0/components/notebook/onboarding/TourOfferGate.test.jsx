// "Newly switched on, offer once" (wave 14, lane W14-C2) through the REAL gate factory,
// the REAL card chunk, the REAL first-run stage store and a Layout-shaped slot, over a
// FAKE registry (this branch's real registry holds only the base tour).
//
// Fake tours borrow two EXISTING dark flag keys as vehicles -- `latchNotebookFlags`
// only latches keys it knows (same fixture decision as RegistryToursGate.test.jsx).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SWRConfig } from 'swr'
import { AuthContext } from '../../../../../context/AuthContext'
import {
  registerFirstRunSlot, claimFirstRunStage, isFirstRunStageHeld, getFirstRunStageHolderCount,
} from '../../../../../components/firstRun/firstRunStage'
import { __resetNotebookFlags, latchNotebookFlags } from '../../../lib/offline/notebookFlags'
import { makeTourOfferGate, OFFER_ATTR } from './TourOfferGate'
import { REGISTRY_TOUR_OPEN_EVENT, __resetRegistryTourControl } from './tourRegistryControl'
import { __resetOfferSession, readOfferSession } from './tourEligibility'
import { OFFER_COPY } from './tourOfferCopy'
import { TOURS_PREF } from './tourSeenState'

const FLAG_A = 'notebook_template_gallery_enabled'
const FLAG_B = 'notebook_ta_fingerprint_enabled'
const TOUR_A = { id: 'c2-tour-a', flag: FLAG_A, title: 'Tour A', replayable: true, load: async () => ({ steps: [], copy: {} }) }
const TOUR_B = { id: 'c2-tour-b', flag: FLAG_B, title: 'Tour B', replayable: true, load: async () => ({ steps: [], copy: {} }) }
const TOURS = [TOUR_A, TOUR_B]

let server
function installFetch() {
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    if (url === '/api/auth/preferences' && method === 'GET') return { ok: true, status: 200, json: async () => ({ ...server.prefs }) }
    if (url === '/api/auth/preferences' && method === 'POST') {
      const { key, value } = JSON.parse(init.body)
      server.prefs = { ...server.prefs, [key]: value }
      return { ok: true, status: 200, json: async () => ({}) }
    }
    const m = /^\/api\/j2\/onboarding\/tours\/(.+)$/.exec(url)
    if (m && method === 'PUT') {
      const { state, step } = JSON.parse(init.body)
      const map = JSON.parse(server.prefs[TOURS_PREF] || '{}')
      map[decodeURIComponent(m[1])] = { v: 1, state, step }
      server.prefs = { ...server.prefs, [TOURS_PREF]: JSON.stringify(map) }
      return { ok: true, status: 200, json: async () => ({ value: server.prefs[TOURS_PREF] }) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  })
}
const writes = () => global.fetch.mock.calls.filter(([, i = {}]) => ['POST', 'PUT'].includes((i.method || '').toUpperCase()))

function Page({ Gate, gate = {}, paid = true, slotChildren = null }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AuthContext.Provider value={{ isPaid: paid }}>
        <main>
          <div data-testid="slot" ref={registerFirstRunSlot}>{slotChildren}</div>
          <button type="button">page control</button>
          <Gate tours={TOURS} hasAnyNotes notesKnown {...gate} />
        </main>
      </AuthContext.Provider>
    </SWRConfig>
  )
}

const Gate = () => makeTourOfferGate(() => import('./TourOfferPrompt'))
const card = (opts) => screen.findByRole('region', { name: OFFER_COPY.title('Tour A') }, { timeout: 2000, ...opts })
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })

beforeEach(() => {
  __resetNotebookFlags()
  __resetRegistryTourControl()
  __resetOfferSession()
  latchNotebookFlags({ notebook_onboarding_enabled: true, [FLAG_A]: true, [FLAG_B]: true })
  server = { prefs: {} }
  installFetch()
})
afterEach(() => {
  __resetNotebookFlags()
  __resetOfferSession()
  registerFirstRunSlot(null)
  vi.restoreAllMocks()
})

describe('the offer', () => {
  it('offers the FIRST eligible tour in the slot, holds the stage, and never takes focus', async () => {
    const G = Gate()
    render(<Page Gate={G} />)
    screen.getByRole('button', { name: 'page control' }).focus()
    const c = await card()
    expect(screen.getByTestId('slot')).toContainElement(c)
    expect(c).toHaveAttribute(OFFER_ATTR)
    expect(c).toHaveTextContent(OFFER_COPY.body)
    expect(screen.getByRole('button', { name: OFFER_COPY.accept })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: OFFER_COPY.later })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()                     // never a modal
    expect(document.activeElement).toHaveTextContent('page control')    // focus untouched
    await waitFor(() => expect(isFirstRunStageHeld()).toBe(true))
    expect(readOfferSession()).toEqual({ id: TOUR_A.id, answered: false })
    expect(writes()).toEqual([])                                        // showing records nothing
  })

  it('"Not now" records the tour dismissed (step null), releases the stage, and -- ⛔ ONE PER SESSION -- offers nothing else', async () => {
    const G = Gate()
    render(<Page Gate={G} />)
    await card()
    fireEvent.click(screen.getByRole('button', { name: OFFER_COPY.later }))
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull())
    await waitFor(() => expect(JSON.parse(server.prefs[TOURS_PREF])[TOUR_A.id]).toEqual({ v: 1, state: 'dismissed', step: null }))
    expect(isFirstRunStageHeld()).toBe(false)
    expect(readOfferSession()).toEqual({ id: TOUR_A.id, answered: true })
    await flush()
    // Tour B is eligible, and stays un-offered for the rest of this session
    expect(screen.queryByRole('region', { name: OFFER_COPY.title('Tour B') })).toBeNull()
  })

  it('a NEW session offers the next tour in order -- an unseen prompt never expires', async () => {
    server.prefs = { [TOURS_PREF]: JSON.stringify({ [TOUR_A.id]: { v: 1, state: 'dismissed', step: null } }) }
    const G = Gate()
    render(<Page Gate={G} />)
    expect(await screen.findByRole('region', { name: OFFER_COPY.title('Tour B') }, { timeout: 2000 })).toBeInTheDocument()
  })

  it('"Take the tour" opens it through the registry door and spends the session', async () => {
    const opened = []
    const onOpen = (e) => opened.push(e.detail.tourId)
    window.addEventListener(REGISTRY_TOUR_OPEN_EVENT, onOpen)
    const G = Gate()
    render(<Page Gate={G} />)
    await card()
    fireEvent.click(screen.getByRole('button', { name: OFFER_COPY.accept }))
    window.removeEventListener(REGISTRY_TOUR_OPEN_EVENT, onOpen)
    expect(opened).toEqual([TOUR_A.id])
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull())
    expect(readOfferSession()).toEqual({ id: TOUR_A.id, answered: true })
    expect(writes().filter(([u]) => String(u).includes('/tours/'))).toEqual([])   // the ENGINE records, not the offer
  })

  it('an unanswered offer is shown again after a remount in the same session (a reload)', async () => {
    const G = Gate()
    const { unmount } = render(<Page Gate={G} />)
    await card()
    unmount()
    registerFirstRunSlot(null)
    render(<Page Gate={G} />)
    expect(await card()).toBeInTheDocument()
  })

  it('Escape inside the card is "Not now"', async () => {
    const G = Gate()
    render(<Page Gate={G} />)
    const c = await card()
    fireEvent.keyDown(screen.getByRole('button', { name: OFFER_COPY.accept }), { key: 'Escape' })
    await waitFor(() => expect(c).not.toBeInTheDocument())
    await waitFor(() => expect(JSON.parse(server.prefs[TOURS_PREF] || '{}')[TOUR_A.id]?.state).toBe('dismissed'))
  })

  it('keyboard: Tab reaches both controls in reading order, Enter activates', async () => {
    const user = userEvent.setup()
    const G = Gate()
    render(<Page Gate={G} />)
    await card()
    await user.tab()
    expect(document.activeElement).toHaveTextContent(OFFER_COPY.accept)
    await user.tab()
    expect(document.activeElement).toHaveTextContent(OFFER_COPY.later)
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull())
  })

  it('D4: no flow here ever writes the checklist key', async () => {
    const G = Gate()
    render(<Page Gate={G} />)
    await card()
    fireEvent.click(screen.getByRole('button', { name: OFFER_COPY.later }))
    await flush()
    const keys = writes().map(([, i]) => (i.body ? JSON.parse(i.body).key : null))
    expect(keys).not.toContain('notebook_getting_started')
  })
})

describe('it never stacks -- it waits', () => {
  it('CONTROL for the waits below: with the same arrangement and nothing blocking, it shows', async () => {
    const G = Gate()
    render(<Page Gate={G} />)
    expect(await card()).toBeInTheDocument()
  })

  it('nothing to offer (flags off): nothing renders and the card chunk is never fetched', async () => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_onboarding_enabled: true })
    const load = vi.fn(() => import('./TourOfferPrompt'))
    const G = makeTourOfferGate(load)
    render(<Page Gate={G} />)
    await flush()
    expect(screen.queryByRole('region')).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })

  it('while the base first-run tour is due for this member, then shows once it is done', async () => {
    const G = Gate()
    const { unmount } = render(<Page Gate={G} gate={{ hasAnyNotes: false }} />)
    await flush()
    expect(screen.queryByRole('region')).toBeNull()
    unmount()
    registerFirstRunSlot(null)
    server.prefs = { notebook_tour: JSON.stringify({ v: 1, state: 'done', step: null }) }
    render(<Page Gate={G} gate={{ hasAnyNotes: false }} />)
    expect(await card()).toBeInTheDocument()
  })

  it('while a note is open (R4)', async () => {
    const G = Gate()
    render(<Page Gate={G} gate={{ noteOpen: true }} />)
    await flush()
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('while the note count is unknown', async () => {
    const G = Gate()
    render(<Page Gate={G} gate={{ notesKnown: false }} />)
    await flush()
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('while the get-started checklist is open (it already lists every armed tour)', async () => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: true, [FLAG_A]: true, [FLAG_B]: true })
    const G = Gate()
    const { unmount } = render(<Page Gate={G} />)
    await flush()
    expect(screen.queryByRole('region')).toBeNull()
    unmount()
    registerFirstRunSlot(null)
    server.prefs = { notebook_getting_started: JSON.stringify({ v: 1, state: 'dismissed' }) }
    render(<Page Gate={G} />)
    expect(await card()).toBeInTheDocument()
  })

  it('while ANOTHER claim holds the stage, and appears when it is released', async () => {
    const release = claimFirstRunStage()
    const G = Gate()
    render(<Page Gate={G} />)
    await flush()
    expect(screen.queryByRole('region')).toBeNull()
    act(() => { release() })
    expect(await card()).toBeInTheDocument()
  })

  it('YIELDS when a tour opens while it shows -- nothing recorded -- and returns after', async () => {
    const G = Gate()
    render(<Page Gate={G} />)
    await card()
    let release
    act(() => { release = claimFirstRunStage() })
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull())
    expect(getFirstRunStageHolderCount()).toBe(1)                        // only the tour's claim
    expect(writes()).toEqual([])
    act(() => { release() })
    expect(await card()).toBeInTheDocument()
  })

  it('while the Compass card sits in the slot, and appears once it leaves', async () => {
    const G = Gate()
    const { rerender } = render(<Page Gate={G} slotChildren={<div role="note">Meet Compass</div>} />)
    await flush()
    expect(screen.queryByRole('region')).toBeNull()
    rerender(<Page Gate={G} slotChildren={null} />)
    expect(await card()).toBeInTheDocument()
    expect(screen.queryByText('Meet Compass')).toBeNull()
  })

  it('without a slot it does not float -- it does not show at all', async () => {
    function NoSlot({ G }) {
      return (
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <AuthContext.Provider value={{ isPaid: true }}>
            <G tours={TOURS} hasAnyNotes notesKnown />
          </AuthContext.Provider>
        </SWRConfig>
      )
    }
    render(<NoSlot G={Gate()} />)
    await flush()
    expect(screen.queryByRole('region')).toBeNull()
  })
})

describe('the card stylesheet stays in flow', () => {
  it('no position: fixed | absolute | sticky (it must never float over a control)', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const css = fs.readFileSync(path.resolve(__dirname, 'TourOfferPrompt.module.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')                               // the header comment names the rule
    expect(css).not.toMatch(/position\s*:\s*(fixed|absolute|sticky)/)
    expect(css).toMatch(/var\(--tap-min\)/)
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/)              // tokens only
  })
})
