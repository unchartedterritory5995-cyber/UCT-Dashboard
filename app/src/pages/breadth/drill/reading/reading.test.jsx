/* The drill window's reading strip + History drawer (owner pick B, 2026-11-19), and the
 * reading-only window. Synthetic readings only. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../../../../hooks/usePreferences', () => ({
  default: () => ({ prefs: {}, setPref: () => {} }),
}))
vi.mock('../BreadthDrillBoard', () => ({ default: () => <div data-testid="board"><button>board</button></div> }))
vi.mock('../../../charts/popout/PopoutWindow', () => ({ default: () => null }))
vi.mock('../../../charts/popout/PopoutShell', () => ({ default: ({ children }) => children }))
vi.mock('../../../charts/WidgetHost', () => ({ default: () => null }))

const readingState = { current: { reading: null, loading: false, error: null } }
const readingArgs = []
vi.mock('./useReading', () => ({
  default: (args) => { readingArgs.push(args); return readingState.current },
}))

import { readingKey, rankLine, historyModel, readingState as stateOf, fmtShare, ordinal } from './readingModel'
import RankLine from './RankLine'
import HistoryPanel from './HistoryPanel'
import BreadthDrillModal from '../BreadthDrillModal'
import BreadthReadingModal from '../BreadthReadingModal'
import { ScanHeader } from '../scan/ScanDeckParts'
import { GroupSwitch } from '../scan/ScanFilters'
import { GROUP_HUES } from '../scan/scanDeckModel'

const fwd = (m, h, n) => ({ median: m, higher: h, n })
function makeReading(over = {}) {
  return {
    ok: true, universe: 'uct', basis_universe: 'uct', metric: 'up_20pct_5d', date: '2026-11-09',
    in_history: true, value: 117, rank: { by: 'share', per: 'universe_count', signed: false },
    window: { start: '2008-01-02', end: '2026-11-18', sessions: 4751, years: 19 },
    percentile: 94.2, side: 'high', share: 6.1, level: 2, level_word: 'Strong', tone: 'bull', typical: false,
    beyond: { count: 287, last_date: '2025-04-22' },
    similar: { rule: 'band', band_pts: 2.5, min_n: 30, n: 236, small: false },
    forward: {
      basis: 'SPY daily close', horizons: [5, 20, 60],
      similar: { 5: fwd(0.9, 61, 236), 20: fwd(2.4, 68, 235), 60: fwd(4.7, 73, 230) },
      baseline: { 5: fwd(0.3, 57, 4700), 20: fwd(1.1, 62, 4690), 60: fwd(3.0, 66, 4650) },
    },
    closest: [
      { date: '2025-04-22', value: 119, percentile: 94.5, fwd20: 3.1 },
      { date: '2024-01-08', value: 116, percentile: 94.0, fwd20: 1.8 },
      { date: '2022-11-14', value: 118, percentile: 94.3, fwd20: -0.6 },
      { date: '2020-06-09', value: 121, percentile: 94.8, fwd20: 4.0 },
      { date: '2016-08-03', value: 115, percentile: 93.9, fwd20: 0.7 },
    ],
    context: { avg20: 61, streak: { days: 3, band: 10, side: 'high' } },
    series: { dates: ['2026-11-06', '2026-11-09'], values: [80, 117] },
    ...over,
  }
}
const TYPICAL = makeReading({ percentile: 52.4, share: 47.6, level: 0, level_word: null, tone: null, typical: true,
  context: { avg20: 60, streak: { days: 4, band: null, side: 'middle' } } })
const QUIET = makeReading({ percentile: 18, side: 'low', share: 18, level: 0, level_word: null, tone: null, typical: false })

beforeEach(() => { readingState.current = { reading: null, loading: false, error: null }; readingArgs.length = 0 })

describe('the model', () => {
  it('keys the SWR read by universe, metric and date, exactly', () => {
    expect(readingKey({ universe: 'uct', metric: 'up_20pct_5d', date: '2026-11-09' }))
      .toBe('/api/breadth-monitor/reading?metric=up_20pct_5d&date=2026-11-09')
    expect(readingKey({ universe: 'nasdaq', metric: 'vix', date: '2026-11-09' }))
      .toBe('/api/breadth-monitor/reading?metric=vix&date=2026-11-09&universe=nasdaq')
    expect(readingKey({ metric: 'up_4pct_today', date: '2026-11-19', value: 210, per: 2600 }))
      .toBe('/api/breadth-monitor/reading?metric=up_4pct_today&date=2026-11-19&value=210&per=2600')
    expect(readingKey({ metric: null, date: '2026-11-09' })).toBeNull()
  })
  it('names the three states', () => {
    expect(stateOf(makeReading())).toBe('notable')
    expect(stateOf(TYPICAL)).toBe('typical')
    expect(stateOf(QUIET)).toBe('quiet')
    expect(stateOf({ ok: false })).toBeNull()
  })
  it('a notable reading: "Top 6% since 2008 · Strong", toned, the last time it was this high', () => {
    const l = rankLine(makeReading())
    expect(l.text).toBe('Top 6% since 2008')
    expect(l.word).toBe('Strong')
    expect(l.tone).toBe('bull')
    expect(l.faint).toBe('Last this high: Apr 22, 2025 · seen 287 times in 19 years')
    expect(l.emphasis).toBe(true)
  })
  it('a typical reading is quiet: no tone, no level word, "Typical · 52nd percentile"', () => {
    const l = rankLine(TYPICAL)
    expect(l.text).toBe('Typical · 52nd percentile since 2008')
    expect(l.word).toBeNull()
    expect(l.tone).toBeNull()
    expect(l.emphasis).toBe(false)
  })
  it('formats shares and ordinals', () => {
    expect(fmtShare(0.4)).toBe('0.4%')
    expect(fmtShare(6.1)).toBe('6%')
    expect(ordinal(52)).toBe('52nd'); expect(ordinal(11)).toBe('11th'); expect(ordinal(3)).toBe('3rd')
  })
  it('context: the 20-day average and the streak in words', () => {
    const m = historyModel(makeReading(), (v) => String(Math.round(v)))
    expect(m.vsAvg).toEqual({ head: '+92%', detail: '(117 vs 61)' })
    expect(m.streak).toBe('3rd straight day in the top 10%')
  })
})

describe('the rank line', () => {
  it('reserves its two lines while loading (the band never moves)', () => {
    const { container } = render(<RankLine reading={null} loading />)
    expect(container.children).toHaveLength(2)
  })
  it('notable: toned word, History button at full strength', () => {
    const onHistory = vi.fn()
    render(<RankLine reading={makeReading()} onHistory={onHistory} />)
    expect(screen.getByText('Top 6% since 2008')).toBeTruthy()
    expect(screen.getByText('Strong').closest('[data-tone]').getAttribute('data-tone')).toBe('bull')
    const btn = screen.getByRole('button', { name: 'History of this reading' })
    expect(btn.hasAttribute('data-muted')).toBe(false)
    fireEvent.click(btn)
    expect(onHistory).toHaveBeenCalledOnce()
  })
  it('typical: quiet text and a muted History button', () => {
    render(<RankLine reading={TYPICAL} onHistory={() => {}} />)
    expect(screen.getByText('Typical · 52nd percentile since 2008')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'History of this reading' }).hasAttribute('data-muted')).toBe(true)
    expect(document.querySelector('[data-tone="bull"],[data-tone="bear"]')).toBeNull()
  })
})

describe('the History panel', () => {
  it('shows the baseline beside the similar days, labelled history not a forecast', () => {
    render(<HistoryPanel reading={makeReading()} fmt={(v) => String(v)} />)
    expect(screen.getByTestId('fwd-similar').textContent).toContain('all days')
    expect(screen.getByText(/History, not a forecast/)).toBeTruthy()
    expect(screen.queryByTestId('small-n')).toBeNull()
  })
  it('greys a small sample and says so', () => {
    const r = makeReading({ similar: { rule: 'nearest', band_pts: 2.5, min_n: 30, n: 30, small: true },
      forward: { ...makeReading().forward, similar: { 5: fwd(1, 60, 11), 20: fwd(2, 70, 11), 60: fwd(3, 80, 10) } } })
    render(<HistoryPanel reading={r} />)
    expect(screen.getByTestId('small-n').textContent).toBe('Only 11 similar days, too few to lean on.')
    expect(screen.getByTestId('fwd-similar').hasAttribute('data-small')).toBe(true)
  })
  it('a typical reading: one line, the baseline, no similar days', () => {
    render(<HistoryPanel reading={TYPICAL} />)
    expect(screen.getByTestId('typical-note').textContent).toBe('Typical reading: what came next matched an ordinary day.')
    expect(screen.getByTestId('fwd-baseline')).toBeTruthy()
    expect(screen.queryByText('Similar past days')).toBeNull()
  })
  it('a similar day is a button that moves the window to that date', () => {
    const onPickDate = vi.fn()
    render(<HistoryPanel reading={makeReading()} onPickDate={onPickDate} />)
    fireEvent.click(screen.getByText('Jun 9, 2020').closest('button'))
    expect(onPickDate).toHaveBeenCalledWith('2020-06-09')
  })
})

const DRILL = { items: [{ t: 'AEHR', pct: 13.1 }], label: 'Up20%/5d', date: '2026-11-09', colKey: 'up_20pct_5d' }

describe('the scan window: the History drawer', () => {
  it('opens from the rank line, closes with ×, and Escape closes the drawer before the window', () => {
    readingState.current = { reading: makeReading(), loading: false, error: null }
    const onClose = vi.fn()
    const onNavigate = vi.fn()
    render(<BreadthDrillModal drill={DRILL} onClose={onClose} onNavigate={onNavigate} rows={[]} />)
    expect(readingArgs.at(-1)).toMatchObject({ universe: 'uct', metric: 'up_20pct_5d', date: '2026-11-09' })
    expect(document.querySelector('[data-history-drawer]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'History of this reading' }))
    const drawer = document.querySelector('[data-history-drawer]')
    expect(drawer).toBeTruthy()
    expect(screen.getByTestId('board')).toBeTruthy()             // the list stays
    fireEvent.click(screen.getByRole('button', { name: 'Close History' }))
    expect(document.querySelector('[data-history-drawer]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'History of this reading' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(document.querySelector('[data-history-drawer]')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })
  it('a similar day navigates the window to that session', () => {
    readingState.current = { reading: makeReading(), loading: false, error: null }
    const onNavigate = vi.fn()
    render(<BreadthDrillModal drill={DRILL} onClose={() => {}} onNavigate={onNavigate} rows={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'History of this reading' }))
    fireEvent.click(document.querySelector('button[data-date="2025-04-22"]'))
    expect(onNavigate).toHaveBeenCalledWith({ colKey: 'up_20pct_5d', date: '2025-04-22', live: false })
  })
})

describe('the reading-only window', () => {
  const ratio = { readingOnly: true, label: '5D Ratio', colKey: 'ratio_5day', date: '2026-11-09', value: 1.84,
    valueText: '1.84', fmt: (v) => v.toFixed(2), isCount: false, hasList: false }
  it('a ratio cell: History is the body, and no list is fetched', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.reject(new Error('no')))
    readingState.current = { reading: makeReading({ metric: 'ratio_5day', value: 1.84 }), loading: false, error: null }
    render(<BreadthReadingModal drill={ratio} onClose={() => {}} />)
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toContain('5D Ratio')
    expect(screen.getByTestId('history-panel').getAttribute('data-layout')).toBe('row')
    expect(screen.getByText('5D Ratio has no stock list behind it, so History fills the window.')).toBeTruthy()
    expect(screen.getByText('5D Ratio each day · last 3 months')).toBeTruthy()
    expect(fetchSpy.mock.calls.some(([u]) => String(u).includes('/drill/'))).toBe(false)
    fetchSpy.mockRestore()
  })
  it('a non-UCT cell names the universe and says there is no list there yet', () => {
    readingState.current = { reading: makeReading({ universe: 'nasdaq', basis_universe: 'nasdaq' }), loading: false, error: null }
    render(<BreadthReadingModal universe="nasdaq" onClose={() => {}}
      drill={{ ...ratio, label: 'Up20%/5d', colKey: 'up_20pct_5d', isCount: true, hasList: true, value: 212 }} />)
    expect(readingArgs.at(-1)).toMatchObject({ universe: 'nasdaq', metric: 'up_20pct_5d' })
    expect(screen.getByText('No stock list for Nasdaq yet, so History fills the window.')).toBeTruthy()
    expect(screen.getAllByText('Nasdaq').length).toBeGreaterThan(0)
  })
  it('Escape closes it', () => {
    const onClose = vi.fn()
    render(<BreadthReadingModal drill={ratio} onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('Signature: chips stay chips, gold stays rare', () => {
  it('range, view and group controls are buttons (chips), not dropdowns', () => {
    const { container } = render(
      <>
        <ScanHeader label="Up 4%+" count={3} modes={['focus', 'grid', 'table']} mode="focus" onMode={() => {}}
          onClose={() => {}} ctx={{ series: [1, 2, 3], seriesDates: ['a', 'b', 'c'] }} />
        <GroupSwitch value="none" onChange={() => {}} />
      </>,
    )
    for (const k of ['1M', '3M', '6M', '1Y', 'Focus', 'Grid', 'Table', 'All', 'Sector', 'Industry', 'Theme']) {
      expect(screen.getByRole('button', { name: k })).toBeTruthy()
    }
    expect(container.querySelectorAll('select')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Focus' }).getAttribute('aria-pressed')).toBe('true')
    // today's bar carries the one gold tick
    expect(container.querySelectorAll('rect[data-tick]')).toHaveLength(1)
  })
  it('the sector hues hold no gold-like hue', () => {
    expect(GROUP_HUES).not.toContain('#c9a84c')
  })
})
