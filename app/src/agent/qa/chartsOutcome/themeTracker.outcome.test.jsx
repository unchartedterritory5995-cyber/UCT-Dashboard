// CHARTS OUTCOME — execution family W on the Theme Tracker (C3-169 period, C3-170 sort direction, C3-171 today basis,
// C3-172 open a theme, C3-174 pick a theme set) over the REAL ThemesWidget + ThemeTrackerPage, in its WidgetDoorContext
// slot, beside the real Agent panel. The period, the sort and the open theme are the tracker's OWN state (its door writes
// them with the same setters its tab buttons and rows use); the today basis is in `opts`. Assertions read the ORDER the
// tracker draws its themes in, its door's read-back and the board — never a registry entry.
//
// ⛔ THE MODEL IS SCRIPTED (outcomeHarness). Theme data is invented fixture data. Evidence: LOCAL native Windows Node,
// jsdom, BROWSER-MOCK-MODEL / SIMULATED.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { open, outcomeSuite, afterEachOutcome, chart, must, waitFor, proposalsNow } from './outcomeHarness'
import { SET_HELD_OUT } from '../../agentExecHeldOut3.test.js'
import { WidgetDoorContext, mountedWidgetDoor } from '../../../pages/charts/widgetDoors'
import { WorkspaceContext } from '../../../pages/charts/WorkspaceContext'
import { AuthContext } from '../../../context/AuthContext'

vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
vi.mock('../../../components/StockChart', () => ({ default: () => null }))
vi.mock('../../../components/chart/pane/ChartPane', () => ({ default: () => null }))
vi.mock('../../../components/CompanyLogo', () => ({ default: () => null }))
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPref: () => {}, loading: false }), parsePref: (raw, fallback) => fallback }))
vi.mock('../../../hooks/usePlacedTheme', () => ({ default: () => null }))
vi.mock('../../../hooks/useThemeIndexBars', () => ({ default: () => ({}) }))
vi.mock('../../../hooks/useFlagged', () => ({ useFlagged: () => ({ isFlagged: () => false, toggle: () => {}, flagged: [] }) }))
vi.mock('../../../hooks/useTickerTags', () => ({ default: () => ({ tags: {}, setTag: () => {}, removeTag: () => {}, getTag: () => null, shared: [], isColorShared: () => false, toggleShareColor: () => {}, communityTags: [] }) }))
vi.mock('../../../hooks/useNeighborWarm', () => ({ useNeighborWarm: () => {} }))
vi.mock('../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, isLoading: false, isStreaming: false, staleSymbols: new Set() }) }))
vi.mock('../../../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../../../utils/prefetchBars', () => ({
  prefetchBar: () => {}, prefetchBars: () => {}, prefetchBarsToIDB: () => {}, prefetchAllTimeframes: () => {},
  prefetchBarOnIntent: () => {}, prefetchListAllTimeframes: () => {}, warmMemFromIDB: () => {}, prewarmVisibleList: () => {},
}))
vi.mock('../../../pages/charts/useListSubscribeEnabled', () => ({ default: () => false }))
const data = vi.hoisted(() => {
  const th = (ticker, name, r) => ({ ticker, name, group_return: r, holdings: [{ sym: `${ticker}1`, returns: r }] })
  return {
    sets: [{ id: 'set1', name: 'Mine' }],
    // invented returns; each period ranks the three themes differently, so an order tells which period is shown
    themes: [th('SEMI', 'Semis', { '1d': 3, open: 1, '1w': 1, '1m': 2, '3m': 1, '1y': 1, ytd: 1 }),
      th('SOFT', 'Software', { '1d': 2, open: 3, '1w': 3, '1m': 1, '3m': 2, '1y': 2, ytd: 2 }),
      th('BIO', 'Biotech', { '1d': 1, open: 2, '1w': 2, '1m': 3, '3m': 3, '1y': 3, ytd: 3 })],
  }
})
vi.mock('../../../hooks/useThemeSets', () => ({
  useThemeSets: () => ({ enabled: true, sets: data.sets, createSet: async () => null,
    // the hook's own writers, over the fixture list (the server's answer): what the set menu's Rename and Delete call
    deleteSet: async (id) => { data.sets = data.sets.filter(x => x.id !== id) },
    renameSet: async (id, name) => { data.sets = data.sets.map(x => (x.id === id ? { ...x, name } : x)) }, refreshSets: () => {} }),
  getSetDef: async () => null, putSetDef: async () => {},
}))
vi.mock('../../../hooks/useMobileSWR', () => ({
  default: (key) => ({ data: String(key || '').startsWith('/api/theme-performance') ? { themes: data.themes } : null, error: null, isLoading: false, mutate: () => {} }),
}))

const { default: ThemesWidget } = await import('../../../pages/charts/widgets/ThemesWidget')
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
          {board.state.widgets.filter(w => w.type === 'themes').map(w => (
            <div key={w.id} data-testid={`w-${w.id}`}><WidgetDoorContext.Provider value={w.id}><ThemesWidget color={w.color} opts={w.opts} onOptsChange={onOpts(w.id)} /></WidgetDoorContext.Provider></div>
          ))}
        </WorkspaceContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>
  )
}
function board(opts = {}) {
  const m = open([chart('c1', 0, 0, 12, 20), { id: 'th', type: 'themes', x: 12, y: 0, w: 12, h: 20, color: 'N', opts }], { 'N:c1': 'NVDA' })
  render(<Live board={m.board} />)
  return m
}
const setOption = (key, value) => (c) => [{ action: 'widget.setOption', target: must(c.board?.[0]?.ref, 'board'), args: { widget: must((c.board[0].widgets || []).find(w => w.type === 'themes'), 'themes widget').id, key, value } }]
/** The themes in the order the tracker DRAWS them. */
const order = () => {
  const text = document.querySelector('[data-testid="w-th"]').textContent
  return ['Semis', 'Software', 'Biotech'].map(n => [n, text.indexOf(n)]).filter(([, i]) => i >= 0).sort((a, b) => a[1] - b[1]).map(([n]) => n)
}
const door = () => mountedWidgetDoor('th')?.read?.() || null

afterEach(() => { afterEachOutcome(); cleanup() })

describe('Theme Tracker through its own door: what it ranks by is what it draws', () => {
  it('C3-169 "show the theme tracker for the past month": the 1M tab ranks it; Undo goes back to Today', async () => {
    const m = board()
    await waitFor(() => expect(order()).toEqual(['Semis', 'Software', 'Biotech']))
    const out = await m.say('show the theme tracker for the past month', setOption('period', '1m'))
    await waitFor(() => expect(order()).toEqual(['Biotech', 'Semis', 'Software']))
    expect(door().period).toBe('1m')
    expect(out).toMatch(/period is now 1m/)
    await m.say('undo')
    await waitFor(() => expect(order()).toEqual(['Semis', 'Software', 'Biotech']))
  }, 60000)
  it('C3-170 "sort the theme tracker ascending": the worst first', async () => {
    const m = board()
    await waitFor(() => expect(order()).toEqual(['Semis', 'Software', 'Biotech']))
    await m.say('sort the theme tracker ascending', setOption('sortDir', 'asc'))
    await waitFor(() => expect(order()).toEqual(['Biotech', 'Software', 'Semis']))
    expect(door().sortDir).toBe('asc')
  }, 60000)
  it('C3-171 "theme tracker from the open": Today ranks by the move since the open, and the board keeps it', async () => {
    const m = board()
    await waitFor(() => expect(order()).toEqual(['Semis', 'Software', 'Biotech']))
    await m.say('theme tracker from the open', setOption('todayBasis', 'open'))
    await waitFor(() => expect(order()).toEqual(['Software', 'Biotech', 'Semis']))
    expect(m.board.state.widgets.find(w => w.id === 'th').opts.todayBasis).toBe('open')
  }, 60000)
  it('C3-172 "open the software theme in the theme tracker": by its name; the door reads it open', async () => {
    const m = board()
    await waitFor(() => expect(order().length).toBe(3))
    await m.say('open the software theme in the theme tracker', setOption('openTheme', 'Software'))
    await waitFor(() => expect(door().openTheme).toBe('SOFT'))
    expect(document.querySelector('[data-testid="w-th"]').textContent).toMatch(/SOFT1/)
  }, 60000)
  it('C3-174 "switch the theme tracker to my Mine set": the set the tracker shows; NEGATIVE: a set that does not exist is refused with the real list', async () => {
    const m = board()
    await waitFor(() => expect(order().length).toBe(3))
    await m.say('switch the theme tracker to my Mine set', setOption('themeSet', 'Mine'))
    await waitFor(() => expect(door().themeSet).toBe('set1'))
    expect(await m.say('switch the theme tracker to my Growth set', setOption('themeSet', 'Growth'))).toMatch(/themeSet” can be Default, Mine — not “Growth”/)
    expect(door().themeSet).toBe('set1')
  }, 60000)
})

// round 3 (C3-174): rename or delete a theme set through the tracker's own set menu (its door → renameSet / deleteSet). The held-out
// phrasings (agentExecHeldOut3 SET_HELD_OUT) are said as written; the model is scripted.
describe('Theme Tracker theme sets: rename and delete, through the tracker’s own menu', () => {
  const setsNow = () => data.sets.map(x => x.name)
  const H = Object.fromEntries(SET_HELD_OUT.map(c => [c.op + c.name, c]))
  it.each([['rename', 'Growth'], ['rename', 'Leaders']])('%s the Mine set to %s (held-out phrasing): renamed in the set list; Undo renames it back', async (_op, name) => {
    data.sets = [{ id: 'set1', name: 'Mine' }, { id: 'set2', name: 'Core' }]
    const c = H[`rename${name}`]
    const m = board()
    await waitFor(() => expect(mountedWidgetDoor('th')?.read?.().themeSets.map(x => x.name)).toEqual(['Mine', 'Core']))
    const out = await m.say(c.text, setOption('themeSets', `rename:${c.item}=>${c.name}`))
    await waitFor(() => expect(setsNow()).toEqual([name, 'Core']))
    expect(out).toMatch(new RegExp(`renamed the theme set “Mine” to “${name}”`))
    await m.say('undo')
    await waitFor(() => expect(setsNow()).toEqual(['Mine', 'Core']))
  }, 60000)
  it('delete the Mine set (held-out phrasing): shown first; nothing deleted before Apply; on Apply it is gone', async () => {
    data.sets = [{ id: 'set1', name: 'Mine' }, { id: 'set2', name: 'Core' }]
    const c = SET_HELD_OUT.find(x => x.op === 'delete')
    const m = board()
    await waitFor(() => expect(mountedWidgetDoor('th')?.read?.().themeSets.length).toBe(2))
    await m.say(c.text, setOption('themeSets', `delete:${c.item}`))
    expect(proposalsNow()).toHaveLength(1)
    expect(setsNow()).toEqual(['Mine', 'Core'])
    await m.apply()
    await waitFor(() => expect(setsNow()).toEqual(['Core']))
  }, 60000)
  it('NEGATIVE: a set that does not exist, or a new name already taken, is refused with the real list; nothing changes', async () => {
    data.sets = [{ id: 'set1', name: 'Mine' }, { id: 'set2', name: 'Core' }]
    const m = board()
    await waitFor(() => expect(mountedWidgetDoor('th')?.read?.().themeSets.length).toBe(2))
    expect(await m.say('rename my Growth set to X', setOption('themeSets', 'rename:Growth=>X'))).toMatch(/no “Growth” among your theme sets \(Mine, Core\)/)
    expect(await m.say('rename Mine to Core', setOption('themeSets', 'rename:Mine=>Core'))).toMatch(/already have a theme set named “Core”/)
    expect(setsNow()).toEqual(['Mine', 'Core'])
  }, 60000)
})

// ⛔ AUDIT S1-A / S1-B / S1-C (ship-1 CHANGES REQUIRED): ONE operation on the member's sets, never a whole-list reconcile; a set
// made between the plan and the commit survives a delete and a rename; the card and the receipt name the set the words RESOLVED
// to; a delete offers no Undo (and "undo" never times out on it).
describe('AUDIT S1: theme set operations are one operation each, and name what they resolved to', () => {
  const setsNow = () => data.sets.map(x => x.name)
  it('S1-A a set created while a delete card is open survives the Apply (the plan is stale; nothing of the new set is touched)', async () => {
    data.sets = [{ id: 'set1', name: 'Old' }, { id: 'set2', name: 'Core' }]
    const m = board()
    await waitFor(() => expect(mountedWidgetDoor('th')?.read?.().themeSets.length).toBe(2))
    await m.say('delete my Old theme set', setOption('themeSets', 'delete:Old'))
    expect(proposalsNow()).toHaveLength(1)
    data.sets = [...data.sets, { id: 'set3', name: 'Growth' }]          // the member makes "Growth" while the card is open
    await waitFor(() => expect(mountedWidgetDoor('th')?.read?.().themeSets.map(x => x.name)).toContain('Growth'))
    await m.apply()
    await new Promise(r => setTimeout(r, 50))
    expect(setsNow()).toContain('Growth')
    expect(setsNow()).toContain('Core')
  }, 60000)
  it('S1-A a set created during the model call survives a rename: only the one set is renamed', async () => {
    data.sets = [{ id: 'set1', name: 'Old' }, { id: 'set2', name: 'Core' }]
    const m = board()
    await waitFor(() => expect(mountedWidgetDoor('th')?.read?.().themeSets.length).toBe(2))
    const plan = (c) => { data.sets = [...data.sets, { id: 'set3', name: 'Growth' }]; return setOption('themeSets', 'rename:Old=>Leaders')(c) }
    await m.say('rename my Old theme set to Leaders', plan)
    await new Promise(r => setTimeout(r, 50))
    expect(setsNow()).toContain('Growth')
    expect(setsNow()).toContain('Core')
  }, 60000)
  it('S1-A the door write is one operation: handed { op, id, name } it touches that set only; handed a whole list it does nothing', async () => {
    data.sets = [{ id: 'set1', name: 'Old' }, { id: 'set2', name: 'Core' }]
    board()
    await waitFor(() => expect(mountedWidgetDoor('th')?.read?.().themeSets.length).toBe(2))
    mountedWidgetDoor('th').write('themeSets', [{ id: 'set2', name: 'Core' }])            // the old whole-list form: ignored
    await new Promise(r => setTimeout(r, 30))
    expect(setsNow()).toEqual(['Old', 'Core'])
    mountedWidgetDoor('th').write('themeSets', { op: 'rename', id: 'set1', name: 'New' })
    await waitFor(() => expect(setsNow()).toEqual(['New', 'Core']))
  }, 60000)
  it('S1-B a fragment ("mine") resolves to "Mine growth": the card and the receipt name "Mine growth"', async () => {
    data.sets = [{ id: 'set1', name: 'Mine growth' }, { id: 'set2', name: 'Core' }]
    const m = board()
    await waitFor(() => expect(mountedWidgetDoor('th')?.read?.().themeSets.length).toBe(2))
    const card = await m.say('delete the mine set', setOption('themeSets', 'delete:mine'))
    expect(card).toMatch(/“Mine growth”/)
    expect(card).not.toMatch(/“mine”/)
    await m.apply()
    await waitFor(() => expect(setsNow()).toEqual(['Core']))
  }, 60000)
  it('S1-B a rename of a fragment ("leaders") names the set it resolved to in the receipt', async () => {
    data.sets = [{ id: 'set4', name: 'Leaders 2026' }, { id: 'set2', name: 'Core' }]
    const m2 = board()
    await waitFor(() => expect(mountedWidgetDoor('th')?.read?.().themeSets.map(x => x.name)).toContain('Leaders 2026'))
    const out = await m2.say('rename leaders to Winners', setOption('themeSets', 'rename:leaders=>Winners'))
    expect(out).toMatch(/renamed the theme set “Leaders 2026” to “Winners”/)
  }, 60000)
  it('S1-C a delete offers no Undo: "undo" afterwards never times out on it, and the set stays deleted', async () => {
    data.sets = [{ id: 'set1', name: 'Old' }, { id: 'set2', name: 'Core' }]
    const m = board()
    await waitFor(() => expect(mountedWidgetDoor('th')?.read?.().themeSets.length).toBe(2))
    await m.say('delete my Old theme set', setOption('themeSets', 'delete:Old'))
    await m.apply()
    await waitFor(() => expect(setsNow()).toEqual(['Core']))
    const out = await m.say('undo')
    expect(out).not.toMatch(/did not change/)
    expect(setsNow()).toEqual(['Core'])
  }, 60000)
})

// round 4 (pl-exec): a theme set named by its OWN name ("rename my Mine theme set", no widget named) reaches the item control on the
// FIRST model call: routing reads the tracker's own set names through its door (widgetNames itemNamedTypes) — no reroute.
import { ITEM_HELD_OUT } from '../../agentExecHeldOut4.test.js'
describe('a theme set named by its own name reaches the tracker’s control on the first call', () => {
  it.each(ITEM_HELD_OUT.map(c => [c.text]))('%s: one model call, carrying widget.setOption and the tracker’s sets', async (text) => {
    data.sets = [{ id: 'set1', name: 'Mine' }, { id: 'set2', name: 'Core' }]
    const m = board()
    await waitFor(() => expect(mountedWidgetDoor('th')?.read?.().themeSets.length).toBe(2))
    const op = /^delete/.test(text) ? 'delete:Mine' : 'rename:Mine=>Growth'
    await m.say(text, setOption('themeSets', op))
    const turns = m.p.st.calls.filter(c => c[1] === '/api/agent/turn').map(c => c[2])
    expect(turns.length).toBe(1)
    expect(turns[0].capabilities.map(x => x.name)).toContain('widget.setOption')
    expect(turns[0].context.widgetControls[0].controls.themes).toMatch(/themeSets\(rename:<name>=><new>\|delete:<name>; yours: Mine, Core\)/)
  }, 60000)
})
