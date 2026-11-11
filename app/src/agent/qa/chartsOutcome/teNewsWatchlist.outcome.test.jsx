// CHARTS OUTCOME — C3-139's third filter (pl-exec round 6): the News (Trade Exchange) widget filtered to one of the member's
// watchlists, through its own watchlist select (opts.watchlistId), RUN over the REAL TradeExchangeNewsWidget mounted in its
// WidgetDoorContext slot. The choices are the widget's own (its door's `watchlist` options: All Lists, the member's lists, the
// UCT lists); the plan names a list by its label; the widget then shows only that list's headlines; Undo shows them all again.
// The feed and the day server are the widget's own synthetic fakes (fakeNewsDay); synthetic headlines only.
// ⛔ THE MODEL IS SCRIPTED (outcomeHarness). Evidence: LOCAL native Windows Node, jsdom, BROWSER-MOCK-MODEL / SIMULATED.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { open, outcomeSuite, afterEachOutcome, chart, must, waitFor } from './outcomeHarness'
import { WidgetDoorContext, mountedWidgetDoor } from '../../../pages/charts/widgetDoors'
import { WorkspaceContext } from '../../../pages/charts/WorkspaceContext'
import { SEARCH_HELD_OUT, SEARCH_CLEAR_HELD_OUT } from '../../agentExecHeldOut7.test.js'

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
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPref: () => {} }), parsePref: (_v, d) => d }))
vi.mock('../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, staleSymbols: new Set(), isLoading: false, isStreaming: true }) }))
vi.mock('swr', async (orig) => ({
  ...(await orig()),
  default: (key) => ({
    data: !key ? undefined
      : String(key).includes('/api/watchlists/prebuilt') ? [{ id: 'pre1', name: 'S&P 500' }]
        : String(key).includes('/api/watchlists') ? [{ id: 'wl1', name: 'Semis' }, { id: 'wl2', name: 'Core' }] : undefined,
    mutate: () => {},
  }),
}))
// the lists' members, as the widget's own membership hook returns them
vi.mock('../../../pages/watchlist/prebuiltDirectory', () => ({
  PICKER_MY_LISTS_URL: '/api/watchlists?include_items=0&include_prebuilt=0',
  PREBUILT_DIRECTORY_URL: '/api/watchlists/prebuilt?include_items=0',
  usePrebuiltMembership: (ids) => Object.fromEntries((ids || []).map(id => [id, id === 'wl1' ? [{ sym: 'AMD' }] : id === 'wl2' ? [{ sym: 'SPY' }] : []])),
}))
globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb } observe(el) { this.cb([{ target: el }]) } unobserve() {} disconnect() {} }

const News = (await import('../../../pages/charts/widgets/TradeExchangeNewsWidget')).default
await outcomeSuite()
afterEach(() => { afterEachOutcome(); cleanup() })

// the suite pins the clock (outcomeSuite) only once it runs: the headlines are stamped at mount, on that clock
const H = (NOW, seq, content, tickers) => ({ type: 'headline', epoch: 'e', seq, id: `id${seq}`, source: 'TX-News', content, tickers, category: 'News',
  received_at_ms: NOW - (50 - seq) * 1000, repeat_count: 0, via: 'push', delayed: false })
const items = (NOW) => [H(NOW, 1, 'SYNTHETIC: AMD guidance raised', ['AMD']), H(NOW, 2, 'SYNTHETIC: TSLA deliveries', ['TSLA']), H(NOW, 3, 'SYNTHETIC: SPY options expiry', ['SPY']), H(NOW, 4, 'SYNTHETIC: tariff talks resume', []), H(NOW, 5, 'SYNTHETIC: Fed holds rates', [])]

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
function mount() {
  const m = open([chart('c1', 0, 0, 12, 20), { id: 'tn', type: 'tradeExchangeNews', x: 12, y: 0, w: 12, h: 20, color: 'N', opts: {} }], { 'N:c1': 'NVDA' })
  render(<Live board={m.board} />)
  const NOW = Date.now(), ITEMS = items(NOW)
  act(() => feed.set({ status: 'live', items: ITEMS, lastSeq: ITEMS.length, replayUntil: ITEMS.length, lastHeadlineAt: NOW }))
  return m
}
const shown = () => [...document.querySelectorAll('[data-testid="w-tn"] [data-seq]')].map(r => Number(r.dataset.seq)).sort()
const setOption = (value) => (c) => [{ action: 'widget.setOption', target: must(c.board?.[0]?.ref, 'board'), args: { widget: 'tn', key: 'watchlist', value } }]
const search = (value) => (c) => [{ action: 'widget.setOption', target: must(c.board?.[0]?.ref, 'board'), args: { widget: 'tn', key: 'search', value } }]
const box = () => document.querySelector('[data-testid="w-tn"] input[aria-label="Search headlines"]')
const optsOf = (m) => m.board.state.widgets.find(w => w.id === 'tn').opts

describe('C3-139: the News widget filtered to one of the member\'s watchlists, through its own select', () => {
  it.each([['only show headlines for my Semis list in the news widget', 'Semis', 'wl1', [1]], ['filter the trade exchange news to the core watchlist', 'Core', 'wl2', [3]]])('"%s": the widget shows only that list\'s headlines; Undo shows them all', async (text, name, id, seqs) => {
    const m = mount()
    await waitFor(() => expect(mountedWidgetDoor('tn')?.options?.().watchlist.map(o => o.label)).toEqual(['All Lists', 'Semis', 'Core', 'UCT · S&P 500']))
    await waitFor(() => expect(shown()).toEqual([1, 2, 3, 4, 5]))
    const out = await m.say(text, setOption(name))
    await waitFor(() => expect(optsOf(m).watchlistId).toBe(id))
    await waitFor(() => expect(shown()).toEqual(seqs))
    expect(out).toMatch(new RegExp(`watchlist is now ${name}`))
    await m.say('undo')
    await waitFor(() => expect(optsOf(m).watchlistId ?? null).toBe(null))
    await waitFor(() => expect(shown()).toEqual([1, 2, 3, 4, 5]))
  }, 60000)
  it('NEGATIVE a list the member does not have: refused with the widget\'s own choices, nothing filtered', async () => {
    const m = mount()
    await waitFor(() => expect(mountedWidgetDoor('tn')?.options?.().watchlist.length).toBe(4))
    const out = await m.say('filter the news widget to my biotech watchlist', setOption('Biotech'))
    expect(out).toMatch(/Semis/)
    expect(optsOf(m).watchlistId ?? null).toBe(null)
    expect(shown()).toEqual([1, 2, 3, 4, 5])
  }, 60000)
})

// C3-138 (round 7): the widget's own "Search headlines" box, through its door (its own setter, as typing does). Read back: the box
// shows the words and the list shows only the matching headlines; Undo empties the box and every headline is back.
describe('C3-138: search the News widget through its own search box', () => {
  const MATCH = { tariff: [4], guidance: [1], Fed: [5] }
  it.each([...SEARCH_HELD_OUT.map(c => [c.text, c.value]), ['find Fed headlines in the trade exchange news', 'Fed']])('"%s": the box reads the words, only the matching headlines show; Undo clears it', async (text, value) => {
    const m = mount()
    await waitFor(() => expect(shown()).toEqual([1, 2, 3, 4, 5]))
    const out = await m.say(text, search(value))
    await waitFor(() => expect(box().value).toBe(value))
    await waitFor(() => expect(shown()).toEqual(MATCH[value]))
    expect(out).toMatch(new RegExp(`search is now ${value}`))
    await m.say('undo')
    await waitFor(() => expect(box().value).toBe(''))
    await waitFor(() => expect(shown()).toEqual([1, 2, 3, 4, 5]))
  }, 60000)
  it.each(SEARCH_CLEAR_HELD_OUT.map(c => [c.text]))('"%s": a search typed by hand is cleared', async (text) => {
    const m = mount()
    await waitFor(() => expect(box()).toBeTruthy())
    act(() => { mountedWidgetDoor('tn').write('search', 'tariff') })
    await waitFor(() => expect(shown()).toEqual([4]))
    const out = await m.say(text, search(''))
    await waitFor(() => expect(box().value).toBe(''))
    await waitFor(() => expect(shown()).toEqual([1, 2, 3, 4, 5]))
    expect(out).toMatch(/search is now none/)
  }, 60000)
  it('NEGATIVE words longer than the box takes: refused, the box is untouched', async () => {
    const m = mount()
    await waitFor(() => expect(box()).toBeTruthy())
    const out = await m.say('search the news widget for this very long sentence', search('x'.repeat(120)))
    expect(out).toMatch(/at most 80 characters/)
    expect(box().value).toBe('')
  }, 60000)
})
