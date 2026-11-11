// "Show me how to create a watchlist" — the walkthrough through the REAL panel (AgentPanel + useAgent + registry) and the
// REAL widget: WatchlistWidget + WatchlistPicker render the controls the guide points at, and the member's own clicks
// create the list against a stand-in /api/watchlists. Stand-ins: the workspace's Widgets menu (its ids are railed in
// agentGuideTargets.test.js) and the scoped list view, pages/Watchlists.jsx (mocked below; same rail). No model call.
//
// jsdom lays nothing out, so every element is given its OWN box: a ring can only match the control it is really on.
import { useState, useCallback } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { registerBuiltins } from './builtins'
import { setupPanel, ONE } from './testing/panelHarness'
import { _resetGuide, guideState } from './guide/guideStore'
import { LOST_MS } from './guide/placement'
import { matchFeature } from './guide/registry'
import WatchlistWidget from '../pages/charts/widgets/WatchlistWidget'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
vi.mock('../hooks/useFlagged', () => ({ useFlagged: () => ({ flagged: [], flaggedName: 'Flagged' }) }))
// pages/Watchlists.jsx in pick mode: the same two controls, the same attributes (agentGuideTargets.test.js reads the source)
vi.mock('../pages/Watchlists', () => ({
  default: ({ pickList, pickName, onExitPick }) => (
    <div data-testid="scoped-list">
      <button data-guide="watchlist.lists" onClick={() => onExitPick()}>‹ Lists</button>
      <span>{pickName}</span>
      {pickList.startsWith('user:') && <button data-guide="watchlist.addSymbol" aria-label="Add a symbol">+</button>}
    </div>
  ),
}))
registerBuiltins()

// ── a box per element ──
const boxes = new WeakMap()
let n = 0
const boxOf = (el) => {
  if (!boxes.has(el)) { n += 1; boxes.set(el, { top: 20 + (n % 300) * 2, left: 30, right: 150, bottom: 20 + (n % 300) * 2 + 18, width: 120, height: 18, x: 30, y: 20 + (n % 300) * 2 }) }
  return boxes.get(el)
}
const ring = () => screen.queryByTestId('guide-ring')
const ringIsOn = (el) => {
  const r = ring()
  return !!r && !!el && r.style.top === `${boxOf(el).top - 4}px`
}
const card = () => screen.queryByTestId('guide-card')
const cardText = () => screen.queryByTestId('guide-text')?.textContent || ''
const notice = () => screen.queryByTestId('guide-notice')
const onIt = (text, el) => waitFor(() => { expect(cardText()).toMatch(text); expect(ringIsOn(typeof el === 'function' ? el() : el)).toBe(true) }, { timeout: 3000 })

// ── the board: the Widgets menu as ChartsWorkspace renders it, and real Watchlist widgets ──
let closeMenu = null
function Cell({ id, opts: initial, onGone }) {
  const [opts, setOpts] = useState(initial)
  return (
    <div data-widget-id={id} data-widget-type="watchlist">
      <button data-testid={`remove-${id}`} onClick={onGone}>remove</button>
      <WatchlistWidget widgetId={id} color="N" opts={opts} onOptsChange={setOpts} />
    </div>
  )
}
function Board({ lists = [] }) {
  const [menu, setMenu] = useState(false)
  const [cells, setCells] = useState(lists.map((l, i) => ({ id: `w${i}`, opts: l })))
  closeMenu = useCallback(() => setMenu(false), [])
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <button data-guide="workspace.widgets" onClick={() => setMenu(m => !m)}>Widgets ▾</button>
      {menu && (
        <div data-guide="workspace.widgetsMenu">
          <button data-guide="workspace.widgets.watchlist" onClick={() => { setCells(c => [...c, { id: `new${c.length}`, opts: {} }]); setMenu(false) }}>Watchlist</button>
        </div>
      )}
      {cells.map(c => <Cell key={c.id} id={c.id} opts={c.opts} onGone={() => setCells(all => all.filter(x => x.id !== c.id))} />)}
    </SWRConfig>
  )
}

const widgetsBtn = () => document.querySelector('[data-guide="workspace.widgets"]')
const chip = () => document.querySelector('[data-guide="workspace.widgets.watchlist"]')
const newBtn = () => screen.queryByRole('button', { name: 'New watchlist' })
const nameBox = () => screen.queryByLabelText('New watchlist name')
const createBtn = () => document.querySelector('[data-guide="watchlist.createList"]')
const typeName = (name) => fireEvent.change(nameBox(), { target: { value: name } })

let p
let posts
let failCreate
let restore = []
beforeEach(() => {
  p = setupPanel()
  _resetGuide()
  posts = []
  failCreate = false
  const base = globalThis.fetch
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const path = String(url).split('?')[0]
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    if (path === '/api/watchlists' && init.method === 'POST') {
      const body = JSON.parse(init.body)
      posts.push(body)
      return failCreate ? json({}, 500) : json({ id: 'l1', name: body.name, items: [] })
    }
    if (path.startsWith('/api/watchlists')) return json([])
    return base(url, init)
  })
  const rects = Element.prototype.getClientRects
  const box = Element.prototype.getBoundingClientRect
  Element.prototype.getClientRects = function () { return this.isConnected ? [boxOf(this)] : [] }
  Element.prototype.getBoundingClientRect = function () { return this.isConnected ? { ...boxOf(this), toJSON: () => boxOf(this) } : { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 } }
  Element.prototype.scrollIntoView = function () {}
  restore = [() => { Element.prototype.getClientRects = rects; Element.prototype.getBoundingClientRect = box }]
})
afterEach(() => { restore.forEach(f => f()); vi.restoreAllMocks(); cleanup(); _resetGuide() })

const start = async ({ lists = [], ask = 'show me how to create a watchlist' } = {}) => {
  render(<Board lists={lists} />)
  const m = p.mount(...ONE())
  const out = await m.say(ask)
  return { ...m, out }
}
/** The member's own clicks, up to the step named. */
const toPicker = async () => { fireEvent.click(widgetsBtn()); await onIt(/Click Watchlist to add one/, chip); fireEvent.click(chip()); await onIt(/Click ＋ New/, newBtn) }
const toName = async () => { await toPicker(); fireEvent.click(newBtn()); await onIt(/Type a name/, nameBox) }
const toCreate = async () => { await toName(); typeName('Momentum'); fireEvent.click(screen.getByRole('button', { name: 'Next' })); await onIt(/Click Create/, createBtn) }

describe('WL · the words reach the walkthrough, with no model turn and no list created', () => {
  it.each([
    'Show me how to create a watchlist',
    'show me how to make a watchlist',
    'how do I create a watchlist?',
    'how can i make a new watchlist',
    'how do I add a new watchlist',
    'walk me through creating a watchlist',
    'teach me how to make my own watchlist',
    'guide me through building a watch list',
    'how do I start a new list',
    'where do I create a watchlist',
  ])('%s', async (ask) => {
    const { out } = await start({ ask })
    expect(out).toMatch(/I’ve highlighted it/)
    expect(guideState().feature.id).toBe('watchlistCreate')
    expect(p.turns()).toBe(0)
    expect(posts).toEqual([])
  }, 30000)

  it.each([
    ['how do i use watchlists', 'watchlists'],
    ['how do I add a watchlist to my board', 'watchlists'],
    ['where is my watchlist', 'watchlists'],
    ['how do I link a chart to a watchlist', 'link'],
  ])('its words take nothing from another walkthrough: %s → %s', (q, id) => { expect(matchFeature(q)?.id).toBe(id) })

  it('a command to create one is not a walkthrough', () => {
    expect(matchFeature('create a watchlist called Momentum')?.id).toBe('watchlistCreate')    // the words name the feature…
    // …but only a show-me sentence reaches guide.show (the SHOW gate, capabilities/guide.js); this stays the planner's
  })
})

describe('WL · the whole path, every step on the real control', () => {
  it('from a board with no Watchlist widget: Widgets ▾ → Watchlist → ＋ New → name → Create → the list; only the member creates it', async () => {
    const { say } = await start()
    await onIt(/Open Widgets ▾/, widgetsBtn)
    expect(card().textContent).toMatch(/1 of 6/)
    expect(screen.getByRole('button', { name: 'Skip' })).toBeTruthy()
    await toPicker()
    expect(document.querySelector('[data-guide="watchlist.picker"]')).toBeTruthy()
    expect(guideState().widgetRef).toBe('new0')
    fireEvent.click(newBtn())
    await onIt(/Type a name/, nameBox)
    typeName('Momentum')
    expect(cardText()).toMatch(/Type a name/)                              // typing is not the end of the step
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await onIt(/Click Create/, createBtn)
    expect(posts).toEqual([])                                              // the guide has created nothing
    fireEvent.click(createBtn())
    await onIt(/The list is open in this widget and saved in My Lists/, () => document.querySelector('[data-guide="watchlist.addSymbol"]'))
    expect(posts).toEqual([{ name: 'Momentum' }])                          // one list, from the member's click
    expect(screen.getByTestId('scoped-list').textContent).toMatch(/Momentum/)
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()      // a created list isn't stepped back over
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(card()).toBeNull()
    expect(ring()).toBeNull()
    expect(notice()).toBeNull()
    expect(guideState()).toBeNull()
    expect(p.turns()).toBe(0)
    await say('now do it for me').catch(() => {})                          // the guide has no writer: it asks for the name
    expect(posts).toHaveLength(1)
  }, 30000)

  it('pressing Enter in the name box creates it too: the walkthrough follows, it does not report a lost control', async () => {
    await start()
    await toName()
    typeName('Swing')
    fireEvent.submit(nameBox().closest('form'))
    await onIt(/The list is open in this widget/, () => document.querySelector('[data-guide="watchlist.addSymbol"]'))
    expect(posts).toEqual([{ name: 'Swing' }])
    expect(notice()).toBeNull()
  }, 30000)

  it('a failed create is not called a success: the form says so and the card stays on Create', async () => {
    await start()
    await toCreate()
    failCreate = true
    fireEvent.click(createBtn())
    await screen.findByText('Could not create that list.')
    await new Promise(r => setTimeout(r, 400))
    expect(cardText()).toMatch(/Click Create/)
    expect(screen.queryByTestId('scoped-list')).toBeNull()
  }, 30000)

  it('a picker already on the board: it starts at ＋ New and says so; "do it for me" asks for the name and creates nothing', async () => {
    const { out, say } = await start({ lists: [{}] })
    expect(out).toMatch(/You’re already part of the way there/)
    await onIt(/Click ＋ New/, newBtn)
    const reply = await say('now do it for me')
    expect(reply).toMatch(/Tell me what to call it/)
    expect(posts).toEqual([])
    expect(p.turns()).toBe(0)
  }, 30000)

  it('a Watchlist widget already showing a list: ‹ Lists opens the picker and the walkthrough carries on from ＋ New', async () => {
    await start({ lists: [{ watchKey: 'user:9', watchName: 'Old' }] })
    await onIt(/Click ‹ Lists on this widget/, () => document.querySelector('[data-guide="watchlist.lists"]'))
    expect(card().textContent).toMatch(/1 of 7/)
    fireEvent.click(document.querySelector('[data-guide="watchlist.lists"]'))
    await onIt(/Click ＋ New/, newBtn)
  }, 30000)

  it('…or Next takes the Widgets route instead', async () => {
    await start({ lists: [{ watchKey: 'user:9', watchName: 'Old' }] })
    await onIt(/Click ‹ Lists on this widget/, () => document.querySelector('[data-guide="watchlist.lists"]'))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await onIt(/Open Widgets ▾/, widgetsBtn)
  }, 30000)

  it('🔴 another widget already showing a list is not mistaken for the new one: only the pinned widget ends the steps', async () => {
    await start({ lists: [{ watchKey: 'user:9', watchName: 'Old' }] })
    await onIt(/Click ‹ Lists/, () => document.querySelector('[data-guide="watchlist.lists"]'))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await toName()
    expect(document.querySelector('[data-guide="watchlist.addSymbol"]')).toBeTruthy()   // Old's own, on w0
    await new Promise(r => setTimeout(r, 400))
    expect(cardText()).toMatch(/Type a name/)
    typeName('Fresh')
    fireEvent.submit(nameBox().closest('form'))
    await onIt(/The list is open in this widget/, () => document.querySelector('[data-widget-id="new1"] [data-guide="watchlist.addSymbol"]'))
  }, 30000)
})

describe('WL · Back and Next', () => {
  it('Next and Back move between steps; 🔴 Back onto a step whose waitFor is already met stays there', async () => {
    await start()
    await toName()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    await onIt(/Click ＋ New/, newBtn)                                      // the form is still open: it must not bounce forward
    await new Promise(r => setTimeout(r, 400))
    expect(cardText()).toMatch(/Click ＋ New/)
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    await onIt(/Type a name/, nameBox)
  }, 30000)

  it('after Back, the step still moves by itself once its waitFor goes away and comes back', async () => {
    await start()
    await toName()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    await onIt(/Click ＋ New/, newBtn)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))         // the form closes (the picker's own Cancel)
    await new Promise(r => setTimeout(r, 300))
    fireEvent.click(newBtn())
    await onIt(/Type a name/, nameBox)
  }, 30000)

  it('🔴 Back passes over a step whose control has gone (the closed menu) to the nearest one on screen', async () => {
    await start()
    await toPicker()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    await onIt(/Open Widgets ▾/, widgetsBtn)
    expect(notice()).toBeNull()
  }, 30000)

  it('🔴 the Widgets menu closing on mouse-leave returns to "Open Widgets ▾" and reopening it carries on', async () => {
    await start()
    fireEvent.click(widgetsBtn())
    await onIt(/Click Watchlist/, chip)
    act(() => { closeMenu() })
    await onIt(/Open Widgets ▾/, widgetsBtn)
    expect(notice()).toBeNull()
    fireEvent.click(widgetsBtn())
    await onIt(/Click Watchlist/, chip)
  }, 30000)

  it('🔴 Cancel on the form returns to ＋ New rather than reporting a lost control', async () => {
    await start()
    await toCreate()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await onIt(/Click ＋ New/, newBtn)
    expect(notice()).toBeNull()
    expect(posts).toEqual([])
  }, 30000)
})

describe('WL · Exit and Escape, at any step', () => {
  const STEPS = [
    ['Open Widgets', async () => {}],
    ['Click Watchlist', async () => { fireEvent.click(widgetsBtn()); await onIt(/Click Watchlist/, chip) }],
    ['＋ New', toPicker],
    ['the name', toName],
    ['Create', toCreate],
    ['the finished list', async () => { await toCreate(); fireEvent.click(createBtn()); await onIt(/The list is open/, () => document.querySelector('[data-guide="watchlist.addSymbol"]')) }],
  ]
  it.each(STEPS)('Exit on %s', async (_, go) => {
    await start()
    await go()
    fireEvent.click(screen.getByRole('button', { name: 'Exit the guide' }))
    expect(card()).toBeNull()
    expect(ring()).toBeNull()
    expect(notice()).toBeNull()
    expect(guideState()).toBeNull()                                         // no tutorial state left behind
  }, 30000)
  it.each(STEPS)('🔴 Escape on %s, with focus anywhere', async (_, go) => {
    await start()
    await go()
    expect(card().contains(document.activeElement)).toBe(false)             // the card never has focus
    document.activeElement?.blur?.()                                        // in a text field the key is the field's
    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => expect(card()).toBeNull())
    expect(ring()).toBeNull()
    expect(notice()).toBeNull()
    expect(guideState()).toBeNull()
  }, 30000)
  it('a finished or cancelled walkthrough leaves nothing bound: the next one starts and Escape ends it', async () => {
    const { say } = await start()
    await onIt(/Open Widgets ▾/, widgetsBtn)
    document.activeElement?.blur?.()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => expect(card()).toBeNull())
    await say('show me how to create a watchlist')
    await onIt(/Open Widgets ▾/, widgetsBtn)
    document.activeElement?.blur?.()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => expect(card()).toBeNull())
    expect(document.querySelector('[data-testid="guide-ring"]')).toBeNull()
  }, 30000)
  it('🔴 Escape in the name box is the field\'s: the form closes and the walkthrough steps back to ＋ New', async () => {
    await start()
    await toName()
    fireEvent.keyDown(nameBox(), { key: 'Escape' })
    await waitFor(() => expect(nameBox()).toBeNull())
    await waitFor(() => expect(card().textContent).toMatch(/Click ＋ New/), { timeout: LOST_MS + 3000 })
    expect(notice()).toBeNull()
    expect(guideState()).toBeTruthy()
  }, 30000)
  it('Escape does nothing of the guide\'s once no walkthrough is on screen', async () => {
    await start()
    fireEvent.click(screen.getByRole('button', { name: 'Exit the guide' }))
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(card()).toBeNull()
  }, 30000)
})

describe('WL · a control that disappears', () => {
  it('the widget is closed while ＋ New is highlighted → it returns to Widgets ▾ rather than stopping', async () => {
    await start()
    await toPicker()
    fireEvent.click(screen.getByTestId('remove-new0'))
    await onIt(/Open Widgets ▾/, widgetsBtn)
    expect(notice()).toBeNull()
  }, 30000)
  it('the widget is closed on the name step: no earlier control left to return to but Widgets ▾, so it returns there', async () => {
    await start()
    await toName()
    fireEvent.click(screen.getByTestId('remove-new0'))
    await onIt(/Open Widgets ▾/, widgetsBtn)
    expect(posts).toEqual([])
  }, 30000)
  it('the Widgets menu is not on screen at all (grid mode) → it says so and explains, and starts nothing', async () => {
    const m = p.mount(...ONE())
    const out = await m.say('show me how to create a watchlist')
    expect(out).toMatch(/I can’t see the Widgets menu on your screen right now/)
    expect(out).toMatch(/click ＋ New, name the list and click Create/)
    expect(card()).toBeNull()
  }, 30000)
})
