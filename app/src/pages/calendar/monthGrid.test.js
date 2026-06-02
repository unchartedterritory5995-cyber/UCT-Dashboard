// app/src/pages/calendar/monthGrid.test.js
import { describe, it, expect } from 'vitest'
import { buildMonthGrid } from './monthGrid'

// Helper to get YYYY-MM-DD strings for a month
function makeDay(year, month, day) {
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
}

describe('buildMonthGrid', () => {
  it('returns an array of rows (each row = up to 5 weekday cells)', () => {
    const grid = buildMonthGrid(2026, 6, {}, [])
    // June 2026: Mon Jun 1 → Sun Jun 30 = 22 weekdays
    const cells = grid.flat()
    // Leading + trailing greyed cells fill out the rows to exactly 5 cols/row
    expect(grid.length).toBeGreaterThanOrEqual(4)
    expect(grid.every(row => row.length === 5)).toBe(true)
  })

  it('all in-month weekday cells have inMonth=true', () => {
    const grid = buildMonthGrid(2026, 6, {}, [])
    const cells = grid.flat()
    const inMonth = cells.filter(c => c.inMonth)
    // June 2026 has 22 weekdays
    expect(inMonth.length).toBe(22)
  })

  it('leading and trailing cells have inMonth=false', () => {
    // January 2026: Jan 1 is Thursday → Mon-Wed (3 leading cells from Dec)
    const grid = buildMonthGrid(2026, 1, {}, [])
    const first = grid[0]
    // The first row should have some cells that are not in January
    const leading = first.filter(c => !c.inMonth)
    expect(leading.length).toBeGreaterThan(0)
  })

  it('attaches syms + mineSyms from daysMap', () => {
    const daysMap = {
      '2026-06-02': { bmo: [{ sym: 'AAPL' }], amc: [{ sym: 'MSFT', mine: true }] },
    }
    const grid = buildMonthGrid(2026, 6, daysMap, ['watchlist'])
    const cells = grid.flat()
    const jun2 = cells.find(c => c.ds === '2026-06-02')
    expect(jun2).toBeTruthy()
    expect(jun2.syms).toContain('AAPL')
    expect(jun2.syms).toContain('MSFT')
    expect(jun2.mineSyms.has('MSFT')).toBe(true)
    expect(jun2.mineSyms.has('AAPL')).toBe(false)
  })

  it('hasMacro is true when day has key econ or fed events', () => {
    const daysMap = {
      '2026-06-03': { bmo: [], amc: [], econ: [{ is_key: true }], fed: [] },
      '2026-06-04': { bmo: [], amc: [], econ: [], fed: [{ event: 'Powell speaks' }] },
      '2026-06-05': { bmo: [], amc: [], econ: [], fed: [] },
    }
    const grid = buildMonthGrid(2026, 6, daysMap, [])
    const cells = grid.flat()
    const jun3 = cells.find(c => c.ds === '2026-06-03')
    const jun4 = cells.find(c => c.ds === '2026-06-04')
    const jun5 = cells.find(c => c.ds === '2026-06-05')
    expect(jun3?.hasMacro).toBe(true)
    expect(jun4?.hasMacro).toBe(true)
    expect(jun5?.hasMacro).toBe(false)
  })

  it('each cell has required shape keys', () => {
    const grid = buildMonthGrid(2026, 6, {}, [])
    const cell = grid[0][0]
    expect(cell).toHaveProperty('ds')
    expect(cell).toHaveProperty('dayNum')
    expect(cell).toHaveProperty('inMonth')
    expect(cell).toHaveProperty('isToday')
    expect(cell).toHaveProperty('syms')
    expect(cell).toHaveProperty('mineSyms')
    expect(cell).toHaveProperty('hasMacro')
  })

  it('correctly handles a month starting on Monday (no leading cells in first row)', () => {
    // Find a month that starts on Monday: March 2021 starts on Monday
    const grid = buildMonthGrid(2021, 3, {}, [])
    const firstRow = grid[0]
    // All 5 cells in first row should be in-month (Mon Mar 1 → Fri Mar 5)
    expect(firstRow.every(c => c.inMonth)).toBe(true)
    expect(firstRow[0].ds).toBe('2021-03-01')
  })
})
