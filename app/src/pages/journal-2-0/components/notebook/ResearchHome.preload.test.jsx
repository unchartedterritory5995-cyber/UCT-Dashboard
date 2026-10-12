// @vitest-environment jsdom
// N4 (polish round): the Notices box and the Active setups box render nothing until their chunk
// lands (`fallback={null}`), so on a cold chunk they popped in under the member's notes and pushed
// Home down. Home's first paint is its loading skeleton, which renders neither box, so both chunks
// are requested when the browser is idle after that paint, through the same loader the boxes' own
// lazyChunk uses (one shared module). What this holds:
//   * nothing is requested before the idle callback runs (the skeleton renders neither box);
//   * the idle callback requests the Notices box, and the setups box only while its flag is on;
//   * it is scheduled through requestIdleCallback, and called off on unmount.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'

const { loads } = vi.hoisted(() => ({ loads: { notices: 0, setups: 0 } }))
// Each factory runs when its module is FIRST imported: the counters are "how many chunk fetches".
vi.mock('./NoticesBox', () => { loads.notices += 1; return { default: () => null } })
vi.mock('./SetupsBox', () => { loads.setups += 1; return { default: () => null } })
let hookResult
vi.mock('../../hooks/useNotebookHome', () => ({ default: () => hookResult }))
vi.mock('./AskPanel', () => ({ default: () => null }))

import ResearchHome from './ResearchHome'
import { AuthContext } from '../../../../context/AuthContext'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'

const tree = () => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <AuthContext.Provider value={{ isPaid: true, user: { id: 'u1' } }}>
      <MemoryRouter>
        <ResearchHome hasAnyNotes onOpenNote={vi.fn()} onCreateNote={vi.fn()} onCreateThesis={vi.fn()} onImport={vi.fn()} />
      </MemoryRouter>
    </AuthContext.Provider>
  </SWRConfig>
)

let idle
beforeEach(() => {
  __resetNotebookFlags()
  // Home's first paint: the loading skeleton (neither box is rendered).
  hookResult = { home: null, isLoading: true, error: null, refresh: vi.fn() }
  globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
  idle = { callbacks: [], cancelled: [] }
  window.requestIdleCallback = vi.fn((cb, opts) => { idle.callbacks.push({ cb, opts }); return idle.callbacks.length })
  window.cancelIdleCallback = vi.fn((h) => { idle.cancelled.push(h) })
})
afterEach(() => {
  __resetNotebookFlags()
  delete window.requestIdleCallback
  delete window.cancelIdleCallback
})

const runIdle = () => act(async () => {
  for (const { cb } of idle.callbacks.splice(0)) cb({ didTimeout: false, timeRemaining: () => 50 })
  await new Promise((r) => setTimeout(r, 0))
})

// Order matters, and is the point: module registry state carries across the cases in this file.
describe('Research Home preloads its two boxes when the browser is idle', () => {
  it('setups board OFF: nothing before the idle callback, then the Notices chunk only', async () => {
    render(tree())
    expect(window.requestIdleCallback).toHaveBeenCalledTimes(1)
    expect(idle.callbacks[0].opts).toEqual({ timeout: expect.any(Number) })
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    // The skeleton renders neither box, so without the preload nothing would be fetched yet.
    expect(loads).toEqual({ notices: 0, setups: 0 })
    await runIdle()
    // a dynamic import reaches the module a few ticks later under vitest
    await act(async () => { await vi.waitFor(() => expect(loads.notices).toBe(1)) })
    expect(loads).toEqual({ notices: 1, setups: 0 })
  })

  it('setups board ON: the idle callback asks for the setups chunk too', async () => {
    latchNotebookFlags({ notebook_setups_board_enabled: true })
    render(tree())
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(loads.setups).toBe(0)
    await runIdle()
    // The same module the box's own lazyChunk imports: now in the module map, fetched once.
    await act(async () => { await vi.waitFor(() => expect(loads.setups).toBe(1)) })
    expect(loads).toEqual({ notices: 1, setups: 1 })
  })

  it('the preload is called off when Home unmounts before the browser is idle', () => {
    const { unmount } = render(tree())
    const handle = window.requestIdleCallback.mock.results[0].value
    unmount()
    expect(window.cancelIdleCallback).toHaveBeenCalledWith(handle)
  })
})
