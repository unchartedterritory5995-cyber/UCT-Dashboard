/**
 * THE DRILL'S DOOR — can a keyboard open it at all?
 *
 * Every drillable cell was a bare `<td onClick>`: no role, no tabIndex, no key
 * handling. So the cell was invisible to the keyboard, announced as a plain
 * table cell, and NONE of the dialog's own keyboard work could be reached —
 * because the control that opens it could not be.
 *
 * ⛔ ONE TAB STOP PER ROW, not per cell. Measured on the live page: 473 drillable
 * cells rendered (43 rows × ~11) against 43 tabbable elements on the whole page.
 * Making each cell tabbable would take the tab order from 43 stops to 516 —
 * worse for exactly the users it is meant to serve.
 *
 * ⛔ Vertical movement is Tab's job, not an arrow's: this table is VIRTUALIZED,
 * so a row outside the rendered window is not in the DOM and cannot be focused.
 * An up/down handler would have to drive the virtualizer's scroll, putting a
 * second authority on the scroll position.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('echarts-for-react', () => ({ default: () => <div data-testid="echart" /> }))
vi.mock('../CotData', () => ({ default: () => <div /> }))
vi.mock('../BreadthCharts', () => ({ default: () => <div /> }))
vi.mock('../../components/tiles/MarketBreadth', () => ({ default: () => <div /> }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { role: 'user' } }) }))
vi.mock('../../hooks/useFlagged', () => ({
  useFlagged: () => ({ flagged: [], toggle: () => {}, remove: () => {}, isFlagged: () => false,
                       isShared: false, toggleShare: () => {}, flaggedName: 'Flagged',
                       renameFlagged: () => {} }),
}))
vi.mock('../../hooks/useLiveBreadth', () => ({
  useLiveBreadth: () => ({ row: null, stamp: null, superseded: true }),
  formatLiveClock: () => 'now',
}))
// The drill modal is lazy; stand it up as a probe so "it opened" is observable
// without pulling the whole charts-widget tree into this file.
vi.mock('./drill/BreadthDrillModal', () => ({
  default: ({ drill }) => <div data-testid="drill-open">{drill?.label}</div>,
}))

const ROWS = Array.from({ length: 12 }, (_, i) => {
  const day = new Date(Date.UTC(2026, 7, 28) - i * 86400000)
  return {
    date: day.toISOString().slice(0, 10),
    breadth_score: 70 - (i % 9), uct_exposure: 60, pct_above_50sma: 55 - i,
    pct_above_200sma: 50, pct_above_5sma: 40, pct_above_10sma: 45, pct_above_20ema: 50,
    pct_above_40sma: 52, pct_above_100sma: 55,
    up_4pct_today: 200, down_4pct_today: 90, new_52w_highs: 30, new_52w_lows: 8,
    mcclellan_osc: 10, vix: 16, sp500_close: 5000 + i, advancing: 3000, declining: 1500,
  }
})
// The Monitor sheet is windowed: `useMonitorGrid` renders over a dates INDEX and
// fills rows in per block, so a single blanket SWR answer leaves it with an empty
// timeline and no <table> at all. Answer the index key for what it is.
vi.mock('swr', () => ({
  default: (key) => (String(key).includes('/dates')
    ? { data: { dates: ROWS.map(r => r.date) }, isLoading: false, error: null, mutate: () => {} }
    : { data: { rows: ROWS, days: 90 }, isLoading: false, error: null, mutate: () => {} }),
  useSWRConfig: () => ({ mutate: () => {} }),
}))
// ⛔ WITHOUT THIS THE WHOLE FILE PASSES VACUOUSLY. The monitor table is
// virtualized off `tableWrapRef`, and jsdom does no layout — clientHeight is 0,
// so the real virtualizer yields ZERO rows, no `td` renders, and every assertion
// about cells is made against an empty table. The CONTROL block below is what
// catches that if this mock is ever removed.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({
      index, key: index, start: index * 28, size: 28, end: (index + 1) * 28,
    })),
    getTotalSize: () => count * 28,
    scrollToIndex: () => {}, measureElement: () => {}, scrollToOffset: () => {},
  }),
  observeElementRect: () => () => {},
  observeElementOffset: () => () => {},
  elementScroll: () => {},
}))

import Breadth from '../Breadth'

// Block rows are fetched with the shared fetcher directly (not through SWR), so
// there is nothing to stub there. Seed the grid's OWN instant-open cache instead
// — the documented path it hydrates from on first paint — and the rows are there
// before the first render rather than after a round-trip that jsdom cannot serve.
beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('uct.breadth.dates.v1', JSON.stringify({ dates: ROWS.map(r => r.date) }))
  localStorage.setItem('uct.breadth.recent.v1', JSON.stringify(ROWS))
})

const mount = () => render(<MemoryRouter initialEntries={['/breadth']}><Breadth /></MemoryRouter>)
const drillCells = (c) => Array.from(c.querySelectorAll('td[data-drill]'))
const rowsWithDrills = (c) =>
  Array.from(new Set(drillCells(c).map(d => d.closest('tr')))).filter(Boolean)

describe('CONTROL — the monitor really is rendering drillable cells', () => {
  it('there are drillable cells across several rows', () => {
    const { container } = mount()
    expect(drillCells(container).length).toBeGreaterThan(5)
    expect(rowsWithDrills(container).length).toBeGreaterThan(1)
  })
})

describe('a drillable cell is a real control', () => {
  it('is announced as a button, not a table cell', () => {
    const { container } = mount()
    for (const d of drillCells(container)) expect(d.getAttribute('role')).toBe('button')
  })

  it('is NAMED with its metric, value and session — "134" alone says nothing', () => {
    const { container } = mount()
    const label = drillCells(container)[0].getAttribute('aria-label')
    expect(label).toMatch(/open the list of stocks/)
    // The metric name and the session both appear, so the control is
    // self-describing when it is read outside its table context.
    expect(label.length).toBeGreaterThan('open the list of stocks'.length + 8)
    expect(label).toMatch(/\d{4}-\d{2}-\d{2}|live session/)
  })

  it('a NON-drillable cell is left alone — no role, no tab stop', () => {
    const { container } = mount()
    const plain = Array.from(container.querySelectorAll('tbody td'))
      .filter(td => !td.hasAttribute('data-drill'))
    expect(plain.length).toBeGreaterThan(0)
    for (const td of plain.slice(0, 25)) {
      expect(td.getAttribute('role')).toBeNull()
      expect(td.getAttribute('tabindex')).toBeNull()
    }
  })
})

describe('exactly one tab stop per row', () => {
  it('each row offers a single tabbable cell, and it is the FIRST one', () => {
    const { container } = mount()
    for (const tr of rowsWithDrills(container)) {
      const cells = Array.from(tr.querySelectorAll('td[data-drill]'))
      const stops = cells.filter(c => c.getAttribute('tabindex') === '0')
      expect(stops, 'a row must contribute one stop, not eleven').toHaveLength(1)
      expect(stops[0]).toBe(cells[0])
    }
  })

  it('the table adds one stop per ROW, not one per CELL', () => {
    const { container } = mount()
    const stops = drillCells(container).filter(c => c.getAttribute('tabindex') === '0').length
    expect(stops).toBe(rowsWithDrills(container).length)
    expect(stops).toBeLessThan(drillCells(container).length)
  })
})

describe('it opens from the keyboard', () => {
  // `findBy`, not `getBy`: the modal is `lazy()`, so it resolves on a microtask
  // after the key lands. A sync read here fails on timing and reads as "the key
  // did nothing".
  it('Enter opens the drill for that cell', async () => {
    const { container } = mount()
    fireEvent.keyDown(drillCells(container)[0], { key: 'Enter' })
    expect(await screen.findByTestId('drill-open')).toBeTruthy()
  })

  it('Space opens it too', async () => {
    const { container } = mount()
    fireEvent.keyDown(drillCells(container)[0], { key: ' ' })
    expect(await screen.findByTestId('drill-open')).toBeTruthy()
  })

  it('a key it does not own does NOT open anything', () => {
    const { container } = mount()
    fireEvent.keyDown(drillCells(container)[0], { key: 'x' })
    expect(screen.queryByTestId('drill-open')).toBeNull()
  })
})

describe('arrows move along the row, carrying the tab stop', () => {
  const rowCells = (c) => Array.from(rowsWithDrills(c)[0].querySelectorAll('td[data-drill]'))

  it('ArrowRight focuses the next drillable cell in the row', () => {
    const { container } = mount()
    const cells = rowCells(container)
    cells[0].focus()
    fireEvent.keyDown(cells[0], { key: 'ArrowRight' })
    expect(document.activeElement).toBe(cells[1])
  })

  it('the single stop TRAVELS, so Shift+Tab returns where you were', () => {
    const { container } = mount()
    const cells = rowCells(container)
    cells[0].focus()
    fireEvent.keyDown(cells[0], { key: 'ArrowRight' })
    expect(cells[1].getAttribute('tabindex')).toBe('0')
    expect(cells[0].getAttribute('tabindex')).toBe('-1')
  })

  it('ArrowLeft goes back', () => {
    const { container } = mount()
    const cells = rowCells(container)
    cells[1].focus()
    fireEvent.keyDown(cells[1], { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(cells[0])
  })

  it('Home and End reach the ends of the row', () => {
    const { container } = mount()
    const cells = rowCells(container)
    cells[1].focus()
    fireEvent.keyDown(cells[1], { key: 'End' })
    expect(document.activeElement).toBe(cells[cells.length - 1])
    fireEvent.keyDown(cells[cells.length - 1], { key: 'Home' })
    expect(document.activeElement).toBe(cells[0])
  })

  it('stops at the ends instead of wrapping into another row', () => {
    const { container } = mount()
    const cells = rowCells(container)
    cells[0].focus()
    fireEvent.keyDown(cells[0], { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(cells[0])
  })
})
