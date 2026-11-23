// CHARTS OUTCOME — the News (Trade Exchange) family, C3 (pl-newsfam): RUN over the REAL TradeExchangeNewsWidget mounted in its
// WidgetDoorContext slot beside the REAL Agent panel (outcomeHarness: AgentPanel + useAgent + registry, policy, runtime, receipts,
// Undo). Every assertion reads STATE: the headlines the widget draws, its opts, the fixture watchlist server, and the capture the
// Notebook's own send function was handed (sendCaptureToJournal) — a receipt only beside it.
//
//   C3-139  the category filter and the linked-symbol filter (widget.setOption over the widget's own opts: categories, linked)
//   C3-147  one headline → the Notebook through the row ⋯ menu's own door (newsLibrary.toNotebook → sendHeadlineToNotebook)
//   C3-144  a headline's ticker(s) → one of the member's watchlists (watchlist.add, its referent read by newsLibrary's resolver)
//
// The feed and the day server are the widget's own synthetic fakes (fakeNewsDay); synthetic headlines only.
// ⛔ THE MODEL IS SCRIPTED (outcomeHarness). Evidence: LOCAL native Windows Node, jsdom, BROWSER-MOCK-MODEL / SIMULATED.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, act, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { open, outcomeSuite, afterEachOutcome, chart, must, waitFor, proposalsNow } from './outcomeHarness'
import { WidgetDoorContext, mountedWidgetDoor } from '../../../pages/charts/widgetDoors'
import { WorkspaceContext } from '../../../pages/charts/WorkspaceContext'
import { _resetNewsLibraryForTests } from '../../capabilities/newsLibrary'
import { _resetNotebookSendsForTests } from '../../../lib/tradeExchangeNewsNotebook'

vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
const feed = vi.hoisted(() => {
  const listeners = new Set()
  let state = { status: 'idle', items: [], epoch: 'e', lastSeq: 0, firstSeq: 0, coverage: null, provisional: true }
  return { listeners, get: () => state, set(next) { state = { ...state, ...next }; for (const fn of [...listeners]) fn(state) } }
})
vi.mock('../../../lib/tradeExchangeNewsStreamManager', async () => {
  const { fakeNewsDay, fakeNewsDays } = await import('../../../testing/tradeExchangeNews/fakeNewsDay')
  return {
    subscribe: (fn) => { feed.listeners.add(fn); return () => feed.listeners.delete(fn) },
    getSnapshot: () => feed.get(),
    retry: () => {},
    fetchDay: async (body) => fakeNewsDay(feed.get().items, body, {}),
    fetchDays: async () => fakeNewsDays(feed.get().items, {}),
    claimAnnouncement: () => true,
  }
})
// the Notebook's ONE capture path, read at its own send function
const notebook = vi.hoisted(() => ({ sent: [], answer: 'Sent to your note' }))
vi.mock('../../../pages/journal-2-0/lib/sendToJournal', () => ({
  sendCaptureToJournal: async (kind, capture, opts) => { notebook.sent.push({ kind, capture, opts }); return notebook.answer },
}))
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPref: () => {} }), parsePref: (_v, d) => d }))
vi.mock('../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, staleSymbols: new Set(), isLoading: false, isStreaming: true }) }))
vi.mock('swr', async (orig) => ({ ...(await orig()), default: () => ({ data: undefined, mutate: () => {} }) }))
vi.mock('../../../pages/watchlist/prebuiltDirectory', () => ({
  PICKER_MY_LISTS_URL: '/api/watchlists?include_items=0&include_prebuilt=0',
  PREBUILT_DIRECTORY_URL: '/api/watchlists/prebuilt?include_items=0',
  usePrebuiltMembership: () => ({}),
}))
globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb } observe(el) { this.cb([{ target: el }]) } unobserve() {} disconnect() {} }

const News = (await import('../../../pages/charts/widgets/TradeExchangeNewsWidget')).default
await outcomeSuite()
afterEach(() => { afterEachOutcome(); cleanup(); notebook.sent.length = 0; notebook.answer = 'Sent to your note' })

// a headline longer than the door's 80-character row text: the Notebook must get it WHOLE
const LONG = 'SYNTHETIC: Fed holds rates steady and signals a slower path for cuts as officials weigh sticky services inflation into next year'
const H = (NOW, seq, content, tickers, category = 'News') => ({ type: 'headline', epoch: 'e', seq, id: `id${seq}`, source: 'TX-News', content, tickers, category,
  received_at_ms: NOW - (50 - seq) * 1000, repeat_count: 0, via: 'push', delayed: false })
const items = (NOW) => [
  H(NOW, 1, 'SYNTHETIC: AMD guidance raised', ['AMD'], 'Earnings'),
  H(NOW, 2, 'SYNTHETIC: TSLA deliveries beat', ['TSLA'], 'News'),
  H(NOW, 3, 'SYNTHETIC: NVDA and AMD rally on chip demand', ['NVDA', 'AMD'], 'Price'),
  H(NOW, 4, LONG, [], 'Macro'),
  H(NOW, 5, 'SYNTHETIC: NVDA unusual call volume', ['NVDA'], 'Options'),
]

function Live({ board }) {
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 10); return () => clearInterval(t) }, [])
  const ws = { groupSyms: { N: 'NVDA' }, setGroupSym: () => {}, applyThemeToAllWidgets: () => {}, groupTfs: {}, activeWatchlistRef: { current: null } }
  const w = board.state.widgets.find(x => x.id === 'tn')
  return (
    <MemoryRouter>
      <WorkspaceContext.Provider value={ws}>
        <div data-testid="w-tn"><WidgetDoorContext.Provider value="tn"><News color="N" opts={w.opts} onOptsChange={(o) => { board.state.widgets = board.state.widgets.map(x => (x.id === 'tn' ? { ...x, opts: o } : x)) }} /></WidgetDoorContext.Provider></div>
      </WorkspaceContext.Provider>
    </MemoryRouter>
  )
}
const LISTS = [{ id: 'w1', name: 'Momentum', symbols: ['TSLA'] }, { id: 'w2', name: 'Core', symbols: ['SPY'] }]
function mount(opts = {}) {
  _resetNewsLibraryForTests(); _resetNotebookSendsForTests()
  const m = open([chart('c1', 0, 0, 12, 20), { id: 'tn', type: 'tradeExchangeNews', x: 12, y: 0, w: 12, h: 20, color: 'N', opts }], { 'N:c1': 'NVDA' }, { extra: { watchlists: LISTS } })
  render(<Live board={m.board} />)
  const NOW = Date.now(), ITEMS = items(NOW)
  act(() => feed.set({ status: 'live', items: ITEMS, lastSeq: ITEMS.length, replayUntil: ITEMS.length, lastHeadlineAt: NOW }))
  return m
}
const ALL = [1, 2, 3, 4, 5]
const shown = () => [...document.querySelectorAll('[data-testid="w-tn"] [data-seq]')].map(r => Number(r.dataset.seq)).sort()
const optsOf = (m) => m.board.state.widgets.find(w => w.id === 'tn').opts
const setOpt = (...pairs) => (c) => pairs.map(([key, value]) => ({ action: 'widget.setOption', target: must(c.board?.[0]?.ref, 'board'), args: { widget: 'tn', key, value } }))
const libRef = (c) => must(c.newsLibrary?.[0]?.ref, 'newsLibrary entry')
const syms = (m, name) => m.board.state.server.lists.find(l => l.name === name)?.items.map(i => i.sym) ?? null
/** the member opens a headline's ⋯ menu (the door's `selected`) */
const openMenu = (seq) => {
  const row = document.querySelector(`[data-testid="w-tn"] [data-seq="${seq}"]`)
  fireEvent.click(must(row?.querySelector('[aria-label="More actions for this headline"]'), `the ⋯ of row ${seq}`))
}

// ── C3-139: the category and linked-symbol filters ──
describe('C3-139: the News widget filtered by category and by its linked symbol, through its own opts', () => {
  it.each([
    ['only show earnings headlines in the news widget', [['category', '+Earnings']], ['Earnings'], [1]],
    ['filter the trade exchange news to macro and options', [['category', '+Macro'], ['category', '+Options']], ['Macro', 'Options'], [4, 5]],
    ['show just price headlines on the news feed', [['category', '+Price']], ['Price'], [3]],
  ])('"%s": the widget shows only those categories; Undo shows them all', async (text, pairs, cats, seqs) => {
    const m = mount()
    await waitFor(() => expect(shown()).toEqual(ALL))
    const out = await m.say(text, setOpt(...pairs))
    await waitFor(() => expect(optsOf(m).categories).toEqual(cats))
    await waitFor(() => expect(shown()).toEqual(seqs))
    expect(out).toMatch(/category/i)
    await m.say('undo')
    await waitFor(() => expect(optsOf(m).categories ?? []).toEqual([]))
    await waitFor(() => expect(shown()).toEqual(ALL))
  }, 60000)
  it('"stop filtering out options headlines": a category taken OFF an all-categories filter leaves the other seven', async () => {
    const m = mount()
    await waitFor(() => expect(shown()).toEqual(ALL))
    await m.say('hide options headlines in the news widget', setOpt(['category', '-Options']))
    await waitFor(() => expect(optsOf(m).categories).toEqual(['News', 'Macro', 'Earnings', 'Price', 'Press Release', 'Filing', 'Other']))
    await waitFor(() => expect(shown()).toEqual([1, 2, 3, 4]))
  }, 60000)
  it('a category filter clears the applied preset, as the widget\'s own chip does', async () => {
    const m = mount({ presets: [{ id: 'p1', name: 'Mine', categories: [] }], presetId: 'p1' })
    await waitFor(() => expect(shown()).toEqual(ALL))
    await m.say('only earnings in the news widget', setOpt(['category', '+Earnings']))
    await waitFor(() => expect(optsOf(m).categories).toEqual(['Earnings']))
    expect(optsOf(m).presetId ?? null).toBe(null)
    await m.say('undo')
    await waitFor(() => expect(optsOf(m).presetId).toBe('p1'))
  }, 60000)
  it.each([
    ['link the news widget to my chart', true],
    ['only show news for the linked symbol', 'on'],
  ])('"%s": only headlines naming the linked chart\'s symbol (NVDA) show; Undo shows them all', async (text, value) => {
    const m = mount()
    await waitFor(() => expect(shown()).toEqual(ALL))
    const out = await m.say(text, setOpt(['linked', value]))
    await waitFor(() => expect(optsOf(m).linked).toBe(true))
    await waitFor(() => expect(shown()).toEqual([3, 5]))
    expect(out).toMatch(/linked/i)
    await m.say('undo')
    await waitFor(() => expect(!!optsOf(m).linked).toBe(false))
    await waitFor(() => expect(shown()).toEqual(ALL))
  }, 60000)
  it('NEGATIVE a category the widget does not have: refused with its own choices, nothing filtered', async () => {
    const m = mount()
    await waitFor(() => expect(shown()).toEqual(ALL))
    const out = await m.say('only crypto headlines in the news widget', setOpt(['category', '+Crypto']))
    expect(out).toMatch(/Earnings/)
    expect(optsOf(m).categories ?? []).toEqual([])
    expect(shown()).toEqual(ALL)
  }, 60000)
})

// ── C3-147: a headline to the Notebook ──
describe('C3-147: one headline → the Notebook, through the row ⋯ menu\'s own door', () => {
  it.each([
    ['send the "AMD guidance raised" headline to my notebook', 'id1'],
    ['put the tsla headline in my journal', 'id2'],
  ])('"%s" (instant): a card first; Apply sends exactly that headline, whole, as the ⋯ menu does; no Undo', async (text, want) => {
    const m = mount()
    await waitFor(() => expect(shown()).toEqual(ALL))
    await m.say(text)
    expect(proposalsNow()).toHaveLength(1)
    expect(notebook.sent).toHaveLength(0)
    await m.apply()
    await waitFor(() => expect(notebook.sent).toHaveLength(1))
    expect(notebook.sent[0].kind).toBe('tradeExchangeHeadline')
    expect(notebook.sent[0].capture.eventId).toBe(want)
    expect(notebook.sent[0].capture.content).toBe(items(0).find(h => h.id === want).content)
    expect(m.lastReceipt().textContent).toMatch(/Notebook/)
    expect(m.lastReceipt().getAttribute('data-undoable')).not.toBe('true')
  }, 60000)
  it('"send this headline to my notebook" with its ⋯ menu open: THAT headline, its full text (longer than the door\'s row text)', async () => {
    const m = mount()
    await waitFor(() => expect(shown()).toEqual(ALL))
    act(() => openMenu(4))
    await waitFor(() => expect(mountedWidgetDoor('tn').read().selected).toBe('id4'))
    await m.say('send this headline to my notebook')
    await m.apply()
    await waitFor(() => expect(notebook.sent).toHaveLength(1))
    expect(notebook.sent[0].capture.eventId).toBe('id4')
    expect(notebook.sent[0].capture.content).toBe(LONG)
    expect(LONG.length).toBeGreaterThan(80)
  }, 60000)
  it('the model path: a phrase of the headline names it; the card, then exactly that one', async () => {
    const m = mount()
    await waitFor(() => expect(shown()).toEqual(ALL))
    await m.say('clip the story about tsla deliveries beat into my journal', (c) => [{ action: 'newsLibrary.toNotebook', target: libRef(c), args: { headline: 'tsla deliveries beat' } }])
    await m.apply()
    await waitFor(() => expect(notebook.sent).toHaveLength(1))
    expect(notebook.sent[0].capture.eventId).toBe('id2')
  }, 60000)
  it('NEGATIVE two headlines fit the words: asked with both, nothing sent', async () => {
    const m = mount()
    await waitFor(() => expect(shown()).toEqual(ALL))
    const out = await m.say('send the NVDA headline to my notebook')
    expect(out).toMatch(/Which headline do you mean\?/)
    expect(out).toMatch(/NVDA and AMD rally/)
    expect(out).toMatch(/unusual call volume/)
    expect(proposalsNow()).toHaveLength(0)
    expect(notebook.sent).toHaveLength(0)
  }, 60000)
  it('NEGATIVE the card dismissed: nothing is sent', async () => {
    const m = mount()
    await waitFor(() => expect(shown()).toEqual(ALL))
    await m.say('send the TSLA headline to my notebook')
    expect(proposalsNow()).toHaveLength(1)
    await m.dismiss()
    expect(notebook.sent).toHaveLength(0)
  }, 60000)
  it('NEGATIVE the Notebook refuses: no success is claimed', async () => {
    const m = mount()
    notebook.answer = 'This note is still syncing — try again in a moment.'
    await waitFor(() => expect(shown()).toEqual(ALL))
    await m.say('send the TSLA headline to my notebook')
    await m.apply()
    await waitFor(() => expect(notebook.sent).toHaveLength(1))
    expect(m.p.summaries().join(' ')).not.toMatch(/Sent the headline/)
    expect(m.p.transcript()).toMatch(/still syncing/)
  }, 60000)
  it('NEGATIVE a headline the plan names that the member\'s words did not: dropped, nothing sent', async () => {
    const m = mount()
    await waitFor(() => expect(shown()).toEqual(ALL))
    await m.say('send that story about tariffs to my notebook', (c) => [{ action: 'newsLibrary.toNotebook', target: libRef(c), args: { headline: 'AMD' } }])
    expect(notebook.sent).toHaveLength(0)
    expect(proposalsNow()).toHaveLength(0)
  }, 60000)
})

// ── C3-144: a headline's ticker(s) → a watchlist ──
describe('C3-144: a headline\'s ticker(s) → one of the member\'s watchlists', () => {
  it.each([
    ['add this headline\'s ticker to Momentum', 1, ['AMD']],
    ['add the ticker from the selected headline to my Momentum list', 1, ['AMD']],
    ['add the tickers from this story to Momentum', 3, ['NVDA', 'AMD']],
    ['put this headline\'s stocks on the Momentum watchlist', 3, ['NVDA', 'AMD']],
  ])('"%s" with row %s\'s ⋯ open (instant): exactly its tickers land on the list; Undo takes them off', async (text, seq, want) => {
    const m = mount()
    await waitFor(() => expect(shown()).toEqual(ALL))
    act(() => openMenu(seq))
    await waitFor(() => expect(mountedWidgetDoor('tn').read().selected).toBe(`id${seq}`))
    await m.say(text)
    await waitFor(() => expect(syms(m, 'Momentum')).toEqual(['TSLA', ...want]))
    expect(m.lastReceipt().textContent).toMatch(/Momentum/)
    await m.say('undo')
    await waitFor(() => expect(syms(m, 'Momentum')).toEqual(['TSLA']))
  }, 60000)
  it('"add the tickers from the “unusual call volume” headline to Core" (a quoted phrase, nothing open): NVDA only', async () => {
    const m = mount()
    await waitFor(() => expect(shown()).toEqual(ALL))
    await m.say('add the tickers from the "unusual call volume" headline to Core')
    await waitFor(() => expect(syms(m, 'Core')).toEqual(['SPY', 'NVDA']))
  }, 60000)
  it('NEGATIVE a singular "ticker" on a headline that names two: asked which, nothing added', async () => {
    const m = mount()
    await waitFor(() => expect(shown()).toEqual(ALL))
    act(() => openMenu(3))
    await waitFor(() => expect(mountedWidgetDoor('tn').read().selected).toBe('id3'))
    const out = await m.say('add this headline\'s ticker to Momentum')
    expect(out).toMatch(/NVDA and AMD/)
    expect(out).toMatch(/Nothing was changed/)
    expect(syms(m, 'Momentum')).toEqual(['TSLA'])
  }, 60000)
  it('NEGATIVE a headline that names no ticker: said, nothing added', async () => {
    const m = mount()
    await waitFor(() => expect(shown()).toEqual(ALL))
    act(() => openMenu(4))
    await waitFor(() => expect(mountedWidgetDoor('tn').read().selected).toBe('id4'))
    const out = await m.say('add this headline\'s ticker to Momentum')
    expect(out).toMatch(/names no ticker/)
    expect(syms(m, 'Momentum')).toEqual(['TSLA'])
  }, 60000)
  it('NEGATIVE "this headline" with none open: asked, nothing added', async () => {
    const m = mount()
    await waitFor(() => expect(shown()).toEqual(ALL))
    const out = await m.say('add this headline\'s ticker to Momentum')
    expect(out).toMatch(/Which headline\?/)
    expect(syms(m, 'Momentum')).toEqual(['TSLA'])
    expect(proposalsNow()).toHaveLength(0)
  }, 60000)
})
