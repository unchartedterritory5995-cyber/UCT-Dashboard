// newsLibrary.* on the REAL TradeExchangeNewsWidget (this file's mocks are TradeExchangeNewsWidget.saved.test.jsx's): the
// widget's door publishes the rows it RENDERS (read-only — nothing is computed for the Agent) and the one the member has
// open; UCT Agent names a headline from them and saves it through the SAME library module the row's bookmark calls — the
// row's own ★ then reads saved, and Undo clears it. The pool, the day server and the library server are faked; synthetic only.
import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const feed = vi.hoisted(() => {
  const listeners = new Set()
  let state = { status: 'idle', items: [], epoch: 'e', lastSeq: 0, firstSeq: 0, coverage: null, provisional: true }
  return {
    listeners,
    get: () => state,
    set(next) { state = { ...state, ...next }; for (const fn of [...listeners]) fn(state) },
    reset() { listeners.clear(); state = { status: 'idle', items: [], epoch: 'e', lastSeq: 0, firstSeq: 0, coverage: null, provisional: true } },
  }
})
vi.mock('../../../lib/tradeExchangeNewsStreamManager', async () => {
  const { fakeNewsDay, fakeNewsDays } = await import('../../../testing/tradeExchangeNews/fakeNewsDay')
  return {
    subscribe: (fn) => { feed.listeners.add(fn); return () => feed.listeners.delete(fn) },
    getSnapshot: () => feed.get(),
    retry: vi.fn(),
    fetchDay: async (body) => fakeNewsDay(feed.get().items, body, {}),
    fetchDays: async () => fakeNewsDays(feed.get().items, {}),
    claimAnnouncement: () => true,
  }
})
const setGroupSym = vi.fn()
vi.mock('../WorkspaceContext', () => ({
  useWorkspace: () => ({ groupSyms: { A: 'NVDA' }, setGroupSym, applyThemeToAllWidgets: vi.fn() }),
}))
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPref: vi.fn() }), parsePref: (_v, d) => d }))
vi.mock('../../../utils/alertSound', async (orig) => ({ ...(await orig()), playAlertSound: vi.fn(), previewSound: vi.fn() }))
vi.mock('swr', () => ({ default: () => ({ data: undefined, mutate: vi.fn() }) }))
vi.mock('../../watchlist/prebuiltDirectory', () => ({
  PICKER_MY_LISTS_URL: '/api/watchlists?include_items=0&include_prebuilt=0',
  PREBUILT_DIRECTORY_URL: '/api/watchlists/prebuilt?include_items=0',
  usePrebuiltMembership: () => ({}),
}))
vi.mock('../../../hooks/useRealtimePrices', () => ({
  default: () => ({ prices: {}, staleSymbols: new Set(), isLoading: false, isStreaming: true }),
}))
const notebook = vi.hoisted(() => ({ send: null }))
vi.mock('../../journal-2-0/lib/sendToJournal', () => ({ sendCaptureToJournal: (...a) => notebook.send(...a) }))

import TradeExchangeNewsWidget from './TradeExchangeNewsWidget'
import { WidgetDoorContext, mountedWidgetDoor } from '../widgetDoors'
import { registerBuiltins } from '../../../agent/builtins'
import { buildContext } from '../../../agent/capabilities'
import { planOps, collectTargets, prepareOps } from '../../../agent/executor'
import { commitPlan, undoEntry } from '../../../agent/runtime'
import * as library from '../../../lib/tradeExchangeNewsLibrary'
import { _resetNewsLibraryForTests } from '../../../agent/capabilities/newsLibrary'
import { WORKSPACE_WIDGETS } from '../WidgetHost'
import { _resetLibraryForTests } from '../../../lib/tradeExchangeNewsLibrary'
import { _resetNotebookSendsForTests } from '../../../lib/tradeExchangeNewsNotebook'
import { fakeLibraryServer } from '../../../testing/tradeExchangeNews/fakeLibraryServer'

globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }

const NOW = Date.now()
const H = (seq, content, tickers = [], extra = {}) => ({ type: 'headline', epoch: 'e', seq, id: `id${seq}`,
  source: 'TX-News', content, tickers, category: 'News', received_at_ms: NOW - (50 - seq) * 1000,
  repeat_count: 0, via: 'push', delayed: false, ...extra })
const BASE = [
  H(1, 'SYNTHETIC: AMD guidance raised', ['AMD']),
  H(2, 'SYNTHETIC: Fed minutes due'),
  H(3, 'SYNTHETIC: NVDA and AMD rally', ['NVDA', 'AMD']),
]


registerBuiltins()
let lib
function mount(items = BASE) {
  const utils = render(<WidgetDoorContext.Provider value="n1"><TradeExchangeNewsWidget color="A" opts={{}} onOptsChange={() => {}} /></WidgetDoorContext.Provider>)
  const last = Math.max(...items.map(h => h.seq))
  act(() => feed.set({ status: 'live', items, lastSeq: last, replayUntil: last, lastHeadlineAt: NOW }))
  return utils
}
const rowEl = (c, seq) => c.querySelector(`[data-seq="${seq}"]`)
const bookmarkOf = (c, seq) => rowEl(c, seq)?.querySelector('button[aria-label="Save headline"], button[aria-label="Remove bookmark"]')
const host = () => ({ widgets: { ids: () => [{ id: 'n1', type: 'tradeExchangeNews' }], door: (id) => mountedWidgetDoor(id) } })
const CTX = { surface: 'charts' }
const noAct = async (fn) => { const prev = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = false; try { return await fn() } finally { globalThis.IS_REACT_ACT_ENVIRONMENT = prev } }
async function run(h, args) {
  buildContext(h, { ...CTX, message: 'save the NVDA headline' })
  const ops = [{ action: 'newsLibrary.save', target: 'library', args }]
  const plan = planOps(collectTargets(h, ['newsLibrary']), ops, await prepareOps(ops), CTX)
  expect(plan.ok, JSON.stringify(plan.refusals)).toBe(true)
  return noAct(() => commitPlan(h, plan, { env: {}, ctx: CTX }))
}

beforeEach(() => {
  feed.reset()
  _resetLibraryForTests()
  _resetNewsLibraryForTests()
  lib = fakeLibraryServer(BASE)
  vi.stubGlobal('fetch', vi.fn((url, init) => lib.fetch(url, init)))
})
afterEach(() => vi.unstubAllGlobals())

describe('the News widget door and the Agent’s save', () => {
  it('the door publishes exactly the rows it renders (ids, tickers, text) — nothing else — and nothing is open', async () => {
    const { container } = mount()
    await waitFor(() => expect(rowEl(container, 3)).toBeTruthy())
    const r = mountedWidgetDoor('n1').read()
    const rendered = [...container.querySelectorAll('[data-seq]')].map(e => Number(e.getAttribute('data-seq')))
    expect(r.visible.map(v => v.id).sort()).toEqual(BASE.filter(h => rendered.includes(h.seq)).map(h => h.id).sort())
    expect(r.visible.find(v => v.id === 'id3')).toMatchObject({ tickers: ['NVDA', 'AMD'], text: 'SYNTHETIC: NVDA and AMD rally' })
    expect(r.selected).toBeNull()
  })
  it('AUDIT D13: a headline LONGER than 80 characters reaches the Agent cut to exactly its first 80', async () => {
    const LONG = H(4, 'SYNTHETIC: semiconductor suppliers extend the rally as guidance from three large customers comes in above every estimate', ['AMD'])
    expect(LONG.content.length).toBeGreaterThan(80)
    const { container } = mount([...BASE, LONG])
    await waitFor(() => expect(rowEl(container, 4)).toBeTruthy())
    const v = mountedWidgetDoor('n1').read().visible.find(x => x.id === 'id4')
    expect(v.text).toBe(LONG.content.slice(0, 80))
    expect(v.text).toHaveLength(80)
  })
  it('"save the NVDA headline": the ONE row tagged NVDA is saved through the library module — its own ★ reads saved; Undo clears it', async () => {
    const { container } = mount()
    await waitFor(() => expect(rowEl(container, 3)).toBeTruthy())
    await act(async () => { await library.load({ force: true }) })
    const h = host()
    const res = await run(h, { headline: 'NVDA', saved: true })
    expect(res.ok, res.reason).toBe(true)
    expect(res.lines[0]).toMatch(/^Saved the headline “SYNTHETIC: NVDA and AMD rally” to your library$/)
    await waitFor(() => expect(bookmarkOf(container, 3)).toHaveAttribute('aria-pressed', 'true'))
    expect(bookmarkOf(container, 1)).toHaveAttribute('aria-pressed', 'false')
    expect(lib.calls.filter(c => c.startsWith('PUT /bookmarks/'))).toEqual(['PUT /bookmarks/id3'])
    const u = await noAct(() => undoEntry(h, res.undo))
    expect(u.ok, u.reason).toBe(true)
    await waitFor(() => expect(bookmarkOf(container, 3)).toHaveAttribute('aria-pressed', 'false'))
  })
})
