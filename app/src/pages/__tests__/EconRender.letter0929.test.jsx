// Owner rulings 2026-09-29 for "TODAY'S CALENDAR · ALL TIMES ET" (/r/econ):
//   - 12-hour times ("10:00 AM", "3:00 PM"), never "15:00";
//   - a bare generic "Fed Speaker" row is named ("Fed Speaker: <Name>") when the
//     payload carries a name anywhere, and DROPPED when it does not;
//   - no em dash in the header.
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import EconRender, { to12h, presentRows } from '../EconRender'

const ROWS = [
  { time: '08:30', kind: 'econ', event: 'CPI (MoM)', estimate: '0.3%', is_key: true },
  { time: '10:00', kind: 'fed', event: 'Fed Speaker', note: '', is_key: true },
  { time: '12:00', kind: 'fed', event: 'Fed Speaker', note: 'voting member', is_key: true },
  { time: '13:00', kind: 'fed', event: 'Fed Speaker', speaker: 'Waller', note: 'voting member', is_key: true },
  { time: '14:00', kind: 'fed', event: 'Fed Speaker', note: 'Governor Barr', is_key: true },
  { time: '14:30', kind: 'fed', event: 'Fed Chair Press Conference', note: '', is_key: true },
  { time: '15:00', kind: 'econ', event: 'Crude Inventories', estimate: '', is_key: false },
]

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
    ok: true, json: () => Promise.resolve({ date: '2026-09-29', rows: ROWS, amc: [], amc_count: 0 }),
  })))
})
afterEach(() => vi.unstubAllGlobals())

describe('to12h', () => {
  it.each([
    ['15:00', '3:00 PM'], ['10:00', '10:00 AM'], ['08:30', '8:30 AM'], ['8:30', '8:30 AM'],
    ['12:00', '12:00 PM'], ['00:05', '12:05 AM'], ['23:59', '11:59 PM'], ['14:00:00', '2:00 PM'],
  ])('%s -> %s', (a, b) => expect(to12h(a)).toBe(b))

  it('passes through anything that is not HH:MM', () => {
    expect(to12h('All Day')).toBe('All Day')
    expect(to12h('')).toBe('')
    expect(to12h(null)).toBe('')
    expect(to12h('25:00')).toBe('25:00')
  })
})

describe('presentRows — name it or drop it', () => {
  it('drops a bare "Fed Speaker" with no name anywhere', () => {
    const out = presentRows([ROWS[1], ROWS[2]])
    expect(out).toEqual([])
  })

  it('names it from speaker, then title, then note', () => {
    expect(presentRows([ROWS[3]])[0].event).toBe('Fed Speaker: Waller')
    expect(presentRows([ROWS[3]])[0].note).toBe('voting member')   // note kept: not the name source
    expect(presentRows([{ ...ROWS[1], title: 'Chair Powell speaks on the economy' }])[0].event)
      .toBe('Fed Speaker: Chair Powell')
    const fromNote = presentRows([ROWS[4]])[0]
    expect(fromNote.event).toBe('Fed Speaker: Governor Barr')
    expect(fromNote.note).toBe('')                                  // not printed twice
  })

  it('CONTROL: econ rows and non-generic Fed rows pass through untouched', () => {
    expect(presentRows([ROWS[0], ROWS[5], ROWS[6]])).toEqual([ROWS[0], ROWS[5], ROWS[6]])
  })
})

describe('EconRender page', () => {
  it('renders 12-hour times, names/drops Fed speakers, and has no em dash in the header', async () => {
    render(<MemoryRouter initialEntries={['/r/econ?w=728']}><EconRender /></MemoryRouter>)
    await screen.findByText('CPI (MoM)')
    const times = screen.getAllByTestId('econ-time').map((n) => n.textContent)
    expect(times).toEqual(['8:30 AM', '1:00 PM', '2:00 PM', '2:30 PM', '3:00 PM'])
    expect(document.body.textContent).not.toMatch(/\b15:00\b/)
    expect(screen.getByText('Fed Speaker: Waller')).toBeInTheDocument()
    expect(screen.getByText('Fed Speaker: Governor Barr')).toBeInTheDocument()
    expect(screen.queryByText('Fed Speaker')).not.toBeInTheDocument()
    expect(screen.getByText(/TODAY'S CALENDAR/).textContent).not.toMatch(/—/)
  })
})
