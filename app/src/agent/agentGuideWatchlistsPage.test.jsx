// ⭐ RAILS (cov-4 item 8; docs/agent/program/TEACH-WATCHLISTS-PAGE-DESIGN.md): a watchlist control that lives only on the
// Watchlists page is taught there, behind the member's permission. Owner decision 2026-11-09 + AUDIT limits: never navigate
// without a yes, never write the workspace (navigation and the board's writers are spied), cancel works across the page
// change, the board is untouched on return. The Watchlists page itself is a TEST DOUBLE (its Agent host and anchors are the
// unapplied patch docs/agent/program/TEACH-WATCHLISTS-PAGE.patch, waiting for the owner). Real AgentPanel, scripted model.
// LOCAL / SIMULATED.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, act } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, ONE } from './testing/panelHarness'
import AgentPanel from './AgentPanel'
import { AuthContext } from '../context/AuthContext'
import { _resetGuide, guideState, guideEnded } from './guide/guideStore'
import { peekPageWalk, _resetPageWalk, takePageWalk, goToPageWalk, _setPageReady, pageReady } from './guide/pageWalk'
import { pageWalkOffer } from './capabilities/guide'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
let restore = []
const BOX = { top: 40, left: 40, right: 160, bottom: 70, width: 120, height: 30, x: 40, y: 40 }
beforeEach(() => {
  p = setupPanel()
  _resetGuide(); _resetPageWalk()
  // the rails run against a test double of the page: as if the patch had landed
  _setPageReady('watchlists', true)
  const rects = Element.prototype.getClientRects
  const box = Element.prototype.getBoundingClientRect
  Element.prototype.getClientRects = function () { return this.isConnected ? [BOX] : [] }
  Element.prototype.getBoundingClientRect = function () { return this.isConnected ? { ...BOX, toJSON: () => BOX } : { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 } }
  Element.prototype.scrollIntoView = function () {}
  restore = [() => { Element.prototype.getClientRects = rects; Element.prototype.getBoundingClientRect = box }]
})
afterEach(() => { _setPageReady('watchlists', false); restore.forEach(f => f()); cleanup(); document.querySelectorAll('[data-fixture]').forEach(n => n.remove()); _resetGuide(); _resetPageWalk() })

const ASK = 'how do I export my watchlist as a CSV'
const question = () => screen.queryByText(/This is on the Watchlists page\. Go there now\?/)
// the Charts board, with navigation and every workspace writer the panel reaches spied
function charts() {
  const m = p.mount(...ONE())
  const navigate = vi.fn()
  m.h.navigate = navigate
  const persist = vi.spyOn(m.h, 'persist')
  const before = JSON.stringify(m.board.state)
  return { ...m, navigate, persist, unchanged: () => JSON.stringify(m.board.state) === before }
}
// the Watchlists page as the patch would render it: the page anchor, a list's name, and its own right-click menu
function watchlistsPage() {
  const root = document.createElement('div')
  root.setAttribute('data-fixture', '')
  root.innerHTML = '<div data-guide="watchlists.page"><span data-guide="watchlist.listName">Momentum</span></div>'
  document.body.appendChild(root)
  return root
}
const pageHost = () => ({ surface: 'watchlists', charts: { list: () => [], selected: () => null } })
const landOn = (host) => render(<AuthContext.Provider value={{ user: { id: 1, role: 'admin' } }}><AgentPanel host={host} surface="watchlists" onClose={() => {}} /></AuthContext.Provider>)
async function askAndSayYes() {
  const c = charts()
  await c.say(ASK)
  await waitFor(() => expect(question()).toBeTruthy())
  await c.click('Yes, go there')
  return c
}

describe('until the Watchlists page shows the Agent (the unapplied patch), nothing is offered', () => {
  it('not ready: no ask, no navigation, the old answer stands', () => {
    _setPageReady('watchlists', false)
    expect(pageReady('watchlists')).toBe(false)
    expect(pageWalkOffer(ASK, { navigate: vi.fn() })).toBeNull()
  })
})

describe('teaching on the Watchlists page: asks first, teaching only', () => {
  it('the ask is shown and nothing is rung; navigate is never called before the member answers', async () => {
    const c = charts()
    await c.say(ASK)
    await waitFor(() => expect(question()).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Yes, go there' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'No, stay here' })).toBeTruthy()
    expect(c.navigate).not.toHaveBeenCalled()
    expect(guideState()).toBeNull()
    expect(peekPageWalk()).toBeNull()
    expect(c.persist).not.toHaveBeenCalled()
    expect(c.unchanged()).toBe(true)
  }, 30000)
  it('No: no navigation, no walkthrough, no workspace write; the member is told they stay put', async () => {
    const c = charts()
    await c.say(ASK)
    await waitFor(() => expect(question()).toBeTruthy())
    await c.click('No, stay here')
    await waitFor(() => expect(screen.getByText(/OK, staying here\. Nothing changed\./)).toBeTruthy())
    expect(c.navigate).not.toHaveBeenCalled()
    expect(peekPageWalk()).toBeNull()
    expect(guideState()).toBeNull()
    expect(c.persist).not.toHaveBeenCalled()
    expect(c.unchanged()).toBe(true)
  }, 30000)
  it('Yes: navigate("/watchlists") exactly once, the walkthrough waits for the page, and still no workspace write', async () => {
    const c = await askAndSayYes()
    expect(c.navigate).toHaveBeenCalledTimes(1)
    expect(c.navigate).toHaveBeenCalledWith('/watchlists')
    expect(peekPageWalk()).toMatchObject({ surface: 'watchlists', feature: 'watchlistPage' })
    expect(c.persist).not.toHaveBeenCalled()
    expect(c.unchanged()).toBe(true)
  }, 30000)
  it('the panel that lands on the Watchlists page starts it ONCE; a second panel there does not start it again', async () => {
    await askAndSayYes()
    cleanup()
    watchlistsPage()
    landOn(pageHost())
    await waitFor(() => expect(guideState()?.feature?.id).toBe('watchlistPage'), { timeout: 3000 })
    expect(guideState().steps[0].text).toMatch(/Right-click the name of one of your lists/)
    expect(peekPageWalk()).toBeNull()
    // a remount (a reload, the page re-rendering) finds nothing waiting
    cleanup(); _resetGuide()
    watchlistsPage()
    landOn(pageHost())
    await new Promise(r => setTimeout(r, 700))
    expect(guideState()).toBeNull()
  }, 30000)
  it('cancel after navigating ends it cleanly (Escape on the page), and nothing on Charts was written', async () => {
    const c = await askAndSayYes()
    expect(c.unchanged()).toBe(true)
    cleanup()
    watchlistsPage()
    landOn(pageHost())
    await waitFor(() => expect(guideState()?.feature?.id).toBe('watchlistPage'), { timeout: 3000 })
    document.activeElement?.blur?.()
    act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
    await waitFor(() => expect(guideState()).toBeNull())
    expect(guideEnded()?.featureId).toBe('watchlistPage')
    expect(c.persist).not.toHaveBeenCalled()
  }, 30000)
  it('back on Charts the board is byte-identical to the one before the ask', async () => {
    const c = await askAndSayYes()
    expect(c.unchanged()).toBe(true)
    expect(c.board.state.boardWrites || 0).toBe(0)
    expect(c.board.state.addCalls || []).toEqual([])
  }, 30000)
  it('Charts first: a control Charts can show is never sent to the page; nothing is offered where the host cannot change page', () => {
    const host = { navigate: () => {} }
    expect(pageWalkOffer('how do I sort my watchlist', host)).toBeNull()               // the Charts widget sorts
    expect(pageWalkOffer('how do I add a column to my watchlist', host)).toBeNull()    // the Charts widget's columns
    expect(pageWalkOffer('how do I delete a watchlist', host)).toBeNull()              // the picker's bin on Charts
    expect(pageWalkOffer(ASK, {})).toBeNull()                                          // no navigate: no offer
    expect(pageWalkOffer(ASK, host, 'watchlists')).toBeNull()                          // already there
    expect(pageWalkOffer(ASK, host)?.walk).toMatchObject({ surface: 'watchlists', feature: 'watchlistPage' })
  })
  it('a walkthrough left waiting too long (the member wandered off) never starts later', () => {
    const host = { navigate: vi.fn() }
    const offer = pageWalkOffer(ASK, host)
    expect(offer).toBeTruthy()
    goToPageWalk(offer.walk, host)
    expect(takePageWalk('watchlists', Date.now() + 61000)).toBeNull()
  })
})
