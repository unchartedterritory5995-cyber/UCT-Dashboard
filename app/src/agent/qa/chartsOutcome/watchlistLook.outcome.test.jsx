// CHARTS OUTCOME — watchlist groups C (look) and B (Flagged's name), pl-widget: the Watchlist widget's own ⚙ appearance writer,
// its look templates and its Flagged Rename, as rows of the one widget-control layer (widget.setOption → the widget's door).
// Over the REAL WatchlistWidget → Watchlists (its own patchSettings → this widget's opts.settings, its own useWatchlistTemplates →
// the `watchlist_templates` preference, its own useFlagged renameFlagged), mounted in its WidgetDoorContext slot beside the real
// Agent panel. Assertions read the widget's opts, the stored preference and the Flagged hook's own state, never a receipt alone.
// Held-out phrasings: agentWatchlistLookHeldOut.test.js (committed before the change).
//
// ⛔ THE MODEL IS SCRIPTED (outcomeHarness): a colour NAME ("navy") is the planner's to turn into #rrggbb, so the plan carries the
// hex. Data is invented fixture data. Evidence: LOCAL native Windows Node, jsdom, BROWSER-MOCK-MODEL / SIMULATED.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { open, outcomeSuite, afterEachOutcome, chart, must, waitFor, proposalsNow, refusals, screen, fireEvent } from './outcomeHarness'
import { WidgetDoorContext, mountedWidgetDoor } from '../../../pages/charts/widgetDoors'
import { WorkspaceContext } from '../../../pages/charts/WorkspaceContext'
import { AuthContext } from '../../../context/AuthContext'
import { APPEARANCE_HELD_OUT, LOOK_HELD_OUT, FLAGGED_NAME_HELD_OUT, LOOK_REFUSE_HELD_OUT } from '../../agentWatchlistLookHeldOut.test.js'

vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
vi.mock('../../../components/StockChart', () => ({ default: () => null }))
vi.mock('../../../components/chart/SymbolSearch', () => ({ default: () => null }))
vi.mock('../../../components/chart/pane/ChartPane', () => ({ default: () => null }))
vi.mock('../../../components/CompanyLogo', () => ({ default: () => null }))
vi.mock('echarts-for-react', () => ({ default: () => null }))
vi.mock('../../../utils/prefetchBars', () => ({
  prefetchBar: () => {}, prefetchBars: () => {}, prefetchBarsToIDB: () => {}, prefetchAllTimeframes: () => {}, prefetchListDeep: () => {},
  prefetchBarOnIntent: () => {}, prefetchListAllTimeframes: () => {}, warmMemFromIDB: () => {}, prewarmVisibleList: () => {},
}))
vi.mock('../../../lib/chartReadoutStore', () => ({ subscribeChartReadouts: () => () => {}, getChartReadout: () => null, hasFreshReadouts: () => false }))
vi.mock('../../../pages/charts/useListSubscribeEnabled', () => ({ default: () => false }))
const data = vi.hoisted(() => ({ prefs: {}, flaggedName: 'Flagged', renames: [] }))
const PAPER = { id: 'tpl-paper', name: 'Paper', settings: { bgMode: 'solid', bg: '#ffffff', textColor: '#1f2328', upColor: '#17a917', downColor: '#db000b', showLogos: false, tintEnabled: false } }
// the preference store the widget's own hooks read and write (useWatchlistTemplates: `watchlist_templates`)
vi.mock('../../../hooks/usePreferences', () => ({
  default: () => ({ prefs: data.prefs, setPref: (k, v) => { data.prefs = { ...data.prefs, [k]: v } }, loading: false }),
  parsePref: (raw, fallback) => { try { return raw == null ? fallback : JSON.parse(raw) } catch { return fallback } },
}))
vi.mock('../../../hooks/usePlacedTheme', () => ({ default: () => null }))
vi.mock('../../../hooks/useFlagged', () => ({
  useFlagged: () => ({ flagged: ['AAA'], toggle: () => {}, remove: () => {}, clearAll: () => {}, isFlagged: () => false, isShared: false, toggleShare: () => {},
    flaggedName: data.flaggedName, renameFlagged: (n) => { const t = String(n).trim(); if (t) { data.flaggedName = t; data.renames.push(t) } } }),
}))
vi.mock('../../../hooks/useTickerTags', () => ({ default: () => ({ tags: {}, setTag: () => {}, removeTag: () => {}, getTag: () => null, shared: [], isColorShared: () => false, toggleShareColor: () => {}, communityTags: [] }) }))
vi.mock('../../../hooks/useWatchlistAlerts', () => ({ default: () => ({ alerts: [], createAlert: () => {}, deleteAlert: () => {}, getAlertsForSym: () => [], hasAlert: () => false }) }))
vi.mock('../../../hooks/useTagColors', () => ({ default: () => ({ tagColors: [], tagByKey: {}, setTagLabel: () => {} }) }))
vi.mock('../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, isLoading: false, isStreaming: false, staleSymbols: new Set() }) }))
vi.mock('../../../hooks/useLivePrices', () => ({ default: () => ({ prices: {}, isLoading: false }) }))
vi.mock('../../../hooks/useWatchlistPerformance', () => ({ default: () => ({ perfData: {}, isLoading: false }) }))
vi.mock('../../../hooks/useWatchlistMeta', () => ({ default: () => ({ metaData: {}, isLoading: false }) }))
vi.mock('../../../hooks/useWatchlistThemes', () => ({ default: () => ({ themeData: {}, isLoading: false }) }))
const WL = { id: 'wl1', name: 'Momentum', description: '', items: [{ id: 'i1', sym: 'AAA', notes: '' }, { id: 'i2', sym: 'BBB', notes: '' }] }
const _key = (k) => (typeof k === 'string' ? k.split('?')[0] : null)
vi.mock('swr', async (orig) => ({ ...(await orig()), default: (key) => {
  if (_key(key) === '/api/watchlists') return { data: [WL], mutate: () => {} }
  if (_key(key) === '/api/watchlists/public' || _key(key) === '/api/watchlists/prebuilt') return { data: [], mutate: () => {} }
  return { data: undefined, mutate: () => {} }
} }))

const WatchlistWidget = (await import('../../../pages/charts/widgets/WatchlistWidget')).default
await outcomeSuite()

function Live({ board }) {
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 10); return () => clearInterval(t) }, [])
  const onOpts = (id) => (opts) => { board.state.widgets = board.state.widgets.map(x => (x.id === id ? { ...x, opts } : x)) }
  const ws = { groupSyms: { N: null }, setGroupSym: () => {}, groupTfs: {}, activeWatchlistRef: { current: null } }
  return (
    <MemoryRouter>
      <AuthContext.Provider value={{ user: { id: 'u1', role: 'user' } }}>
        <WorkspaceContext.Provider value={ws}>
          {board.state.widgets.filter(w => w.type === 'watchlist').map(w => (
            <div key={w.id} data-testid={`w-${w.id}`}><WidgetDoorContext.Provider value={w.id}><WatchlistWidget color={w.color} opts={w.opts} onOptsChange={onOpts(w.id)} /></WidgetDoorContext.Provider></div>
          ))}
        </WorkspaceContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>
  )
}
const MINE = { watchKey: 'user:wl1', watchName: 'Momentum', watchTab: 'mine' }
const FLAGGED = { watchKey: 'flagged', watchName: 'Flagged', watchTab: 'mine' }
const wl = (id, opts, x = 12) => ({ id, type: 'watchlist', x, y: 0, w: 6, h: 20, color: 'N', opts })
function board(widgets) {
  data.prefs = { watchlist_templates: JSON.stringify([PAPER]) }; data.flaggedName = 'Flagged'; data.renames = []
  const m = open([chart('c1', 0, 0, 12, 20), ...widgets], { 'N:c1': 'AAA' })
  render(<Live board={m.board} />)
  return m
}
function setOption(args, seen = {}, id = 'wa') {
  return (c, body) => {
    seen.first ??= (body.capabilities || []).some(x => x.name === 'widget.setOption')
    must((c.board?.[0]?.widgets || []).find(w => w.id === id), `the watchlist ${id}`)
    return [{ action: 'widget.setOption', target: must(c.board?.[0]?.ref, 'board'), args: { widget: id, ...args } }]
  }
}
const optsOf = (m, id = 'wa') => m.board.state.widgets.find(w => w.id === id).opts
const readOf = (id = 'wa') => mountedWidgetDoor(id)?.read?.() || {}
const templates = () => JSON.parse(data.prefs.watchlist_templates || '[]')
const ready = (id = 'wa') => waitFor(() => expect(readOf(id).looks).toBeTruthy())

afterEach(() => { afterEachOutcome(); cleanup() })

describe('C3-103: the list\'s appearance, through the ⚙ panel\'s own writer (this widget\'s opts.settings)', () => {
  // Two Watchlist widgets showing the same list, and held-out words that name neither ("my watchlist"): under the which-widget
  // rule (AUDIT #1027 F1, agent/whichWidget.js) the member is ASKED first and nothing is written; they pick the left one, and only
  // then is the look written there. (Before F1 the plan's pick was acted on with no question; that is u18-look-07's bug.)
  it.each(APPEARANCE_HELD_OUT.map(c => [c.text, c]))('held-out "%s": asked which first (nothing written), then the picked widget reads it back; the other Watchlist widget is untouched; Undo restores the opts exactly', async (text, c) => {
    const m = board([wl('wa', MINE), wl('wb', { ...MINE }, 18)])
    await ready(); await ready('wb')
    const was = JSON.stringify(optsOf(m)), other = JSON.stringify(optsOf(m, 'wb'))
    const seen = {}
    const out = await m.say(text, setOption(c.args, seen))
    expect(out, 'a question').toMatch(/Which Watchlist/)
    expect(JSON.stringify(optsOf(m)), 'nothing written before the answer').toBe(was)
    expect(JSON.stringify(optsOf(m, 'wb'))).toBe(other)
    fireEvent.click(screen.getAllByRole('button', { name: /Watchlist \(left\)/ }).at(-1))
    await waitFor(() => expect(readOf()).toMatchObject(c.want))
    expect(optsOf(m).settings, 'written into this widget\'s own opts.settings').toBeTruthy()
    expect(JSON.stringify(optsOf(m, 'wb'))).toBe(other)
    await m.say('undo')
    await waitFor(() => expect(JSON.stringify(optsOf(m))).toBe(was))
    void seen
  }, 60000)
})

describe('C3-104: looks — save, apply, delete — through the ⚙ panel\'s Templates', () => {
  it.each(LOOK_HELD_OUT.map(c => [c.text, c]))('held-out "%s"', async (text, c) => {
    const m = board([wl('wa', MINE)])
    await ready()
    const was = JSON.stringify(optsOf(m))
    await m.say(text, setOption(c.args))
    if (c.saves || c.deletes) {
      // saving replaces a look of the same name and deleting cannot be undone: both are shown first
      expect(proposalsNow()).toHaveLength(1)
      expect(templates()).toEqual([PAPER])
      await m.apply()
    }
    if (c.saves) {
      await waitFor(() => expect(templates().map(t => t.name)).toEqual(['Paper', c.saves]))
      expect(templates()[1].settings).toMatchObject({ showLogos: true })          // the look the widget had, not Paper's
      expect(JSON.stringify(optsOf(m))).toBe(was)                                  // saving changes nothing on the widget
    }
    if (c.deletes) {
      await waitFor(() => expect(templates()).toEqual([]))
      expect(JSON.stringify(optsOf(m))).toBe(was)
    }
    if (c.applies) {
      await waitFor(() => expect(readOf().look).toBe(PAPER.id))
      expect(optsOf(m).settings).toMatchObject(PAPER.settings)
      await m.say('undo')
      await waitFor(() => expect(JSON.stringify(optsOf(m))).toBe(was))
    }
  }, 60000)
})

describe('C3-074: rename the Flagged list, as its title menu\'s Rename does', () => {
  it.each(FLAGGED_NAME_HELD_OUT.map(c => [c.text, c]))('held-out "%s": the Flagged hook holds the new name; Undo renames it back', async (text, c) => {
    const m = board([wl('wa', FLAGGED)])
    await waitFor(() => expect(readOf().flaggedName).toBe('Flagged'))
    await m.say(text, setOption(c.args))
    await waitFor(() => expect(data.flaggedName).toBe(c.want))
    await m.say('undo')
    await waitFor(() => expect(data.flaggedName).toBe('Flagged'))
    expect(data.renames).toEqual([c.want, 'Flagged'])
  }, 60000)
})

// F4 (u18-flagged-01 / u18-flagged-02): the Flagged hook took the new name, but the widget's own title went on reading "Flagged"
// (it drew opts.watchName, the name the list had when it was picked), so the receipt said "is now Top Ideas" over a face that
// did not change. Asserted here on THE FACE: the title text inside this widget, and the door's read-back is that same title.
// A second Watchlist widget (Momentum) is the control: its title never changes.
const titleOf = (id = 'wa') => document.querySelector(`[data-testid="w-${id}"] [data-guide="watchlist.title"]`)?.textContent ?? null
describe('F4 u18-flagged-01/02: the widget\'s own title (the face the member sees) shows the new name', () => {
  it.each([
    ['u18-flagged-01', 'rename flagged to Top Ideas', 'Top Ideas'],
    ['u18-flagged-02', 'call my flagged list Shortlist instead', 'Shortlist'],
  ])('%s "%s": the title reads the new name and the read-back is that title; Undo puts "Flagged" back on the face', async (_id, text, want) => {
    const m = board([wl('wa', FLAGGED), wl('wb', MINE, 18)])
    await waitFor(() => expect(titleOf()).toBe('Flagged'))
    expect(titleOf('wb')).toBe('Momentum')
    await m.say(text, setOption({ key: 'flaggedName', value: want }))
    await waitFor(() => expect(titleOf()).toBe(want))
    expect(readOf().flaggedName).toBe(titleOf())
    expect(titleOf('wb')).toBe('Momentum')
    await m.say('undo')
    await waitFor(() => expect(titleOf()).toBe('Flagged'))
    expect(readOf().flaggedName).toBe('Flagged')
    expect(titleOf('wb')).toBe('Momentum')
  }, 60000)
})

describe('NEGATIVE: refused in words; nothing is written', () => {
  it.each(LOOK_REFUSE_HELD_OUT.map(c => [c.text, c]))('held-out "%s"', async (text, c) => {
    const m = board([wl('wa', c.notFlagged ? MINE : MINE)])
    await ready()
    const was = JSON.stringify(optsOf(m))
    const out = await m.say(text, setOption(c.args))
    expect(`${out} ${refusals().map(r => r.textContent).join(' ')}`).toMatch(c.refuse)
    expect(JSON.stringify(optsOf(m))).toBe(was)
    expect(templates()).toEqual([PAPER])
    expect(data.renames).toEqual([])
  }, 60000)
})
