// CHARTS OUTCOME — C3-140 (agent/pl/news-filter-presets): the News (Trade Exchange) widget's own filter presets — apply one, save
// the current filters as a named one, rename one, delete one — as one control (`preset`) and one item list (`presets`) of the one
// widget-control layer (widget.setOption → the widget's door → its own applyPreset / savePreset / renamePreset / deletePreset).
// RUN over the REAL TradeExchangeNewsWidget mounted in its WidgetDoorContext slot beside the real Agent panel. Assertions read
// the widget's opts, its own search box and the headlines it shows, never a receipt alone. A second News widget is the control:
// it is never written. Held-out phrasings: agentNewsPresetHeldOut.test.js (committed before the change).
// The feed and the day server are the widget's own synthetic fakes (fakeNewsDay); synthetic headlines only.
// ⛔ THE MODEL IS SCRIPTED (outcomeHarness). Evidence: LOCAL native Windows Node, jsdom, BROWSER-MOCK-MODEL / SIMULATED.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { open, outcomeSuite, afterEachOutcome, chart, must, waitFor, proposalsNow, refusals, screen, fireEvent } from './outcomeHarness'
import { WidgetDoorContext, mountedWidgetDoor } from '../../../pages/charts/widgetDoors'
import { WorkspaceContext } from '../../../pages/charts/WorkspaceContext'
import { APPLY_HELD_OUT, SAVE_HELD_OUT, RENAME_HELD_OUT, DELETE_HELD_OUT, PRESET_REFUSE_HELD_OUT } from '../../agentNewsPresetHeldOut.test.js'

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
      : String(key).includes('/api/watchlists/prebuilt') ? []
        : String(key).includes('/api/watchlists') ? [{ id: 'wl1', name: 'Semis' }] : undefined,
    mutate: () => {},
  }),
}))
vi.mock('../../../pages/watchlist/prebuiltDirectory', () => ({
  PICKER_MY_LISTS_URL: '/api/watchlists?include_items=0&include_prebuilt=0',
  PREBUILT_DIRECTORY_URL: '/api/watchlists/prebuilt?include_items=0',
  usePrebuiltMembership: (ids) => Object.fromEntries((ids || []).map(id => [id, []])),
}))
globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb } observe(el) { this.cb([{ target: el }]) } unobserve() {} disconnect() {} }

const News = (await import('../../../pages/charts/widgets/TradeExchangeNewsWidget')).default
await outcomeSuite()
afterEach(() => { afterEachOutcome(); cleanup() })

// the suite pins the clock (outcomeSuite) only once it runs: the headlines are stamped at mount, on that clock
const H = (NOW, seq, content, category) => ({ type: 'headline', epoch: 'e', seq, id: `id${seq}`, source: 'TX-News', content, tickers: [], category,
  received_at_ms: NOW - (50 - seq) * 1000, repeat_count: 0, via: 'push', delayed: false })
const items = (NOW) => [H(NOW, 1, 'SYNTHETIC: Fed holds rates', 'Macro'), H(NOW, 2, 'SYNTHETIC: tariff talks resume', 'Macro'),
  H(NOW, 3, 'SYNTHETIC: chipmaker beats estimates', 'Earnings'), H(NOW, 4, 'SYNTHETIC: deliveries update', 'News'), H(NOW, 5, 'SYNTHETIC: Fed minutes due', 'Macro')]
const ALL = [1, 2, 3, 4, 5]
// the member's two presets, in the shape the widget's own Save writes (presetSnapshot)
const MACRO = { id: 'pm', name: 'Macro', categories: ['Macro'], linked: false, watchlistId: '', query: 'fed', settings: {} }
const EARN = { id: 'pe', name: 'Earnings Watch', categories: ['Earnings'], linked: false, watchlistId: '', query: '', settings: {} }
const PRESET_SHOWS = { Macro: [1, 5], 'Earnings Watch': [3] }

function Live({ board }) {
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 10); return () => clearInterval(t) }, [])
  const ws = { groupSyms: { N: 'NVDA' }, setGroupSym: () => {}, applyThemeToAllWidgets: () => {}, groupTfs: {}, activeWatchlistRef: { current: null } }
  const onOpts = (id) => (o) => { board.state.widgets = board.state.widgets.map(x => (x.id === id ? { ...x, opts: o } : x)) }
  return (
    <MemoryRouter>
      <WorkspaceContext.Provider value={ws}>
        {board.state.widgets.filter(w => w.type === 'tradeExchangeNews').map(w => (
          <div key={w.id} data-testid={`w-${w.id}`}><WidgetDoorContext.Provider value={w.id}><News color="N" opts={w.opts} onOptsChange={onOpts(w.id)} /></WidgetDoorContext.Provider></div>
        ))}
      </WorkspaceContext.Provider>
    </MemoryRouter>
  )
}
const news = (id, x) => ({ id, type: 'tradeExchangeNews', x, y: 0, w: 6, h: 20, color: 'N', opts: { presets: [MACRO, EARN] } })
function mount({ second = false } = {}) {
  const m = open([chart('c1', 0, 0, 12, 20), news('tn', 12), ...(second ? [news('tb', 18)] : [])], { 'N:c1': 'NVDA' })
  render(<Live board={m.board} />)
  const NOW = Date.now(), ITEMS = items(NOW)
  act(() => feed.set({ status: 'live', items: ITEMS, lastSeq: ITEMS.length, replayUntil: ITEMS.length, lastHeadlineAt: NOW }))
  return m
}
const shown = (id = 'tn') => [...document.querySelectorAll(`[data-testid="w-${id}"] [data-seq]`)].map(r => Number(r.dataset.seq)).sort()
const box = (id = 'tn') => document.querySelector(`[data-testid="w-${id}"] input[aria-label="Search headlines"]`)
const optsOf = (m, id = 'tn') => m.board.state.widgets.find(w => w.id === id).opts
const readOf = (id = 'tn') => mountedWidgetDoor(id)?.read?.() || {}
const names = (m, id = 'tn') => (optsOf(m, id).presets || []).map(p => p.name)
const setOption = (args, id = 'tn') => (c) => {
  must((c.board?.[0]?.widgets || []).find(w => w.id === id), `the News widget ${id}`)
  return [{ action: 'widget.setOption', target: must(c.board?.[0]?.ref, 'board'), args: { widget: id, ...args } }]
}
// AUDIT #1808: a confirmed save or delete offers NO Undo (AUDIT S1-C, board.js undoPatch): "undo" says there is nothing of mine to
// undo, and the presets stay exactly as the confirmed change left them
const noUndo = async (m, keep) => {
  const out = await m.say('undo')
  expect(out, 'the undo reply').toMatch(/in this session/)
  expect(document.body.textContent, 'no Undo for a save or delete').toContain('There is nothing of mine to undo in this session.')
  await new Promise(r => setTimeout(r, 50))
  expect(optsOf(m).presets).toEqual(keep)
}
const ready = async (id = 'tn') => {
  await waitFor(() => expect(readOf(id).presets?.map(p => p.name)).toEqual(['Macro', 'Earnings Watch']))
  await waitFor(() => expect(shown(id)).toEqual(ALL))
}

describe('C3-140 apply: the preset\'s filters and search, through the Filters menu\'s own apply', () => {
  it.each(APPLY_HELD_OUT.map(c => [c.text, c]))('held-out "%s": the widget shows only the preset\'s headlines, its box reads the preset\'s search; Undo puts every filter and the box back', async (text, c) => {
    const m = mount()
    await ready()
    const was = JSON.stringify(optsOf(m))
    const p = c.applies === 'Macro' ? MACRO : EARN
    const out = await m.say(text, setOption(c.args))
    await waitFor(() => expect(optsOf(m).presetId).toBe(p.id))
    expect(optsOf(m).categories).toEqual(p.categories)
    await waitFor(() => expect(box().value).toBe(p.query))
    await waitFor(() => expect(shown()).toEqual(PRESET_SHOWS[c.applies]))
    expect(readOf().preset).toBe(p.id)
    expect(out).toMatch(new RegExp(`preset is now ${c.applies}`))
    await m.say('undo')
    await waitFor(() => expect(JSON.stringify(optsOf(m))).toBe(was))
    await waitFor(() => expect(box().value).toBe(''))
    await waitFor(() => expect(shown()).toEqual(ALL))
  }, 60000)

  it('Undo restores a search the member had typed before the preset, not an empty box', async () => {
    const m = mount()
    await ready()
    act(() => { mountedWidgetDoor('tn').write('search', 'tariff') })
    await waitFor(() => expect(shown()).toEqual([2]))
    await m.say('use my Earnings Watch news preset', setOption({ key: 'preset', value: 'Earnings Watch' }))
    await waitFor(() => expect(box().value).toBe(''))
    await waitFor(() => expect(shown()).toEqual([3]))
    await m.say('undo')
    await waitFor(() => expect(box().value).toBe('tariff'))
    await waitFor(() => expect(shown()).toEqual([2]))
  }, 60000)

  it('Undo is refused once the member has typed a new search after the change (it would erase their words)', async () => {
    const m = mount()
    await ready()
    await m.say('use my macro preset on the news', setOption({ key: 'preset', value: 'Macro' }))
    await waitFor(() => expect(box().value).toBe('fed'))
    act(() => { mountedWidgetDoor('tn').write('search', 'minutes') })
    await waitFor(() => expect(box().value).toBe('minutes'))
    await m.say('undo')
    await new Promise(r => setTimeout(r, 50))
    expect(box().value, 'the member\'s own words stay').toBe('minutes')
    expect(optsOf(m).presetId).toBe('pm')
  }, 60000)

  it('the preset already applied: said, nothing written', async () => {
    const m = mount()
    await ready()
    act(() => { mountedWidgetDoor('tn').write('preset', 'pe') })
    await waitFor(() => expect(readOf().preset).toBe('pe'))
    const was = JSON.stringify(optsOf(m))
    const out = await m.say('use my Earnings Watch news preset', setOption({ key: 'preset', value: 'Earnings Watch' }))
    expect(out).toMatch(/preset is already Earnings Watch/)
    expect(JSON.stringify(optsOf(m))).toBe(was)
    expect(proposalsNow()).toHaveLength(0)
  }, 60000)

  it('two News widgets: asked which first (nothing written); the picked one is filtered, the other is untouched', async () => {
    const m = mount({ second: true })
    await ready(); await ready('tb')
    const was = JSON.stringify(optsOf(m)), other = JSON.stringify(optsOf(m, 'tb'))
    const out = await m.say('use my macro preset on the news', setOption({ key: 'preset', value: 'Macro' }))
    expect(out, 'a question').toMatch(/Which/)
    expect(JSON.stringify(optsOf(m))).toBe(was)
    expect(JSON.stringify(optsOf(m, 'tb'))).toBe(other)
    fireEvent.click(screen.getAllByRole('button', { name: /\(left\)/ }).at(-1))
    await waitFor(() => expect(optsOf(m).presetId).toBe('pm'))
    await waitFor(() => expect(shown()).toEqual([1, 5]))
    expect(JSON.stringify(optsOf(m, 'tb'))).toBe(other)
    expect(shown('tb')).toEqual(ALL)
  }, 60000)
})

describe('C3-140 save / rename / delete: the Filters menu\'s own Save, Rename and Delete', () => {
  it.each(SAVE_HELD_OUT.map(c => [c.text, c]))('held-out "%s": shown first; then one preset of that name holds the widget\'s filters as they are', async (text, c) => {
    const m = mount()
    await ready()
    act(() => { mountedWidgetDoor('tn').write('search', 'tariff') })
    await waitFor(() => expect(shown()).toEqual([2]))
    await m.say(text, setOption(c.args))
    expect(proposalsNow(), 'a save is shown first').toHaveLength(1)
    expect(names(m)).toEqual(['Macro', 'Earnings Watch'])
    await m.apply()
    await waitFor(() => expect(names(m)).toEqual(['Macro', 'Earnings Watch', c.saves]))
    const saved = optsOf(m).presets.at(-1)
    expect(saved).toMatchObject({ name: c.saves, query: 'tariff', categories: [] })
    expect(optsOf(m).presets.slice(0, 2)).toEqual([MACRO, EARN])
    expect(shown(), 'saving filters nothing new').toEqual([2])
    await noUndo(m, [MACRO, EARN, saved])
  }, 60000)

  it.each(RENAME_HELD_OUT.map(c => [c.text, c]))('held-out "%s": that one preset has the new name, its filters unchanged; Undo renames it back', async (text, c) => {
    const m = mount()
    await ready()
    const before = optsOf(m).presets.find(p => p.name === c.from)
    await m.say(text, setOption(c.args))
    await waitFor(() => expect(names(m)).toContain(c.to))
    expect(names(m)).not.toContain(c.from)
    expect(optsOf(m).presets.find(p => p.name === c.to)).toEqual({ ...before, name: c.to })
    expect(optsOf(m).presets.filter(p => p.id !== before.id)).toEqual([MACRO, EARN].filter(p => p.id !== before.id))
    await m.say('undo')
    await waitFor(() => expect(optsOf(m).presets).toEqual([MACRO, EARN]))
  }, 60000)

  it.each(DELETE_HELD_OUT.map(c => [c.text, c]))('held-out "%s": shown first (no Undo); then only that preset is gone', async (text, c) => {
    const m = mount()
    await ready()
    const out = await m.say(text, setOption(c.args))
    if (/Which one do you mean\?/.test(out)) fireEvent.click(screen.getAllByRole('button', { name: new RegExp(`“${c.deletes}”`) }).at(-1))
    await waitFor(() => expect(proposalsNow()).toHaveLength(1))
    expect(names(m)).toEqual(['Macro', 'Earnings Watch'])
    await m.apply()
    await waitFor(() => expect(names(m)).toEqual(['Macro', 'Earnings Watch'].filter(n => n !== c.deletes)))
    expect(optsOf(m).presets).toEqual([MACRO, EARN].filter(p => p.name !== c.deletes))
    await noUndo(m, [MACRO, EARN].filter(p => p.name !== c.deletes))
  }, 60000)

  it('a full list (the menu\'s 12): a save is refused in words, nothing written', async () => {
    const full = Array.from({ length: 12 }, (_, i) => ({ ...EARN, id: `p${i}`, name: `Set ${i}` }))
    const m = open([chart('c1', 0, 0, 12, 20), { ...news('tn', 12), opts: { presets: full } }], { 'N:c1': 'NVDA' })
    render(<Live board={m.board} />)
    await waitFor(() => expect(readOf().presets?.length).toBe(12))
    const was = JSON.stringify(optsOf(m))
    const out = await m.say('save these news filters as Tariffs', setOption({ key: 'presets', value: 'create:Tariffs' }))
    expect(`${out} ${refusals().map(r => r.textContent).join(' ')}`).toMatch(/12 filter presets/)
    expect(JSON.stringify(optsOf(m))).toBe(was)
  }, 60000)
})

describe('NEGATIVE: refused in words; nothing is written', () => {
  it.each(PRESET_REFUSE_HELD_OUT.map(c => [c.text, c]))('held-out "%s"', async (text, c) => {
    const m = mount()
    await ready()
    const was = JSON.stringify(optsOf(m))
    const out = await m.say(text, setOption(c.args))
    expect(`${out} ${refusals().map(r => r.textContent).join(' ')}`).toMatch(c.refuse)
    expect(proposalsNow()).toHaveLength(0)
    expect(JSON.stringify(optsOf(m))).toBe(was)
    expect(box().value).toBe('')
    expect(shown()).toEqual(ALL)
  }, 60000)
})
