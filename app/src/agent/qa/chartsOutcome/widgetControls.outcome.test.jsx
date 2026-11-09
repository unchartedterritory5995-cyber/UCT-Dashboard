// CHARTS OUTCOME — execution family W (one control of one widget, widget.setOption) over the REAL widgets: the real
// IndexesWidget, CalendarWidget and NewHighsLowsWidget mounted on the same page as the real Agent panel, each in its
// WidgetDoorContext slot exactly as WidgetHost mounts it, so a control the widget keeps in its own state (the Terminal's day,
// its TBD section) or whose choices are the widget's own (an index, a universe) is written and read through the widget's
// REAL door (pages/charts/widgetDoors.js). The widget's onOptsChange writes the board, as ChartsWorkspace.handleOptsChange.
// Assertions read what the WIDGET DRAWS (its tiles, its date, its TBD rows, its universe tabs) and the board, never a
// registry entry; a receipt only alongside state.
//
// ⛔ THE MODEL IS SCRIPTED (outcomeHarness: each plan is built from the REQUEST the panel sent; a request that does not carry
// the widget id fails the case, and a missing action is asked for with need_groups as a real model would). It does NOT
// prove a real model picks the plan. Data below is invented fixture data. Evidence: LOCAL native Windows Node, jsdom,
// BROWSER-MOCK-MODEL / SIMULATED.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { open, outcomeSuite, afterEachOutcome, chart, must, waitFor } from './outcomeHarness'
import { WidgetDoorContext, mountedWidgetDoor } from '../../../pages/charts/widgetDoors'
import { AuthContext } from '../../../context/AuthContext'

vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
vi.mock('../../../components/StockChart', () => ({ default: () => null }))
vi.mock('../../../components/CompanyLogo', () => ({ default: () => null }))
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPref: () => {}, loading: false }), parsePref: (raw, fallback) => fallback }))
vi.mock('../../../hooks/usePlacedTheme', () => ({ default: () => null }))
vi.mock('../../../hooks/useTickerMeta', () => ({ default: () => ({ name: '' }) }))
const data = vi.hoisted(() => ({
  // invented readings, never real values
  snapshot: { etfs: { SPY: { price: '1.00', chg: '+0.10%' }, QQQ: { price: '2.00', chg: '-0.20%' }, DIA: { price: '3.00', chg: '+0.30%' }, IWM: { price: '4.00', chg: '+0.40%' }, VIX: { price: '5.00', chg: '-0.50%' } }, futures: { BTC: { price: '6.00', chg: '+0.60%' } } },
  day: { bmo: [{ sym: 'AAA' }], amc: [{ sym: 'BBB' }], tbd: [{ sym: 'TBDX' }, { sym: 'TBDY' }], econ: [], fed: [] },
}))
const byKey = (key) => {
  const k = String(key || '')
  if (k.includes('/api/snapshot')) return data.snapshot
  if (k.startsWith('/api/calendar?week=')) {
    const days = {}
    for (const d of ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']) days[d] = data.day
    return { days }
  }
  if (k.startsWith('/api/nhnl/live')) return { highs: [], lows: [], groups: [] }
  return null
}
vi.mock('swr', async (orig) => ({ ...(await orig()), default: (key) => ({ data: byKey(key), isLoading: false, mutate: () => {} }) }))
vi.mock('../../../hooks/useMobileSWR', () => ({ default: (key) => ({ data: byKey(key), error: null, isLoading: false, mutate: () => {} }) }))

const { default: IndexesWidget } = await import('../../../pages/charts/widgets/IndexesWidget')
const { default: CalendarWidget } = await import('../../../pages/charts/widgets/CalendarWidget')
const { default: NewHighsLowsWidget } = await import('../../../pages/charts/widgets/NewHighsLowsWidget')
await outcomeSuite()
const COMPONENT = { indexes: IndexesWidget, calendar: CalendarWidget, nhnl: NewHighsLowsWidget }

/** The board's real widgets, re-rendered from the board's own state (the workspace re-renders a widget on its opts). */
function Live({ board }) {
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 10); return () => clearInterval(t) }, [])
  const onOpts = (id) => (opts) => { board.state.widgets = board.state.widgets.map(x => (x.id === id ? { ...x, opts } : x)) }
  return (
    <MemoryRouter>
      <AuthContext.Provider value={{ user: { id: 1, role: 'admin' } }}>
        {board.state.widgets.filter(w => COMPONENT[w.type]).map(w => {
          const C = COMPONENT[w.type]
          return <div key={w.id} data-testid={`w-${w.id}`}><WidgetDoorContext.Provider value={w.id}><C color={w.color} opts={w.opts} onOptsChange={onOpts(w.id)} journalDoor={false} /></WidgetDoorContext.Provider></div>
        })}
      </AuthContext.Provider>
    </MemoryRouter>
  )
}
const wgt = (id, type, x, opts = {}) => ({ id, type, x, y: 0, w: 4, h: 20, color: 'N', opts })
function board(widgets) {
  const m = open([chart('c1', 0, 0, 12, 20), ...widgets], { 'N:c1': 'NVDA' })
  render(<Live board={m.board} />)
  return m
}
const idOf = (c, type) => must((c.board?.[0]?.widgets || []).find(w => w.type === type), `a ${type} widget`).id
const setOption = (type, key, value) => (c) => [{ action: 'widget.setOption', target: must(c.board?.[0]?.ref, 'board'), args: { widget: idOf(c, type), key, value } }]
const within = (id) => document.querySelector(`[data-testid="w-${id}"]`)
const tiles = () => [...within('ix').querySelectorAll('[aria-label^="Hide "]')].map(b => b.getAttribute('aria-label').slice(5))
const tabs = () => [...within('nh').querySelectorAll('[title]')].filter(e => e.getAttribute('role') === 'button' && e.getAttribute('tabindex') === '0').map(e => e.getAttribute('title'))

afterEach(() => { afterEachOutcome(); cleanup() })

describe('Indexes (C3-183): hide or restore an index — the tile goes, the board keeps it, Undo brings it back', () => {
  it('"remove the dow from the indexes": DIA\'s tile is gone, the rest stay; undo restores it', async () => {
    const m = board([wgt('ix', 'indexes', 12)])
    await waitFor(() => expect(tiles()).toEqual(['SPY', 'QQQ', 'DIA', 'IWM', 'BTC', 'VIX']))
    const out = await m.say('remove the dow from the indexes', setOption('indexes', 'index', '-DIA'))
    await waitFor(() => expect(tiles()).toEqual(['SPY', 'QQQ', 'IWM', 'BTC', 'VIX']))
    expect(m.board.state.widgets.find(w => w.id === 'ix').opts.hiddenSymbols).toEqual(['DIA'])
    expect(out).toMatch(/index is now DIA/)
    await m.say('undo')
    await waitFor(() => expect(tiles()).toEqual(['SPY', 'QQQ', 'DIA', 'IWM', 'BTC', 'VIX']))
  }, 40000)
  it('"put the dow back on the indexes" (+, by the tile\'s own name): the tile returns', async () => {
    const m = board([wgt('ix', 'indexes', 12, { hiddenSymbols: ['DIA', 'VIX'] })])
    await waitFor(() => expect(tiles()).toEqual(['SPY', 'QQQ', 'IWM', 'BTC']))
    await m.say('put the dow back on the indexes', setOption('indexes', 'index', '+Dow 30 ETF'))
    await waitFor(() => expect(tiles()).toEqual(['SPY', 'QQQ', 'DIA', 'IWM', 'BTC']))
  }, 40000)
  it('NEGATIVE: an index the widget does not have is refused with its own list; no tile moves', async () => {
    const m = board([wgt('ix', 'indexes', 12)])
    await waitFor(() => expect(tiles().length).toBe(6))
    expect(await m.say('hide the nikkei on the indexes', setOption('indexes', 'index', '-NIKKEI'))).toMatch(/isn't one of index: S&P 500 ETF/)
    expect(tiles().length).toBe(6)
  }, 40000)
})

describe('UCT Terminal (C3-148, C3-152): the day shown and the TBD section, through the widget\'s own door', () => {
  it('"show tomorrow on the terminal": the widget shows the next day; Undo goes back', async () => {
    const m = board([wgt('ca', 'calendar', 12)])
    const day0 = await waitFor(() => must(mountedWidgetDoor('ca')?.read?.().day, 'door'))
    const out = await m.say('show tomorrow on the terminal', setOption('calendar', 'day', 'tomorrow'))
    await waitFor(() => expect(mountedWidgetDoor('ca').read().day).toBe('2026-11-04'))
    expect(day0).not.toBe('2026-11-04')
    expect(within('ca').textContent).toMatch(/Wed/)
    expect(out).toMatch(/day is now 2026-11-04/)
    await m.say('undo')
    await waitFor(() => expect(mountedWidgetDoor('ca').read().day).toBe(day0))
  }, 40000)
  it('"expand the time tbd list on the terminal": the TBD rows are drawn; collapse hides them again', async () => {
    const m = board([wgt('ca', 'calendar', 12)])
    await waitFor(() => expect(within('ca').textContent).toMatch(/Time TBD/))
    expect(within('ca').textContent).not.toMatch(/TBDX/)
    await m.say('expand the time tbd list on the terminal', setOption('calendar', 'tbdOpen', true))
    await waitFor(() => expect(within('ca').textContent).toMatch(/TBDX/))
    await m.say('collapse the tbd section on the terminal', setOption('calendar', 'tbdOpen', false))
    await waitFor(() => expect(within('ca').textContent).not.toMatch(/TBDX/))
  }, 40000)
})

describe('New Highs / Lows (C3-187, C3-188): add or remove a universe, switch the tab — the widget\'s own tabs', () => {
  it('"add the S&P 500 to new highs lows", then "switch new highs lows to it", then remove it; each read off the tabs', async () => {
    const m = board([wgt('nh', 'nhnl', 12)])
    await waitFor(() => expect(tabs()).toEqual(['UCT Universe']))
    await m.say('add the S&P 500 universe to new highs lows', setOption('nhnl', 'universes', '+S&P 500'))
    await waitFor(() => expect(tabs()).toEqual(['UCT Universe', 'S&P 500']))
    const nh = () => m.board.state.widgets.find(w => w.id === 'nh').opts
    // the product's own add makes the new universe active; switching back to the first tab is the tab control
    await m.say('switch new highs lows to the UCT universe tab', setOption('nhnl', 'universe', 'UCT Universe'))
    await waitFor(() => expect(nh().activeUniverse).toBe(0))
    await m.say('remove the S&P 500 from new highs lows', setOption('nhnl', 'universes', '-S&P 500'))
    await waitFor(() => expect(tabs()).toEqual(['UCT Universe']))
  }, 60000)
  it('NEGATIVE: the last universe stays (the widget keeps at least one), nothing changes', async () => {
    const m = board([wgt('nh', 'nhnl', 12)])
    await waitFor(() => expect(tabs()).toEqual(['UCT Universe']))
    expect(await m.say('remove the uct universe from new highs lows', setOption('nhnl', 'universes', '-UCT Universe'))).toMatch(/keeps at least one/)
    expect(tabs()).toEqual(['UCT Universe'])
  }, 40000)
})
