// The date box's jumps (review of #2947): LOW 2 a forward step at an intraday date goes to the next SESSION; LOW 3 the
// present is noted from every unanchored view the date box sees, so a halted name never reads as the present.
import { describe, it, expect, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { createDateBoxNav, nextSessionDay } from './dateBoxNav'
import ChartDateNav from './ChartDateNav'

// an intraday chart anchored at `day` whose forward step cannot move (the window ends at the date)
const at = (day) => ({ rightMs: Date.parse(`${day}T20:55:00Z`), lastMs: Date.parse(`${day}T20:55:00Z`), anchor: { date: day, width: 78 }, frame: { fromRight: 78, toRight: 0 } })
function rig(day, presentDay = '2026-11-25') {
  let date = { date: day, width: 78 }
  const set = vi.fn((v) => { date = v })
  const nav = createDateBoxNav({ meta: () => at(date ? date.date : day), stepPane: () => {}, setDate: set, getDate: () => date, tf: '5', presentRef: { current: presentDay } })
  return { nav, set }
}

describe('nextSessionDay', () => {
  it('skips weekends and exchange holidays', () => {
    expect(nextSessionDay('2025-03-14')).toBe('2025-03-17')   // Fri -> Mon
    expect(nextSessionDay('2025-03-15')).toBe('2025-03-17')   // Sat -> Mon
    expect(nextSessionDay('2025-11-26')).toBe('2025-11-28')   // Wed -> Fri (Thanksgiving)
    expect(nextSessionDay('2025-12-24')).toBe('2025-12-26')   // Christmas
    expect(nextSessionDay('2025-03-12')).toBe('2025-03-13')
  })
})

describe('stepBar forward at an intraday date (LOW 2)', () => {
  it('Fri goes to Mon, never Sat/Sun (each a dead press re-keying a new @to= read)', () => {
    const { nav, set } = rig('2025-03-14')
    nav.stepBar(1)
    expect(set).toHaveBeenLastCalledWith({ date: '2025-03-17', width: 78 })
  })
  it('the day before a holiday goes past it', () => {
    const { nav, set } = rig('2025-11-26')
    nav.stepBar(1)
    expect(set).toHaveBeenLastCalledWith({ date: '2025-11-28', width: 78 })
  })
})

describe('the present is noted from every unanchored view (LOW 3)', () => {
  it('note() keeps the newest unanchored day; an anchored view never lowers or sets it', () => {
    const presentRef = { current: null }
    let m = { rightMs: Date.parse('2026-11-25T20:55:00Z'), lastMs: Date.parse('2026-11-25T20:55:00Z'), frame: { fromRight: 78, toRight: 0 } }
    const nav = createDateBoxNav({ meta: () => m, stepPane: () => {}, setDate: () => {}, getDate: () => null, tf: '5', presentRef })
    nav.note()
    expect(presentRef.current).toBe('2026-11-25')
    m = { ...m, lastMs: Date.parse('2026-06-02T20:55:00Z') }   // a halted name: its last bar months ago
    nav.note()
    expect(presentRef.current).toBe('2026-11-25')
  })
  it('ChartDateNav calls its host\'s note() whenever the chart\'s view changes, not only on a jump', () => {
    const note = vi.fn()
    const meta = { rightMs: Date.UTC(2026, 10, 25), firstMs: 0, lastMs: Date.UTC(2026, 10, 25), firstYear: 2000, lastYear: 2026, fullyLoaded: true, loading: false }
    render(<ChartDateNav paneRef={{ current: { getDateMeta: () => meta } }} nav={{ note, goToDate: vi.fn() }} />)
    expect(note).toHaveBeenCalledTimes(1)
    cleanup()
  })
})
