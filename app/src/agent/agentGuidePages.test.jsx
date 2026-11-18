// W2-C2 — EXPLAIN / SHOW ME / DO IT FOR ME on /screener, /breadth, /calendar and /journal, through the real panel on
// each page's host (pageHosts.js). Show me highlights the page's OWN controls (their `data-guide` targets,
// agentGuideTargets.test.js rails that each is rendered) and changes nothing; do it for me runs the page's EXISTING
// capability (the Screen menu's door) — or, where the page has no writer for it, says so. /charts is unchanged.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))

import AgentPanel from './AgentPanel'
import { registerBuiltins } from './builtins'
import { buildScreenerPageHost, buildBreadthPageHost, buildCalendarPageHost, buildJournalPageHost } from './hosts/pageHosts'
import { _resetGuide } from './guide/guideStore'
import { GUIDE_FEATURES, guideFeatures, matchFeature, featuresOn } from './guide/registry'
import { explainTopic } from './guide/explain'
import { getCapability } from './capabilities'

registerBuiltins()

const SAVED = [{ id: 's1', name: 'Breakout', spec: { filters: [] } }, { id: 's2', name: 'Pullback', spec: { filters: [] } }]
const STARTERS = [{ id: 'st1', name: 'Momentum Leaders', spec: { filters: [] } }]

function screenerPage() {
  const page = { current: { id: 's1', name: 'Breakout', kind: 'saved' }, rows: [{ ticker: 'AAA' }], total: 1, edited: false, applied: [] }
  const host = buildScreenerPageHost({
    read: () => ({ rows: page.rows, total: page.total, current: page.current, filters: ['price'], edited: page.edited }),
    saved: () => ({ saved: SAVED, starters: STARTERS }),
    applyScreen: (spec, item) => { page.applied.push(item.id); page.current = { id: item.id, name: item.name, kind: item.kind } },
    location: () => '/screener',
    navigate: () => {},
  })
  return { page, host }
}
const breadthPage = () => buildBreadthPageHost({ read: () => ({ tab: 'breadth', days: 20, topDate: '2026-11-02', rowCount: 20, columns: ['A20'] }), location: () => '/breadth', navigate: () => {} })
const calendarPage = () => buildCalendarPageHost({ read: () => ({ data: { week_start: '2026-11-02', days: {} }, view: 'week' }), location: () => '/calendar', navigate: () => {} })
function journalPage() {
  const page = { notes: [], created: [] }
  const host = buildJournalPageHost({
    notes: () => page.notes, location: () => '/journal/notebook', navigate: () => {},
    create: async ({ title, ticker }) => { const n = { id: `n${page.created.length + 1}`, title, ticker: ticker || null, updatedAt: '2026-11-03T01:00:00Z' }; page.created.push(n); page.notes = [n, ...page.notes]; return n },
    request: async () => new Response('{}', { status: 200 }),
  })
  return { page, host }
}

/** A page's controls as the product renders them (only the ids; agentGuideTargets.test.js rails the real markup). */
function controls(ids) {
  const root = document.createElement('div')
  root.setAttribute('data-fixture', '')
  root.innerHTML = ids.map(id => `<button data-guide="${id}">${id}</button>`).join('')
  document.body.appendChild(root)
  return root
}

let turnBodies
let restore = []
const BOX = { top: 40, left: 40, right: 160, bottom: 70, width: 120, height: 30, x: 40, y: 40 }
beforeEach(() => {
  turnBodies = []
  _resetGuide()
  try { localStorage.clear() } catch { /* */ }
  const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
  globalThis.fetch = vi.fn(async (url, init) => {
    if (url === '/api/agent/turn') { turnBodies.push(init?.body ? JSON.parse(init.body) : null); return json({ conversationId: 'ac_1', turnId: 1, envelope: { disposition: 'answer', reply: 'A model answer.', question: null, ops: [], unsupported_category: null }, usage: { citations: [] } }) }
    if (url === '/api/agent/record') return json({ conversationId: 'ac_1' })
    if (String(url).startsWith('/api/agent/conversations')) return json({ conversations: [] })
    if (String(url).startsWith('/api/screener/saved-screens')) return json({ saved: SAVED, starters: STARTERS })
    return json({})
  })
  // every element in the document has a box (jsdom lays nothing out)
  const rects = Element.prototype.getClientRects
  const box = Element.prototype.getBoundingClientRect
  Element.prototype.getClientRects = function () { return this.isConnected ? [BOX] : [] }
  Element.prototype.getBoundingClientRect = function () { return this.isConnected ? { ...BOX, toJSON: () => BOX } : { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 } }
  Element.prototype.scrollIntoView = function () {}
  restore = [() => { Element.prototype.getClientRects = rects; Element.prototype.getBoundingClientRect = box }]
})
afterEach(() => { restore.forEach(f => f()); cleanup(); vi.restoreAllMocks(); document.querySelectorAll('[data-fixture]').forEach(n => n.remove()); _resetGuide() })

const type = (text) => {
  const box = screen.getByLabelText('Message UCT Agent')
  fireEvent.change(box, { target: { value: text } })
  fireEvent.keyDown(box, { key: 'Enter' })
}
const mount = (host, surface) => render(<AgentPanel host={host} surface={surface} onClose={() => {}} />)
const card = () => screen.queryByTestId('guide-card')
const cardText = () => screen.queryByTestId('guide-text')?.textContent || ''

describe('"show me how to create a watchlist" away from /charts', () => {
  it.each([
    ['screener', () => screenerPage().host],
    ['breadth', breadthPage],
    ['calendar', calendarPage],
    ['journal', () => journalPage().host],
  ])('on /%s it says where that lives, instantly: no highlight, no model turn, no list', async (surface, host) => {
    mount(host(), surface)
    type('show me how to create a watchlist')
    await screen.findAllByText(/Creating a watchlist is on the Charts page — open Charts and ask me again there./)
    expect(card()).toBeNull()
    expect(turnBodies).toHaveLength(0)
    expect(globalThis.fetch.mock.calls.filter(([u, o]) => String(u).startsWith('/api/watchlists') && o?.method === 'POST')).toEqual([])
  })
  it('only the feature that asks for it: another Charts walkthrough on a page stays with the model', async () => {
    mount(screenerPage().host, 'screener')
    type('where do I change the timeframe?')
    await screen.findAllByText(/A model answer./)
    expect(turnBodies).toHaveLength(1)
  })
})

describe('W2-C2 · /screener', () => {
  it('EXPLAIN "what are saved screens?" — the Screen menu, from the guide, instantly; nothing changes', async () => {
    const { page, host } = screenerPage()
    mount(host, 'screener')
    type('what are saved screens?')
    await screen.findAllByText(/A screen is a saved set of filters/)
    expect(page.applied).toEqual([])
    expect(turnBodies).toHaveLength(0)
    expect(card()).toBeNull()
  })

  it('SHOW "where do I change the filters?" — highlights the page\'s Filters; the page is untouched', async () => {
    const { page, host } = screenerPage()
    controls(['screener.filters', 'screener.screens', 'screener.columns'])
    mount(host, 'screener')
    type('where do I change the filters?')
    await screen.findAllByText(/I’ve highlighted it — follow the card .* Nothing on your page has changed/)
    // the card finds its control on its own first look, which can land just after the transcript line under load: wait for it
    await waitFor(() => expect(cardText()).toMatch(/Your filters live here/))
    expect(page.applied).toEqual([])
    expect(turnBodies).toHaveLength(0)
  })

  it('SHOW columns, when the Columns button is not on screen: never claimed — it says so and explains', async () => {
    const { host } = screenerPage()
    controls(['screener.filters'])
    mount(host, 'screener')
    type('how do I choose the columns?')
    await screen.findAllByText(/I can’t see the Columns button on your screen right now/)
    expect(card()).toBeNull()
  })

  it('DO IT FOR ME after "show me how to open a saved screen" → which screen? (the page\'s own list) → Pullback: opened through the page\'s door, receipted, and Undo puts Breakout back', async () => {
    const { page, host } = screenerPage()
    controls(['screener.screens'])
    mount(host, 'screener')
    type('show me how to open a saved screen')
    await waitFor(() => expect(cardText()).toMatch(/This is the Screen menu/))
    type('now do it for me')
    await screen.findAllByText('Which screen?')
    expect(card()).toBeNull()                                                        // the walkthrough gives way
    for (const n of ['Breakout', 'Pullback', 'Momentum Leaders']) expect(screen.getAllByRole('button', { name: n }).length).toBeGreaterThan(0)
    fireEvent.click(screen.getAllByRole('button', { name: 'Pullback' }).at(-1))
    const receipt = await screen.findByTestId('agent-receipt')
    expect(receipt.textContent).toContain('Opened “Pullback”')
    expect(page.applied).toEqual(['s2'])
    type('undo that')
    await screen.findByText(/Undid: Opened “Pullback”/)
    expect(page.applied).toEqual(['s2', 's1'])
    expect(turnBodies).toHaveLength(0)
  })

  it('DO IT FOR ME on the filters (no writer of the page\'s own): says so — nothing runs', async () => {
    const { page, host } = screenerPage()
    controls(['screener.filters'])
    mount(host, 'screener')
    type('where do I change the filters?')
    await waitFor(() => expect(card()).not.toBeNull())
    type('now do it for me')
    await screen.findAllByText(/I don’t change filters on the page/)
    expect(page.applied).toEqual([])
    expect(screen.queryByTestId('agent-receipt')).toBeNull()
  })
})

describe('W2-C2 · /breadth (read only)', () => {
  it('EXPLAIN "what is the breadth sheet?" — from the guide, instantly', async () => {
    mount(breadthPage(), 'breadth')
    type('what is the breadth sheet?')
    await screen.findAllByText(/one row per session, newest at the top/)
    expect(turnBodies).toHaveLength(0)
  })

  it('SHOW "where are the breadth tabs?" — the tabs, then Customize (Next); DO IT FOR ME says it is read only', async () => {
    controls(['breadth.tabs', 'breadth.customize', 'breadth.table'])
    mount(breadthPage(), 'breadth')
    type('where are the breadth tabs?')
    await waitFor(() => expect(cardText()).toMatch(/These tabs switch between Breadth’s views/))
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(cardText()).toMatch(/Customize chooses which metrics show/))
    type('do it for me')
    await screen.findAllByText(/Breadth is read only for me/)
    expect(screen.queryByTestId('agent-receipt')).toBeNull()
    expect(turnBodies).toHaveLength(0)
  })
})

describe('W2-C2 · /calendar', () => {
  it('EXPLAIN + SHOW "how do I find when a stock reports?" — the Calendar search; DO IT FOR ME asks for the ticker', async () => {
    controls(['calendar.search'])
    mount(calendarPage(), 'calendar')
    type('what is the calendar search?')
    await screen.findAllByText(/Type a ticker or company in the Calendar’s search/)
    type('how do I find when a stock reports?')
    await waitFor(() => expect(cardText()).toMatch(/Type a ticker here/))
    type('do it for me')
    await screen.findAllByText(/Tell me the ticker — for example “when does NVDA report\?”/)
    expect(turnBodies).toHaveLength(0)
  })
})

describe('W2-C2 · /journal', () => {
  it('EXPLAIN + SHOW "where do I add a new note?" — + New note; DO IT FOR ME asks for the words, then the Notebook\'s own creation path makes it', async () => {
    const { page, host } = journalPage()
    controls(['journal.newNote'])
    mount(host, 'journal')
    type('what is a new note?')
    // Final fix (C5): the list's button reads "+ New" (the "+ New note" words and the outline row are gone).
    await screen.findAllByText(/\+ New starts a blank note in your Notebook/)
    type('where do I add a new note?')
    await waitFor(() => expect(cardText()).toMatch(/Click \+ New to start/))
    type('do it for me')
    await screen.findAllByText(/Tell me what it should say/)
    expect(page.created).toEqual([])                                                 // nothing runs on a guess
    type('add a note: check the weekly close')
    await screen.findByTestId('agent-receipt')
    expect(page.created.map(n => n.title)).toEqual(['check the weekly close'])
    expect(turnBodies).toHaveLength(0)
  })
})

describe('W2-C2 · pages never leak into each other, and /charts is unchanged', () => {
  it('a page offers ONLY its own features; /charts offers its families', () => {
    expect(featuresOn('charts').every(f => !f.surface)).toBe(true)
    expect(featuresOn('charts').map(f => f.id)).toEqual(expect.arrayContaining(['watchlistCreate', 'canvas', 'link', 'symbol', 'timeframe', 'indicators', 'charts', 'watchlists', 'layouts', 'hideDrawings', 'drawing', 'settings']))
    expect(guideFeatures({ surface: 'screener' }).map(f => f.id).sort()).toEqual(['screenerColumns', 'screenerFilters', 'screenerScreens'])
    expect(guideFeatures({ surface: 'breadth' }).map(f => f.id).sort()).toEqual(['breadthTable', 'breadthViews'])
    expect(guideFeatures({ surface: 'calendar' }).map(f => f.id)).toEqual(['calendarNextReport'])
    expect(guideFeatures({ surface: 'journal' }).map(f => f.id)).toEqual(['journalNewNote'])
    expect(guideFeatures({ surface: 'charts' }).some(f => f.surface)).toBe(false)
    // every page feature names its page
    for (const f of GUIDE_FEATURES.filter(x => x.surface)) expect(['screener', 'breadth', 'calendar', 'journal']).toContain(f.surface)
  })
  it('/charts words match the same features as before; a page\'s words never match there (nor a chart\'s on a page)', () => {
    expect(matchFeature('where do I change the filters')).toBeNull()
    expect(matchFeature('how do i add a new note')).toBeNull()
    expect(matchFeature('Where do I change the timeframe?')?.id).toBe('timeframe')
    expect(matchFeature('where are the chart settings')?.id).toBe('settings')
    expect(matchFeature('Where do I change the timeframe?', null, 'screener')).toBeNull()
    expect(matchFeature('where do I change the filters', null, 'screener')?.id).toBe('screenerFilters')
    // the guide.show fast path on /charts: identical answers
    const show = getCapability('guide.show')
    expect(show.fast({ raw: 'where do I change the filters', host: { surface: 'charts' } })).toBeNull()
    expect(show.fast({ raw: 'Where do I change the timeframe?', host: { surface: 'charts' } })).toEqual({ feature: 'timeframe', detail: 'Where do I change the timeframe?' })
    expect(show.fast({ raw: 'Where do I change the timeframe?' })).toEqual({ feature: 'timeframe', detail: 'Where do I change the timeframe?' })
  })
  it('explanations: a page\'s features explain only on that page; the Charts ones everywhere', () => {
    expect(explainTopic('saved screens')).toBeNull()                                  // /charts: as before
    expect(explainTopic('saved screens', 'screener')?.text).toMatch(/A screen is a saved set of filters/)
    expect(explainTopic('layout', 'screener')?.text).toMatch(/A layout is a saved board/)
    expect(explainTopic('new note', 'breadth')).toBeNull()
  })
  it('guide.show for a feature of another page points the member there — nothing is highlighted', async () => {
    const show = getCapability('guide.show')
    expect(await show.answer(null, { feature: 'timeframe' }, screenerPage().host, { surface: 'screener' })).toMatch(/is on the Charts page/)
    expect(await show.answer(null, { feature: 'journalNewNote' }, { surface: 'charts', charts: { list: () => [] } }, { surface: 'charts' })).toMatch(/is on the Journal page/)
    expect(card()).toBeNull()
  })
})
