// CHARTS OUTCOME — round 2 of execution family W (pl-exec): the door rows the first round only wrote, RUN over the REAL widgets
// (Volume Surge's list, the Breadth heatmap's readings, the Market Map's universes and axes), and the Journal family
// (widget.sendToJournal) over the REAL Indexes, UCT Terminal, Breadth and Theme Tracker widgets' own capture doors. Each widget is
// mounted in its WidgetDoorContext slot beside the real Agent panel; its onOptsChange writes the board. Assertions read what the
// widget draws, its door and the board; a Journal send is read at the Journal's own door function (the capture it was handed),
// never a receipt alone.
//
// ⛔ THE MODEL IS SCRIPTED (outcomeHarness). Data is invented fixture data. Evidence: LOCAL native Windows Node, jsdom,
// BROWSER-MOCK-MODEL / SIMULATED.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { open, outcomeSuite, afterEachOutcome, chart, must, waitFor, proposalsNow } from './outcomeHarness'
import { WidgetDoorContext, mountedWidgetDoor } from '../../../pages/charts/widgetDoors'
import { WorkspaceContext } from '../../../pages/charts/WorkspaceContext'
import { AuthContext } from '../../../context/AuthContext'

vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
vi.mock('../../../components/StockChart', () => ({ default: () => null }))
vi.mock('../../../components/chart/pane/ChartPane', () => ({ default: () => null }))
vi.mock('../../../components/CompanyLogo', () => ({ default: () => null }))
vi.mock('echarts-for-react', () => ({ default: () => null }))
const data = vi.hoisted(() => ({
  sent: [],
  notes: [],
  prefs: { volume_scan_lists: JSON.stringify([{ id: 'l1', name: 'Semis', syms: ['NVDA', 'AMD'] }, { id: 'l2', name: 'Core', syms: ['SPY'] }]) },
  snapshot: { etfs: { SPY: { price: '1.00', chg: '+0.10%' }, QQQ: { price: '2.00', chg: '-0.20%' } }, futures: {} },
  day: { bmo: [{ sym: 'AAA' }], amc: [], tbd: [], econ: [], fed: [] },
  metrics: { metrics: [{ key: 'rvol', label: 'Relative Volume' }, { key: 'chg_today', label: 'Day Change' }, { key: 'market_cap', label: 'Market Cap' }] },
  universes: { groups: [{ group: 'Indexes', items: [{ source: 'index', value: 'sp500', label: 'S&P 500' }, { source: 'index', value: 'ndx', label: 'Nasdaq 100' }] }] },
  themes: [{ ticker: 'SEMI', name: 'Semis', group_return: { '1d': 2 }, holdings: [{ sym: 'SEMI1', returns: { '1d': 2 } }] }],
}))
vi.mock('../../../pages/journal-2-0/lib/sendToJournal', () => ({
  sendCaptureToJournal: async (kind, capture, opts) => { data.sent.push({ kind, capture, opts }); return `Sent to ${opts?.target === 'inbox' ? 'your Notebook inbox' : 'your note'}` },
}))
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: data.prefs, setPref: () => {}, loading: false }), parsePref: (raw, fallback) => { try { return raw == null ? fallback : JSON.parse(raw) } catch { return fallback } } }))
vi.mock('../../../hooks/usePlacedTheme', () => ({ default: () => null }))
vi.mock('../../../hooks/useTickerMeta', () => ({ default: () => ({ name: '' }) }))
vi.mock('../../../hooks/useLiveBreadth', () => ({ useLiveBreadth: () => ({ row: null }) }))
vi.mock('../../../hooks/useThemeIndexBars', () => ({ default: () => ({}) }))
vi.mock('../../../hooks/useFlagged', () => ({ useFlagged: () => ({ isFlagged: () => false, toggle: () => {}, flagged: [] }) }))
vi.mock('../../../hooks/useTickerTags', () => ({ default: () => ({ tags: {}, setTag: () => {}, removeTag: () => {}, getTag: () => null, shared: [], isColorShared: () => false, toggleShareColor: () => {}, communityTags: [] }) }))
vi.mock('../../../hooks/useNeighborWarm', () => ({ useNeighborWarm: () => {} }))
vi.mock('../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, isLoading: false, isStreaming: false, staleSymbols: new Set() }) }))
vi.mock('../../../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../../../hooks/useThemeSets', () => ({ useThemeSets: () => ({ enabled: false, sets: [], createSet: async () => null, deleteSet: async () => {}, renameSet: async () => {}, refreshSets: () => {} }), getSetDef: async () => null, putSetDef: async () => {} }))
vi.mock('../../../utils/prefetchBars', () => ({
  prefetchBar: () => {}, prefetchBars: () => {}, prefetchBarsToIDB: () => {}, prefetchAllTimeframes: () => {},
  prefetchBarOnIntent: () => {}, prefetchListAllTimeframes: () => {}, warmMemFromIDB: () => {}, prewarmVisibleList: () => {},
}))
vi.mock('../../../pages/charts/useListSubscribeEnabled', () => ({ default: () => false }))
// the Scanner's results table is the Watchlists page component; its door, criteria and capture are ScannerResults' own, so the
// table itself is a stand-in here
vi.mock('../../../pages/Watchlists', () => ({ default: () => null }))
// the Notebook widget's note list (its own hooks, fixture notes) and its editor (TipTap, not under test here)
vi.mock('../../../pages/journal-2-0/hooks/useJ2Notes', () => ({ default: () => ({ notes: data.notes, refresh: async () => {} }), useJ2Note: () => ({ note: null }) }))
vi.mock('../../../pages/journal-2-0/hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))
vi.mock('@tiptap/react', async (orig) => ({ ...(await orig()), useEditor: () => null, EditorContent: () => null }))
vi.mock('../../../hooks/useLivePrices', () => ({ default: () => ({ prices: {}, isLoading: false }) }))
const byKey = (key) => {
  const k = String(key || '')
  if (k.includes('/api/snapshot')) return data.snapshot
  if (k.startsWith('/api/calendar?week=')) return { days: Object.fromEntries(['2026-11-02', '2026-11-03', '2026-11-04'].map(d => [d, data.day])) }
  if (k.startsWith('/api/scatter/metrics')) return data.metrics
  if (k.startsWith('/api/scatter/universes')) return data.universes
  if (k.startsWith('/api/theme-performance')) return { themes: data.themes }
  if (k.startsWith('/api/breadth-monitor')) return { rows: [{ date: '2026-11-03', breadth_score: 50, up_4pct_today: 100 }] }
  if (k.includes('scanner') || k.includes('scan')) return { results: [{ sym: 'AAA' }, { sym: 'BBB' }], as_of: '2026-11-03T15:00:00Z' }
  return null
}
vi.mock('swr', async (orig) => ({ ...(await orig()), default: (key) => ({ data: byKey(key), isLoading: false, mutate: () => {} }) }))
vi.mock('../../../hooks/useMobileSWR', () => ({ default: (key) => ({ data: byKey(key), error: null, isLoading: false, isValidating: false, mutate: () => {} }) }))

const C = {
  volumescan: (await import('../../../pages/charts/widgets/VolumeScanWidget')).default,
  breadth: (await import('../../../pages/charts/widgets/BreadthWidget')).default,
  scatter: (await import('../../../pages/charts/widgets/ScatterWidget')).default,
  indexes: (await import('../../../pages/charts/widgets/IndexesWidget')).default,
  calendar: (await import('../../../pages/charts/widgets/CalendarWidget')).default,
  themes: (await import('../../../pages/charts/widgets/ThemesWidget')).default,
  scanner: (await import('../../../pages/charts/widgets/ScannerWidget')).default,
  notebook: (await import('../../../pages/charts/widgets/NotebookWidget')).default,
}
await outcomeSuite()

function Live({ board }) {
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 10); return () => clearInterval(t) }, [])
  const onOpts = (id) => (opts) => { board.state.widgets = board.state.widgets.map(x => (x.id === id ? { ...x, opts } : x)) }
  const ws = { groupSyms: { N: null }, setGroupSym: () => {}, groupTfs: {}, activeWatchlistRef: { current: null } }
  return (
    <MemoryRouter>
      <AuthContext.Provider value={{ user: { id: 1, role: 'admin' } }}>
        <WorkspaceContext.Provider value={ws}>
          {board.state.widgets.filter(w => C[w.type]).map(w => {
            const W = C[w.type]
            return <div key={w.id} data-testid={`w-${w.id}`}><WidgetDoorContext.Provider value={w.id}><W color={w.color} opts={w.opts} onOptsChange={onOpts(w.id)} /></WidgetDoorContext.Provider></div>
          })}
        </WorkspaceContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>
  )
}
const wgt = (id, type, opts = {}) => ({ id, type, x: 12, y: 0, w: 12, h: 20, color: 'N', opts })
function board(widgets) {
  data.sent = []
  data.notes = [{ id: 'n1', title: 'NVDA held the 21', folderId: null, createdAt: '2026-11-03T13:00:00Z' }, { id: 'n2', title: 'AMD breakout plan', folderId: null, createdAt: '2026-11-02T13:00:00Z' }]
  const m = open([chart('c1', 0, 0, 12, 20), ...widgets], { 'N:c1': 'NVDA' })
  render(<Live board={m.board} />)
  return m
}
const idOf = (c, type) => must((c.board?.[0]?.widgets || []).find(w => w.type === type), `a ${type} widget`).id
const setOption = (type, key, value) => (c) => [{ action: 'widget.setOption', target: must(c.board?.[0]?.ref, 'board'), args: { widget: idOf(c, type), key, value } }]
const send = (type, where) => (c) => [{ action: 'widget.sendToJournal', target: must(c.board?.[0]?.ref, 'board'), args: { widget: idOf(c, type), where } }]
const optsOf = (m, id) => m.board.state.widgets.find(w => w.id === id).opts
const within = (id) => document.querySelector(`[data-testid="w-${id}"]`)

afterEach(() => { afterEachOutcome(); cleanup() })

describe('door rows over the real widgets', () => {
  it('C3-121 "make the volume surge watch my Core list": the widget scans that list; its scope pill reads it; Undo goes back', async () => {
    const m = board([wgt('vs', 'volumescan')])
    await waitFor(() => expect(mountedWidgetDoor('vs')?.options?.().list.map(o => o.label)).toEqual(['Top 1,000', 'Semis', 'Core']))
    const out = await m.say('make the volume surge watch my Core list', setOption('volumescan', 'list', 'Core'))
    await waitFor(() => expect(optsOf(m, 'vs').volActive).toBe('l2'))
    expect(within('vs').textContent).toMatch(/Core/)
    expect(out).toMatch(/list is now Core/)
    await m.say('undo')
    await waitFor(() => expect(optsOf(m, 'vs').volActive ?? null).toBe(null))
  }, 60000)
  it('C3-158 "take the up 4% reading off the breadth widget": the reading is hidden by the widget\'s own list; Undo shows it again', async () => {
    const m = board([wgt('br', 'breadth')])
    const readings = await waitFor(() => must(mountedWidgetDoor('br')?.options?.().reading, 'readings'))
    const up4 = must(readings.find(r => r.value === 'up_4pct_today'), 'the up 4% reading')
    await m.say('take the up 4% reading off the breadth widget', setOption('breadth', 'reading', `-${up4.label}`))
    await waitFor(() => expect(optsOf(m, 'br').hiddenMetrics).toEqual(['up_4pct_today']))
    await m.say('undo')
    await waitFor(() => expect(optsOf(m, 'br').hiddenMetrics ?? []).toEqual([]))
  }, 60000)
  it('C3-192 / C3-193: add the Nasdaq 100 to the Market Map, plot it by day change on Y and size by market cap; remove it again', async () => {
    const m = board([wgt('mm', 'scatter')])
    await waitFor(() => expect(mountedWidgetDoor('mm')?.options?.().universes.map(o => o.label)).toContain('Nasdaq 100'))
    await m.say('add the nasdaq 100 to the market map universes', setOption('scatter', 'universes', '+Nasdaq 100'))
    await waitFor(() => expect(mountedWidgetDoor('mm').read().universes).toEqual(['S&P 500', 'Nasdaq 100']))
    await m.say('market map: put day change on the y axis', setOption('scatter', 'yKey', 'Day Change'))
    await waitFor(() => expect(optsOf(m, 'mm').yKey).toBe('chg_today'))
    await m.say('size the market map dots by market cap', setOption('scatter', 'sizeKey', 'Market Cap'))
    await waitFor(() => expect(optsOf(m, 'mm').sizeKey).toBe('market_cap'))
    await m.say('remove the nasdaq 100 from the market map', setOption('scatter', 'universes', '-Nasdaq 100'))
    await waitFor(() => expect(mountedWidgetDoor('mm').read().universes).toEqual(['S&P 500']))
  }, 60000)
  it('NEGATIVE: an axis the map does not offer is refused with its own list; nothing changes', async () => {
    const m = board([wgt('mm', 'scatter')])
    await waitFor(() => expect(mountedWidgetDoor('mm')?.options?.().xKey.length).toBe(3))
    expect(await m.say('market map x axis by short interest', setOption('scatter', 'xKey', 'Short Interest'))).toMatch(/xKey” can be Relative Volume, Day Change, Market Cap/)
    expect(optsOf(m, 'mm').xKey).toBeUndefined()
  }, 60000)
})

describe('Send to Journal over the real widgets\' own capture doors (C3-184, C3-156, C3-163, C3-177)', () => {
  it.each([
    ['C3-184', 'indexes', 'send the indexes to my journal', 'note', 'indexes'],
    ['C3-156', 'calendar', 'send the terminal to a new journal note', 'newNote', 'calendar'],
    ['C3-163', 'breadth', 'send the breadth widget to my journal inbox', 'inbox', 'breadth'],
    ['C3-177', 'themes', 'send the theme tracker to my journal', 'note', 'themes'],
  ])('%s "%s": shown first; on Apply the Journal receives exactly that widget\'s capture, where it was asked', async (_row, type, text, where, kind) => {
    const m = board([wgt('x', type)])
    await waitFor(() => expect(mountedWidgetDoor('x')?.capture?.()).toBeTruthy())
    const want = mountedWidgetDoor('x').capture()
    await m.say(text, send(type, where))
    expect(proposalsNow()).toHaveLength(1)
    expect(data.sent).toEqual([])                       // nothing reaches the Journal before Apply
    await m.apply()
    await waitFor(() => expect(data.sent).toHaveLength(1))
    expect(data.sent[0]).toMatchObject({ kind, opts: { target: where } })
    expect(data.sent[0].capture).toEqual(want.capture)
  }, 60000)
  it('NEGATIVE: Dismiss sends nothing', async () => {
    const m = board([wgt('x', 'indexes')])
    await waitFor(() => expect(mountedWidgetDoor('x')?.capture?.()).toBeTruthy())
    await m.say('send the indexes to my journal', send('indexes', 'note'))
    await m.dismiss()
    expect(data.sent).toEqual([])
  }, 60000)
})

describe('the Scanner widget (C3-110 read its conditions, C3-120 send it to the Journal)', () => {
  const SCAN = { scanKey: 'highest-volume-1y', scanName: 'Highest Volume In 1 Year' }
  it('C3-110 "what are the conditions on my scanner": the widget’s own criteria, read through its door; nothing changes', async () => {
    const m = board([wgt('sc', 'scanner', SCAN)])
    await waitFor(() => expect(mountedWidgetDoor('sc')?.about?.()).toMatch(/criteria: Highest Daily Volume In The Last 1-Year/))
    const before = JSON.stringify(m.board.state.widgets)
    const out = await m.say('what are the conditions on my scanner', (c) => [{ action: 'widget.readOptions', target: must(c.board?.[0]?.ref, 'board'), args: { widget: idOf(c, 'scanner') } }])
    expect(out).toMatch(/criteria: Highest Daily Volume In The Last 1-Year; US Common Stock/)
    expect(JSON.stringify(m.board.state.widgets)).toBe(before)
  }, 60000)
  it('C3-120 "send this scan to my journal": shown first; on Apply the Journal receives the scan’s own capture', async () => {
    const m = board([wgt('sc', 'scanner', SCAN)])
    // (after mounting: the panel harness clears storage) the capture release flag, as a member with captures has it
    try { localStorage.setItem('uct.nb.capture.enabled', '1') } catch { /* */ }
    await waitFor(() => expect(mountedWidgetDoor('sc')?.capture?.()).toBeTruthy())
    const want = mountedWidgetDoor('sc').capture()
    await m.say('send this scan to my journal', send('scanner', 'note'))
    expect(proposalsNow()).toHaveLength(1)
    expect(data.sent).toEqual([])
    await m.apply()
    await waitFor(() => expect(data.sent).toHaveLength(1))
    expect(data.sent[0]).toMatchObject({ kind: 'scanner' })
    expect(data.sent[0].capture).toEqual(want.capture)
  }, 60000)
})

describe('the Notebook widget (C3-201 open a note by its name)', () => {
  it.each([['open my NVDA note in the notebook', 'NVDA', 'n1'], ['show the AMD breakout plan note', 'AMD breakout', 'n2']])('"%s": the widget opens that note (its own row’s openNote); Undo goes back to the list', async (text, name, id) => {
    const m = board([wgt('nb', 'notebook')])
    await waitFor(() => expect(mountedWidgetDoor('nb')?.options?.().note.length).toBe(2))
    const out = await m.say(text, setOption('notebook', 'note', name))
    await waitFor(() => expect(optsOf(m, 'nb').noteId, out).toBe(id))
    await m.say('undo')
    await waitFor(() => expect(optsOf(m, 'nb').noteId ?? null).toBe(null))
  }, 60000)
  it('NEGATIVE: a name that fits two notes, or none, is refused with the widget’s own list; nothing opens', async () => {
    const m = board([wgt('nb', 'notebook')])
    await waitFor(() => expect(mountedWidgetDoor('nb')?.options?.().note.length).toBe(2))
    expect(await m.say('open my TSLA note', setOption('notebook', 'note', 'TSLA'))).toMatch(/can be NVDA held the 21, AMD breakout plan/)
    expect(optsOf(m, 'nb').noteId ?? null).toBe(null)
  }, 60000)
})

// round 6 (C3-202): create a note through the Notebook widget's own New control (its door → newNote: POST /api/j2/notes, then
// it opens the new note). Proposed first; nothing is created before Apply; read back from the widget's own list. The server is
// a fixture that mints the note. Held-out phrasings from agentExecHeldOut6.
import { NOTE_CREATE_HELD_OUT } from '../../agentExecHeldOut6.test.js'
describe('the Notebook widget: create a note through its own New control (C3-202)', () => {
  it.each(NOTE_CREATE_HELD_OUT.map(c => [c.text]))('"%s": shown first; on Apply the widget creates a blank note and opens it', async (text) => {
    const m = board([wgt('nb', 'notebook')])
    const base = globalThis.fetch
    const posts = []
    globalThis.fetch = async (url, init = {}) => {
      if (String(url) === '/api/j2/notes' && (init.method || 'GET') === 'POST') {
        posts.push(url); data.notes = [...data.notes, { id: 'n3', title: '', folderId: null, createdAt: '2026-11-04T13:00:00Z' }]
        return new Response(JSON.stringify({ note: { id: 'n3' } }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return base(url, init)
    }
    await waitFor(() => expect(mountedWidgetDoor('nb')?.read?.().notes.length).toBe(2))
    await m.say(text, setOption('notebook', 'notes', 'create'))
    expect(proposalsNow()).toHaveLength(1)
    expect(posts).toEqual([])
    await m.apply()
    await waitFor(() => expect(posts).toHaveLength(1))
    await waitFor(() => expect(optsOf(m, 'nb').noteId).toBe('n3'))
    expect(mountedWidgetDoor('nb').read().notes.map(x => x.name)).toEqual(['NVDA held the 21', 'AMD breakout plan', 'Untitled note'])
  }, 60000)
  // ⛔ AUDIT S1-C: a create offers no Undo, so "undo" never times out on it (the note stays); S1-A: the door takes ONE operation,
  // never a list to reconcile
  it('AUDIT S1-C/S1-A: after a create, "undo" never times out and the note stays; the door ignores a list handed to it', async () => {
    const m = board([wgt('nb', 'notebook')])
    const base = globalThis.fetch
    globalThis.fetch = async (url, init = {}) => {
      if (String(url) === '/api/j2/notes' && (init.method || 'GET') === 'POST') {
        data.notes = [...data.notes, { id: 'n3', title: '', folderId: null, createdAt: '2026-11-04T13:00:00Z' }]
        return new Response(JSON.stringify({ note: { id: 'n3' } }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return base(url, init)
    }
    await waitFor(() => expect(mountedWidgetDoor('nb')?.read?.().notes.length).toBe(2))
    await m.say('make a new note in the notebook', setOption('notebook', 'notes', 'create'))
    await m.apply()
    await waitFor(() => expect(optsOf(m, 'nb').noteId).toBe('n3'))
    const out = await m.say('undo')
    expect(out).not.toMatch(/did not change/)
    expect(data.notes.length).toBe(3)
    const posts0 = data.notes.length
    mountedWidgetDoor('nb').write('notes', [{ id: null, name: 'x' }])
    await new Promise(r => setTimeout(r, 30))
    expect(data.notes.length).toBe(posts0)
  }, 60000)
  it('NEGATIVE: Dismiss creates nothing', async () => {
    const m = board([wgt('nb', 'notebook')])
    await waitFor(() => expect(mountedWidgetDoor('nb')?.read?.().notes.length).toBe(2))
    await m.say('make a new note in the notebook', setOption('notebook', 'notes', 'create'))
    await m.dismiss()
    expect(data.notes.length).toBe(2)
  }, 60000)
})
